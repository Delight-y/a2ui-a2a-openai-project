import express from "express";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { extractInitFromCatalog, buildInitUpdates } from "./a2ui_init.js";

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

// ====== demo 简化：单 surface / 单连接 ======
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

// ====== 纯 v0.8-like：用 fullPath 写入 dataModelUpdate(path+contents) ======
function splitPath(fullPath) {
  const parts = String(fullPath || "")
    .split("/")
    .filter(Boolean);
  if (!parts.length) return null;
  const key = parts[parts.length - 1];
  const base = "/" + parts.slice(0, -1).join("/");
  return { base: base === "" ? "/" : base, key };
}

function dmWrite(surfaceId, res, fullPath, value) {
  const sp = splitPath(fullPath);
  if (!sp) return;

  const contentsItem = { key: sp.key };

  if (value == null) contentsItem.valueString = "";
  else if (typeof value === "string") contentsItem.valueString = value;
  else if (typeof value === "number") contentsItem.valueNumber = value;
  else if (typeof value === "boolean") contentsItem.valueBool = value;
  else contentsItem.valueJson = value;

  sseSend(res, {
    dataModelUpdate: {
      surfaceId,
      path: sp.base,
      contents: [contentsItem],
    },
  });
}

function dmWriteMany(surfaceId, res, basePath, kvList) {
  // kvList: [{key, valueString/valueNumber/valueBool/valueJson}]
  sseSend(res, {
    dataModelUpdate: {
      surfaceId,
      path: basePath,
      contents: kvList,
    },
  });
}

