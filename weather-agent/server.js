import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = Number(process.env.WEATHER_PORT || 3001);
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

function sseWrite(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

// 拉取 Agent Card
app.get("/.well-known/agent-card.json", (req, res) => {
  res.json({
    name: "weather-agent",
    version: "0.0.1",
    endpoints: {
      sendSubscribe: `http://localhost:${PORT}/tasks/sendSubscribe`,
    },
  });
});

app.post("/tasks/sendSubscribe", async (req, res) => {
  // 简化：A2A-like SSE（主 Agent 订阅直到 final）
  const { input } = req.body || {};
  const prompt = String(input?.query || "");

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.write(":\n\n");

  const taskId = `w_${Date.now()}`;

  sseWrite(res, { type: "status", taskId, stage: "started" });

  try {
    const completion = await openai.chat.completions.create({
      model: "turing/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "你是天气子Agent。请输出严格JSON，不要多余文本。字段: city, date, summary, temp_c_low, temp_c_high, precip_prob, advice。",
        },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() || "{}";
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      // 兜底：如果模型没严格 JSON，仍给一个可用结构
      data = {
        city: "unknown",
        date: "unknown",
        summary: raw.slice(0, 120),
        temp_c_low: null,
        temp_c_high: null,
        precip_prob: null,
        advice: "无法解析严格JSON，已降级为摘要。",
      };
    }

    sseWrite(res, { type: "status", taskId, stage: "completed" });
    sseWrite(res, {
      type: "final",
      taskId,
      artifact: { kind: "weather", data },
    });
    res.end();
  } catch (e) {
    sseWrite(res, { type: "final", taskId, error: String(e?.message || e) });
    res.end();
  }
});

app.get("/health", (req, res) =>
  res.json({ ok: true, service: "weather-agent" })
);

app.listen(PORT, () => {
  console.log(`[weather-agent] listening on http://localhost:${PORT}`);
});
