import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.MAIN_PORT || 3000);

const WEATHER_AGENT_URL =
  process.env.WEATHER_AGENT_URL || "http://localhost:3001";
const FLIGHT_AGENT_URL =
  process.env.FLIGHT_AGENT_URL || "http://localhost:3002";

// ====== 单 surface / 单连接（demo 简化）======
const sseBySurface = new Map(); // surfaceId -> { res, pingTimer }
const agentCardCache = new Map(); // baseUrl -> card json

function sseSend(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function setSseHeaders(res) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.write(":\n\n");
}

// ====== 文本清洗：去 code fence，压成单行，避免 ```json 等污染 UI ======
function stripCodeFences(s) {
  if (typeof s !== "string") return "";
  // 去掉 ```xxx 与 ``` 包裹
  return s
    .replace(/```[a-zA-Z0-9_-]*\n?/g, "")
    .replace(/```/g, "")
    .trim();
}

function toOneLine(s) {
  if (typeof s !== "string") return "";
  return s.replace(/\s+/g, " ").trim();
}

function cleanNote(s) {
  return toOneLine(stripCodeFences(String(s ?? "")));
}

function safeJson(v) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// ====== A2A-like: Discovery (Agent Card) ======
async function fetchAgentCard(baseUrl) {
  if (agentCardCache.has(baseUrl)) return agentCardCache.get(baseUrl);
  const url = `${baseUrl}/.well-known/agent-card.json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`AgentCard fetch failed: ${url} ${r.status}`);
  const card = await r.json();
  agentCardCache.set(baseUrl, card);
  return card;
}

// ====== A2A-like: sendSubscribe via SSE, read until {type:"final"} ======
// 增加超时，避免子 agent 卡死导致 main-agent 永远等待
async function sendSubscribe(baseUrl, input, timeoutMs = 20000) {
  const card = await fetchAgentCard(baseUrl);
  const endpoint = card?.endpoints?.sendSubscribe;
  if (!endpoint)
    throw new Error(`No sendSubscribe endpoint in Agent Card for ${baseUrl}`);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
      signal: ac.signal,
    });
    if (!r.ok || !r.body)
      throw new Error(`sendSubscribe failed: ${endpoint} ${r.status}`);

    const reader = r.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // SSE events separated by \n\n; we only parse "data: ..."
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const event = buf.slice(0, idx);
        buf = buf.slice(idx + 2);

        const lines = event.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;

          let msg;
          try {
            msg = JSON.parse(jsonStr);
          } catch {
            continue;
          }

          if (msg?.type === "final") {
            if (msg.error) throw new Error(msg.error);
            return msg.artifact; // {kind,data}
          }
        }
      }
    }

    throw new Error("SSE stream ended without final message");
  } catch (e) {
    // AbortError -> timeout
    if (String(e?.name) === "AbortError") {
      throw new Error(`sendSubscribe timeout after ${timeoutMs}ms: ${baseUrl}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ====== A2UI (v0.8-like) ======
function sendInitialUI(surfaceId, res) {
  // 1) UI Catalog
  sseSend(res, {
    surfaceUpdate: {
      surfaceId,
      components: [
        {
          id: "root",
          component: {
            Column: {
              children: {
                explicitList: ["title", "input", "submitBtn", "resultArea"],
              },
            },
          },
        },
        {
          id: "title",
          component: {
            Text: {
              text: { literalString: "A2A + A2UI(v0.8-like) Demo" },
              usageHint: "h2",
            },
          },
        },
        {
          id: "input",
          component: {
            TextField: {
              label: { literalString: "输入需求（天气/机票）" },
              text: { path: "/form/query" },
            },
          },
        },
        {
          id: "submitBtn",
          component: {
            Button: {
              child: "submitText",
              action: {
                name: "submit",
                context: [{ key: "query", value: { path: "/form/query" } }],
              },
            },
          },
        },
        {
          id: "submitText",
          component: { Text: { text: { literalString: "提交" } } },
        },
        {
          id: "resultArea",
          component: {
            Column: {
              children: {
                explicitList: [
                  "weatherCard",
                  "flightSelect",
                  "flightDetailArea",
                ],
              },
            },
          },
        },
        {
          id: "weatherCard",
          component: {
            Card: {
              title: { literalString: "天气" },
              body: { path: "/weather/temp_text" },
            },
          },
        },
        // 新增下拉选择器
        {
          id: "flightSelect",
          component: {
            Select: {
              label: { literalString: "机票" },
              options: { path: "/flights/options" },
              selectedIndex: { path: "/flights/selectedIndex" },
            },
          },
        },
        // 新增选中机票详情区域组件
        {
          id: "flightDetailArea",
          component: {
            Column: {
              children: {
                explicitList: ["flightDetailCard", "flightDetailImage"],
              },
            },
          },
        },
        // 新增选中机票详情卡片组件
        {
          id: "flightDetailCard",
          component: {
            Card: {
              title: { literalString: "机票详情" },
              body: { path: "/flights/selected_detail_text" },
            },
          },
        },
        // 新增选中机票详情图片组件
        {
          id: "flightDetailImage",
          component: {
            Image: {
              src: { path: "/flights/selected_detail_image" },
              alt: { literalString: "机票详情图片" },
              width: 320,
              height: 180,
            },
          },
        },
      ],
    },
  });
  sseSend(res, {
    dataModelUpdate: {
      surfaceId,
      path: "/weather",
      contents: [{ key: "temp_text", valueString: "（等待查询）" }],
    },
  });

  sseSend(res, {
    dataModelUpdate: {
      surfaceId,
      path: "/flights",
      contents: [
        { key: "options", valueJson: [] },
        { key: "selectedIndex", valueNumber: null },
        { key: "selected_detail_image", valueString: "" },
        { key: "selected_detail_text", valueString: "(未选择)" },
      ],
    },
  });

  // 3) begin rendering (v0.8-like)
  sseSend(res, { beginRendering: { surfaceId, root: "root" } });
}

function buildWeatherText(w) {
  const low = Number(w?.temp_c_low);
  const high = Number(w?.temp_c_high);

  // 优先用温度区间
  if (Number.isFinite(low) && Number.isFinite(high)) {
    return `${low} ~ ${high} °C`;
  }

  // 次选：summary
  if (w?.summary) return String(w.summary);

  // 次选：advice
  if (w?.advice) return String(w.advice);

  return "（未返回天气信息）";
}

function normalizeFlightOptions(rawOptions) {
  const list = Array.isArray(rawOptions) ? rawOptions : [];
  const out = [];

  for (let i = 0; i < list.length; i++) {
    const o = list[i];

    // 只接受 object，避免 string/markdown 直接进入
    if (!o || typeof o !== "object") continue;

    const airline = String(
      o.airline ?? o.carrier ?? o.airlineName ?? ""
    ).trim();
    const depart = String(o.depart ?? o.departTime ?? "").trim();
    const arrive = String(o.arrive ?? o.arriveTime ?? "").trim();
    const notes = cleanNote(o.notes ?? o.note ?? "");
    const image_url = String(o.image_url ?? o.logo_url ?? "").trim();

    // price 允许 number 或字符串数字
    let price = o.price_cny ?? o.price ?? o.priceCny;
    if (typeof price === "string") price = price.replace(/[^\d.]/g, "");
    const priceNum = price != null && price !== "" ? Number(price) : null;

    // 如果关键信息全空，就跳过，避免拼出 N/A N/A-N/A
    if (
      !airline &&
      !depart &&
      !arrive &&
      priceNum == null &&
      !notes &&
      !image_url
    )
      continue;

    out.push({
      airline,
      depart,
      arrive,
      priceNum,
      notes,
      image_url,
    });
  }

  return out;
}

function formatOptionDetail(o) {
  if (!o) return "未选择";
  const lines = [
    `airline: ${o.airline ?? ""}`,
    `depart: ${o.depart ?? ""}`,
    `arrive: ${o.arrive ?? ""}`,
    `duration: ${o.duration ?? ""}`,
    `price_cny: ${o.price_cny ?? ""}`,
    `notes: ${o.notes ?? ""}`,
    `image_url: ${o.image_url ?? ""}`,
  ];
  return lines.join("\n");
}
function sendResultUI(surfaceId, res, weatherArtifact, flightArtifact) {
  // ===== 1) /weather =====
  const w = weatherArtifact?.data ?? {};
  const tempText = buildWeatherText(w);

  sseSend(res, {
    dataModelUpdate: {
      surfaceId,
      path: "/weather",
      contents: [
        { key: "city", valueString: String(w.city ?? "") },
        { key: "date", valueString: String(w.date ?? "") },
        { key: "summary", valueString: String(w.summary ?? "") },
        { key: "advice", valueString: String(w.advice ?? "") },

        // 兼容后续更结构化渲染
        {
          key: "temp_c_low",
          valueNumber: Number.isFinite(Number(w.temp_c_low))
            ? Number(w.temp_c_low)
            : 0,
        },
        {
          key: "temp_c_high",
          valueNumber: Number.isFinite(Number(w.temp_c_high))
            ? Number(w.temp_c_high)
            : 0,
        },
        {
          key: "precip_prob",
          valueNumber: Number.isFinite(Number(w.precip_prob))
            ? Number(w.precip_prob)
            : 0,
        },

        // 当前 UI 直接绑定的字段
        { key: "temp_text", valueString: tempText },
        {
          key: "precip_text",
          valueString: w.precip_prob != null ? `${w.precip_prob}%` : "",
        },
      ],
    },
  });

  // ===== 2) /flights =====
  const f = flightArtifact?.data ?? {};
  const normalized = normalizeFlightOptions(f.options);
  console.log("🚀 ~ sendResultUI ~ normalized:", normalized);

  const optionsText = normalized.length
    ? normalized
        .map((o, idx) => {
          const time = [o.depart, o.arrive].filter(Boolean).join("–");
          const price = o.priceNum != null ? `¥${o.priceNum}` : "";
          const notes = o.notes ? `（${o.notes}）` : "";
          // 让空字段也能合理展示，但不输出 N/A
          return `${idx + 1}. ${[o.airline, time, price]
            .filter(Boolean)
            .join(" ")} ${notes}`.trim();
        })
        .join("\n")
    : "（暂无选项）";
  const options = Array.isArray(f.options) ? f.options : [];
  const selectedIndex = options.length ? 0 : -1;
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;
  console.log("🚀 ~ sendResultUI ~ selected:", selected);
  const img = selected?.image_url || selected?.logo_url || ""; // 没有就空字符串
  sseSend(res, {
    dataModelUpdate: {
      surfaceId,
      path: "/flights",
      contents: [
        { key: "from", valueString: String(f.from ?? "") },
        { key: "to", valueString: String(f.to ?? "") },
        { key: "date", valueString: String(f.date ?? "") },

        // 原始 options 仍写入（后面要做 List/Repeat 会用到）
        {
          key: "options",
          valueJson: options,
        },
        { key: "selectedIndex", valueNumber: selectedIndex },
        {
          key: "selected_detail_text",
          valueString: formatOptionDetail(selected),
        },
        {
          key: "selected_detail_image",
          valueString: String(img),
        },

        // 当前 UI 直接绑定的字段（已经清洗过）
        { key: "options_text", valueString: optionsText },

        // 可选：用于 debug（不绑 UI）
        { key: "raw", valueString: safeJson(flightArtifact?.data ?? {}) },
      ],
    },
  });
}

// ====== 静态前端 ======
app.use("/", express.static(path.join(__dirname, "web")));

// UI Stream（SSE）
app.get("/ui/stream", (req, res) => {
  const surfaceId = String(req.query.surfaceId || "main");
  setSseHeaders(res);

  // 心跳
  const pingTimer = setInterval(() => res.write(":\n\n"), 15000);

  // 记录连接
  const old = sseBySurface.get(surfaceId);
  if (old?.pingTimer) clearInterval(old.pingTimer);
  sseBySurface.set(surfaceId, { res, pingTimer });

  // 首帧 UI
  sendInitialUI(surfaceId, res);

  req.on("close", () => {
    clearInterval(pingTimer);
    const cur = sseBySurface.get(surfaceId);
    if (cur?.res === res) sseBySurface.delete(surfaceId);
  });
});

// 用户交互回传（userAction）
app.post("/ui/event", async (req, res) => {
  const { userAction } = req.body || {};
  const surfaceId = userAction?.surfaceId || "main";
  const name = userAction?.name;

  const conn = sseBySurface.get(surfaceId);
  if (!conn?.res)
    return res.status(409).json({ error: "No active stream for surfaceId" });

  if (name !== "submit") return res.json({ ok: true });

  const query = String(userAction?.context?.query || "");
  if (!query.trim()) return res.status(400).json({ error: "Empty query" });

  // Loading：写到 UI 真实绑定字段
  sseSend(conn.res, {
    dataModelUpdate: {
      surfaceId,
      path: "/weather",
      contents: [{ key: "temp_text", valueString: "查询中..." }],
    },
  });
  sseSend(conn.res, {
    dataModelUpdate: {
      surfaceId,
      path: "/flights",
      contents: [
        { key: "options", valueJson: [] },
        { key: "selectedIndex", valueNumber: -1 },
        { key: "selected_detail_image", valueString: "" },
        { key: "selected_detail_text", valueString: "查询中..." },
      ],
    },
  });

  try {
    // 并行 A2A 调用两个子 Agent
    const [weatherArtifact, flightArtifact] = await Promise.all([
      sendSubscribe(WEATHER_AGENT_URL, { query }),
      sendSubscribe(FLIGHT_AGENT_URL, { query }),
    ]);

    // 聚合 → A2UI dataModel 更新
    sendResultUI(surfaceId, conn.res, weatherArtifact, flightArtifact);

    return res.json({ ok: true });
  } catch (e) {
    const msg = `ERROR: ${String(e?.message || e)}`;

    // Error：同样写到 UI 真实绑定字段（不再 patch）
    sseSend(conn.res, {
      dataModelUpdate: {
        surfaceId,
        path: "/weather",
        contents: [{ key: "temp_text", valueString: msg }],
      },
    });
    sseSend(conn.res, {
      dataModelUpdate: {
        surfaceId,
        path: "/flights",
        contents: [{ key: "options_text", valueString: msg }],
      },
    });

    return res.status(500).json({ error: msg });
  }
});

app.get("/health", (req, res) => res.json({ ok: true, service: "main-agent" }));

app.listen(PORT, () => {
  console.log(`[main-agent] listening on http://localhost:${PORT}`);
});