// ====== 文本清洗：避免子 agent 返回 markdown/code fence 污染 UI ======
function stripCodeFences(s) {
  if (typeof s !== "string") return "";
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

      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const event = buf.slice(0, idx);
        buf = buf.slice(idx + 2);

        for (const line of event.split("\n")) {
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
    if (String(e?.name) === "AbortError") {
      throw new Error(`sendSubscribe timeout after ${timeoutMs}ms: ${baseUrl}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ====== catalog + bindings ======
// catalog: web/a2ui.catalog.v0_8.json
//   { "root": "root", "components": [ ... ] }
//
// bindings: web/a2ui.bindings.json（推荐结构）
// {
//   "root": "root",
//   "weather": { "tempText": "/weather/temp_text", "precipText": "/weather/precip_text" },
//   "flights": {
//     "options": "/flights/options",
//     "optionsText": "/flights/options_text",
//     "selectedIndex": "/flights/selectedIndex",
//     "detailText": "/flights/selected_detail_text",
//     "detailImage": "/flights/selected_detail_image"
//   },
//   "form": { "query": "/form/query" }
// }
function loadCatalog() {
  const p = path.join(__dirname, "web", "a2ui.catalog.v0_8.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function loadBindings() {
  const p = path.join(__dirname, "web", "a2ui.bindings.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function getRootId(catalog, bindings) {
  return String(bindings?.root || catalog?.root || "root");
}

// ====== 业务格式化 ======
function buildWeatherText(w) {
  const low = Number(w?.temp_c_low);
  const high = Number(w?.temp_c_high);
  if (Number.isFinite(low) && Number.isFinite(high))
    return `${low} ~ ${high} °C`;
  if (w?.summary) return String(w.summary);
  if (w?.advice) return String(w.advice);
  return "（未返回天气信息）";
}

function normalizeFlightOptions(rawOptions) {
  const list = Array.isArray(rawOptions) ? rawOptions : [];
  const out = [];

  for (const o of list) {
    if (!o || typeof o !== "object") continue;

    const airline = String(
      o.airline ?? o.carrier ?? o.airlineName ?? ""
    ).trim();
    const depart = String(o.depart ?? o.departTime ?? "").trim();
    const arrive = String(o.arrive ?? o.arriveTime ?? "").trim();
    const notes = cleanNote(o.notes ?? o.note ?? "");
    const image_url = String(o.image_url ?? o.logo_url ?? "").trim();

    let price = o.price_cny ?? o.price ?? o.priceCny ?? o.priceNum;
    if (typeof price === "string") price = price.replace(/[^\d.]/g, "");
    const priceNum = price != null && price !== "" ? Number(price) : null;

    if (
      !airline &&
      !depart &&
      !arrive &&
      priceNum == null &&
      !notes &&
      !image_url
    )
      continue;

    out.push({ airline, depart, arrive, priceNum, notes, image_url });
  }

  return out;
}

function formatOptionDetail(o) {
  if (!o) return "未选择";
  const price = o.price_cny ?? o.priceNum ?? "";
  const lines = [
    `airline: ${o.airline ?? ""}`,
    `depart: ${o.depart ?? ""}`,
    `arrive: ${o.arrive ?? ""}`,
    `price: ${price ?? ""}`,
    `notes: ${o.notes ?? ""}`,
    `image_url: ${o.image_url ?? ""}`,
  ];
  return lines.join("\n");
}

function buildOptionsText(normalized) {
  const list = Array.isArray(normalized) ? normalized : [];
  if (!list.length) return "（暂无选项）";

  return list
    .map((o, idx) => {
      const time = [o.depart, o.arrive].filter(Boolean).join("–");
      const price = o.priceNum != null ? `¥${o.priceNum}` : "";
      const notes = o.notes ? `（${o.notes}）` : "";
      return `${idx + 1}. ${[o.airline, time, price]
        .filter(Boolean)
        .join(" ")} ${notes}`.trim();
    })
    .join("\n");
}

// ====== A2UI: sendInitialUI ======
function sendInitialUI(surfaceId, res) {
  const catalog = loadCatalog();
  const bindings = loadBindings();
  const rootId = getRootId(catalog, bindings);

  // 1) UI Catalog
  sseSend(res, {
    surfaceUpdate: {
      surfaceId,
      components: catalog.components || [],
    },
  });

  // 2) 自动初始化：从 catalog 扫描 path
  const initItems = extractInitFromCatalog(catalog.components || []);

  // 2.1 overrides：用 bindings 指向的关键字段给更友好的默认值
  const overrides = {};
  if (bindings?.form?.query) overrides[bindings.form.query] = "";
  if (bindings?.weather?.tempText)
    overrides[bindings.weather.tempText] = "（等待查询）";
  if (bindings?.weather?.precipText)
    overrides[bindings.weather.precipText] = "";
  if (bindings?.flights?.optionsText)
    overrides[bindings.flights.optionsText] = "（等待查询）";
  if (bindings?.flights?.options) overrides[bindings.flights.options] = [];
  if (bindings?.flights?.selectedIndex)
    overrides[bindings.flights.selectedIndex] = -1;
  if (bindings?.flights?.detailText)
    overrides[bindings.flights.detailText] = "未选择";
  if (bindings?.flights?.detailImage)
    overrides[bindings.flights.detailImage] = "";

  const initUpdates = buildInitUpdates(initItems, { overrides });

  for (const u of initUpdates) {
    sseSend(res, {
      dataModelUpdate: {
        surfaceId,
        path: u.path,
        contents: u.contents,
      },
    });
  }

  // 3) begin rendering (strict v0.8-like)
  sseSend(res, { beginRendering: { surfaceId, root: rootId } });
}

// ====== A2UI: sendResultUI（完全按 bindings 写入）=====
function sendResultUI(surfaceId, res, weatherArtifact, flightArtifact) {
  const bindings = loadBindings();

  // --- weather ---
  const w = weatherArtifact?.data ?? {};
  const tempText = buildWeatherText(w);

  if (bindings?.weather?.tempText)
    dmWrite(surfaceId, res, bindings.weather.tempText, tempText);
  if (bindings?.weather?.precipText)
    dmWrite(
      surfaceId,
      res,
      bindings.weather.precipText,
      w.precip_prob != null ? `${w.precip_prob}%` : ""
    );

  // --- flights ---
  const f = flightArtifact?.data ?? {};
  const normalized = normalizeFlightOptions(f.options);
  const optionsText = buildOptionsText(normalized);

  // options：建议写 normalized（用于 Select 展示/详情）
  if (bindings?.flights?.options)
    dmWrite(surfaceId, res, bindings.flights.options, normalized);

  // optionsText：用于 Card 快速展示（若 UI 绑定了它）
  if (bindings?.flights?.optionsText)
    dmWrite(surfaceId, res, bindings.flights.optionsText, optionsText);

  // selectedIndex / detail
  const selectedIndex = normalized.length ? 0 : -1;
  const selected = selectedIndex >= 0 ? normalized[selectedIndex] : null;

  if (bindings?.flights?.selectedIndex)
    dmWrite(surfaceId, res, bindings.flights.selectedIndex, selectedIndex);
  if (bindings?.flights?.detailText)
    dmWrite(
      surfaceId,
      res,
      bindings.flights.detailText,
      formatOptionDetail(selected)
    );
  if (bindings?.flights?.detailImage)
    dmWrite(
      surfaceId,
      res,
      bindings.flights.detailImage,
      selected?.image_url || ""
    );

  // debug：需要的话写一个 raw（前端不绑）
  // dmWrite(surfaceId, res, "/flights/raw", safeJson(flightArtifact?.data ?? {}));
}

// ====== 静态前端 ======
app.use("/", express.static(path.join(__dirname, "web")));

// UI Stream（SSE）
app.get("/ui/stream", (req, res) => {
  const surfaceId = String(req.query.surfaceId || "main");
  setSseHeaders(res);

  const pingTimer = setInterval(() => res.write(":\n\n"), 15000);

  const old = sseBySurface.get(surfaceId);
  if (old?.pingTimer) clearInterval(old.pingTimer);
  sseBySurface.set(surfaceId, { res, pingTimer });

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

  const bindings = loadBindings();
  const queryPath = bindings?.form?.query || "/form/query";
  const query = String(userAction?.context?.query || "");
  if (!query.trim()) return res.status(400).json({ error: "Empty query" });

  // Loading：写到 bindings 对应字段
  if (bindings?.weather?.tempText)
    dmWrite(surfaceId, conn.res, bindings.weather.tempText, "查询中...");
  if (bindings?.flights?.optionsText)
    dmWrite(surfaceId, conn.res, bindings.flights.optionsText, "查询中...");
  if (bindings?.flights?.options)
    dmWrite(surfaceId, conn.res, bindings.flights.options, []);
  if (bindings?.flights?.selectedIndex)
    dmWrite(surfaceId, conn.res, bindings.flights.selectedIndex, -1);
  if (bindings?.flights?.detailText)
    dmWrite(surfaceId, conn.res, bindings.flights.detailText, "查询中...");
  if (bindings?.flights?.detailImage)
    dmWrite(surfaceId, conn.res, bindings.flights.detailImage, "");

  // 可选：把 query 写回 dataModel（如果你希望 dataModel 始终同步）
  dmWrite(surfaceId, conn.res, queryPath, query);

  try {
    const [weatherArtifact, flightArtifact] = await Promise.all([
      sendSubscribe(WEATHER_AGENT_URL, { query }),
      sendSubscribe(FLIGHT_AGENT_URL, { query }),
    ]);

    sendResultUI(surfaceId, conn.res, weatherArtifact, flightArtifact);
    return res.json({ ok: true });
  } catch (e) {
    const msg = `ERROR: ${String(e?.message || e)}`;

    if (bindings?.weather?.tempText)
      dmWrite(surfaceId, conn.res, bindings.weather.tempText, msg);
    if (bindings?.flights?.optionsText)
      dmWrite(surfaceId, conn.res, bindings.flights.optionsText, msg);

    return res.status(500).json({ error: msg });
  }
});

app.get("/health", (req, res) => res.json({ ok: true, service: "main-agent" }));

app.listen(PORT, () => {
  console.log(`[main-agent] listening on http://localhost:${PORT}`);
});
