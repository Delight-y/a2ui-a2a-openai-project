import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = Number(process.env.FLIGHT_PORT || 3002);
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

function sseWrite(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

app.get("/.well-known/agent-card.json", (req, res) => {
  res.json({
    name: "flight-agent",
    version: "0.0.1",
    endpoints: {
      sendSubscribe: `http://localhost:${PORT}/tasks/sendSubscribe`,
    },
  });
});

app.post("/tasks/sendSubscribe", async (req, res) => {
  const { input } = req.body || {};
  const prompt = String(input?.query || "");

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.write(":\n\n");

  const taskId = `f_${Date.now()}`;
  sseWrite(res, { type: "status", taskId, stage: "started" });

  try {
    const completion = await openai.chat.completions.create({
      model: "turing/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "你是机票子Agent（当前无真实航司数据）。请输出严格JSON，不要多余文本。字段: from, to, date, options(数组, 每项含 id, airline, depart, arrive, duration, price_cny, notes)。返回3条options。",
        },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() || "{}";
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = {
        from: "unknown",
        to: "unknown",
        date: "unknown",
        options: [
          {
            id: "fallback-1",
            airline: "N/A",
            depart: "N/A",
            arrive: "N/A",
            duration: "N/A",
            price_cny: null,
            notes: raw.slice(0, 140),
          },
        ],
      };
    }

    sseWrite(res, { type: "status", taskId, stage: "completed" });
    sseWrite(res, {
      type: "final",
      taskId,
      artifact: { kind: "flights", data },
    });
    res.end();
  } catch (e) {
    sseWrite(res, { type: "final", taskId, error: String(e?.message || e) });
    res.end();
  }
});

app.get("/health", (req, res) =>
  res.json({ ok: true, service: "flight-agent" })
);

app.listen(PORT, () => {
  console.log(`[flight-agent] listening on http://localhost:${PORT}`);
});
