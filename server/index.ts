import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";

const app = express();
const PORT = process.env.PORT || 3001;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.MODEL || "meta-llama/llama-3.1-8b-instruct:free";
const DAILY_BUDGET = parseFloat(process.env.DAILY_BUDGET || "1.00");

// --- Global daily budget tracker ---
let dailySpend = 0;
let lastResetDate = new Date().toDateString();

function checkAndResetDaily() {
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    dailySpend = 0;
    lastResetDate = today;
    console.log(`Daily budget reset. Limit: $${DAILY_BUDGET}`);
  }
}

function addSpend(cost: number) {
  dailySpend += cost;
  console.log(`Daily spend: $${dailySpend.toFixed(4)} / $${DAILY_BUDGET}`);
}

// --- CORS ---
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3002",
      "https://ugpt.ca",
      "https://www.ugpt.ca",
    ],
  })
);

app.use(express.json());

// --- Rate limits: 10 req/min per IP ---
app.use(
  "/api/chat",
  rateLimit({
    windowMs: 60_000,
    max: 10,
    message: { error: "Rate limit: max 10 requests per minute" },
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// --- Rate limits: 100 req/day per IP ---
app.use(
  "/api/chat",
  rateLimit({
    windowMs: 24 * 60 * 60_000,
    max: 100,
    message: { error: "Daily limit: max 100 requests per day" },
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.post("/api/chat", async (req, res) => {
  // Check daily budget
  checkAndResetDaily();
  if (dailySpend >= DAILY_BUDGET) {
    res.status(429).json({ error: "Daily budget exceeded. Try again tomorrow." });
    return;
  }

  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: "messages array required" });
    return;
  }

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ugpt.ca",
        "X-Title": "ugpt",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      res.status(response.status).json({ error: errorText });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const reader = response.body?.getReader();
    if (!reader) {
      res.status(500).json({ error: "No response body" });
      return;
    }

    const decoder = new TextDecoder();
    let fullResponse = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);
      fullResponse += chunk;
    }

    // Parse cost from OpenRouter's final response if available
    // OpenRouter includes generation stats in the last SSE chunk
    try {
      const lines = fullResponse.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ") && line.includes('"usage"')) {
          const data = JSON.parse(line.slice(6));
          const usage = data.usage;
          if (usage) {
            // Estimate cost: OpenRouter returns total_cost in some responses
            const cost = data.total_cost || (usage.total_tokens || 0) * 0.000001;
            addSpend(cost);
          }
        }
      }
    } catch {
      // If we can't parse cost, estimate conservatively
      addSpend(0.0003);
    }

    res.end();
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/health", (_req, res) => {
  checkAndResetDaily();
  res.json({
    status: "ok",
    dailySpend: `$${dailySpend.toFixed(4)}`,
    dailyBudget: `$${DAILY_BUDGET}`,
    remaining: `$${Math.max(0, DAILY_BUDGET - dailySpend).toFixed(4)}`,
  });
});

app.listen(PORT, () => {
  console.log(`ugpt server running on port ${PORT}`);
  console.log(`Rate limits: 10/min, 100/day per IP`);
  console.log(`Daily budget: $${DAILY_BUDGET}`);
});
