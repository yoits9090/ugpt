import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";

const app = express();
const PORT = process.env.PORT || 3001;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const EXA_API_KEY = process.env.EXA_API_KEY || "";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.MODEL || "meta-llama/llama-3.1-8b-instruct:free";
const IMAGE_MODEL = "bytedance-seed/seedream-4.5";
const DAILY_BUDGET = parseFloat(process.env.DAILY_BUDGET || "1.00");
const IMAGE_DAILY_LIMIT = 5;

// --- Tool definitions ---
const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "generate_image",
      description:
        "Generate an image based on a text description. Use this when the user asks you to create, generate, draw, or make an image, picture, or illustration.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "A detailed description of the image to generate. Be descriptive about style, composition, colors, etc.",
          },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description:
        "Search the web for current information. Use this when the user asks about recent events, needs up-to-date facts, wants to look something up, or asks a question that benefits from web results.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to find relevant information on the web.",
          },
        },
        required: ["query"],
      },
    },
  },
];

// --- Global daily budget tracker ---
let dailySpend = 0;
let lastResetDate = new Date().toDateString();

function checkAndResetDaily() {
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    dailySpend = 0;
    lastResetDate = today;
    imageUsage.clear();
    console.log(`Daily budget reset. Limit: $${DAILY_BUDGET}`);
  }
}

function addSpend(cost: number) {
  dailySpend += cost;
  console.log(`Daily spend: $${dailySpend.toFixed(4)} / $${DAILY_BUDGET}`);
}

// --- Image rate limiting (per IP, 5/day) ---
const imageUsage = new Map<string, number>();

function checkImageLimit(ip: string): boolean {
  const count = imageUsage.get(ip) || 0;
  return count < IMAGE_DAILY_LIMIT;
}

function addImageUsage(ip: string) {
  const count = imageUsage.get(ip) || 0;
  imageUsage.set(ip, count + 1);
  console.log(`Image usage for ${ip}: ${count + 1}/${IMAGE_DAILY_LIMIT}`);
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

// --- Generate image via OpenRouter ---
async function generateImage(prompt: string): Promise<string> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://ugpt.ca",
      "X-Title": "ugpt",
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Image API error: ${response.status}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;

  if (message?.images && Array.isArray(message.images)) {
    for (const img of message.images) {
      if (img.type === "image_url" && img.image_url?.url) return img.image_url.url;
    }
  }

  const content = message?.content;
  if (typeof content === "string" && content.length > 0) return content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part.type === "image_url") return part.image_url?.url || "";
    }
  }

  throw new Error("No image in response");
}

// --- Search via Exa.ai ---
async function searchWeb(query: string): Promise<{ text: string; urls: string[] }> {
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "x-api-key": EXA_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      numResults: 5,
      type: "auto",
      contents: {
        text: { maxCharacters: 1000 },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Exa API error: ${response.status}`);
  }

  const data = await response.json();
  const results = data.results || [];

  const urls = results.map((r: { url?: string }) => r.url || "").filter(Boolean);

  const text = results
    .map(
      (r: { title?: string; url?: string; text?: string }, i: number) =>
        `[${i + 1}] ${r.title || "Untitled"}\n${r.url || ""}\n${r.text || ""}`
    )
    .join("\n\n");

  return { text, urls };
}

// --- Stream a follow-up response after tool results ---
async function streamFollowUp(
  messages: unknown[],
  toolCallId: string,
  toolName: string,
  toolResult: string,
  res: express.Response
) {
  const followUpMessages = [
    ...messages,
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: toolCallId,
          type: "function",
          function: { name: toolName, arguments: "{}" },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: toolCallId,
      content: toolResult + "\n\n---\nIMPORTANT: At the end of your response, include a 'Sources' section with markdown links to the sources you used. Format: [Title](url). Only include sources you actually referenced.",
    },
  ];

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
      messages: followUpMessages,
      stream: true,
    }),
  });

  if (!response.ok) {
    res.write(
      `data: ${JSON.stringify({
        choices: [{ delta: { content: "Failed to process search results." } }],
      })}\n\n`
    );
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6);
      if (raw === "[DONE]") continue;

      try {
        const data = JSON.parse(raw);
        const content = data.choices?.[0]?.delta?.content;
        if (content) {
          res.write(line + "\n");
        }
        if (data.usage) {
          const cost =
            data.total_cost || (data.usage.total_tokens || 0) * 0.000001;
          addSpend(cost);
        }
      } catch {
        // skip
      }
    }
  }
}

app.post("/api/chat", async (req, res) => {
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
        tools: TOOLS,
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
    let sseBuffer = "";
    const toolCalls: { id: string; name: string; arguments: string }[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) {
          res.write(line + "\n");
          continue;
        }

        const raw = line.slice(6);
        if (raw === "[DONE]") continue;

        try {
          const data = JSON.parse(raw);
          const delta = data.choices?.[0]?.delta;
          const finishReason = data.choices?.[0]?.finish_reason;

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCalls[idx]) {
                toolCalls[idx] = { id: tc.id || "", name: tc.function?.name || "", arguments: "" };
              }
              if (tc.id) toolCalls[idx].id = tc.id;
              if (tc.function?.name) toolCalls[idx].name = tc.function.name;
              if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
            }
          } else if (delta?.content) {
            res.write(line + "\n");
          } else if (data.usage) {
            const cost = data.total_cost || (data.usage.total_tokens || 0) * 0.000001;
            addSpend(cost);
            res.write(line + "\n");
          } else if (finishReason === "tool_calls") {
            // skip
          } else {
            res.write(line + "\n");
          }
        } catch {
          res.write(line + "\n");
        }
      }
    }

    // Handle tool calls after stream ends
    if (toolCalls.length > 0) {
      for (const tc of toolCalls) {
        if (tc.name === "generate_image") {
          let args: { prompt: string };
          try {
            args = JSON.parse(tc.arguments);
          } catch {
            res.write(`data: ${JSON.stringify({ type: "image_error", error: "Invalid tool arguments" })}\n\n`);
            continue;
          }

          const ip = req.ip || req.socket.remoteAddress || "unknown";

          if (!checkImageLimit(ip)) {
            res.write(`data: ${JSON.stringify({ type: "image_error", error: "Daily image limit reached (5/day)" })}\n\n`);
            continue;
          }

          res.write(`data: ${JSON.stringify({ type: "image_generating", prompt: args.prompt })}\n\n`);

          try {
            const imageUrl = await generateImage(args.prompt);
            addImageUsage(ip);
            addSpend(0.03);
            res.write(`data: ${JSON.stringify({ type: "image_result", url: imageUrl, prompt: args.prompt })}\n\n`);
          } catch (err) {
            console.error("Image generation error:", err);
            res.write(`data: ${JSON.stringify({ type: "image_error", error: "Image generation failed" })}\n\n`);
          }
        } else if (tc.name === "web_search") {
          let args: { query: string };
          try {
            args = JSON.parse(tc.arguments);
          } catch {
            res.write(`data: ${JSON.stringify({ type: "search_error", error: "Invalid search arguments" })}\n\n`);
            continue;
          }

          res.write(`data: ${JSON.stringify({ type: "searching", query: args.query })}\n\n`);

          try {
            const { text: results, urls } = await searchWeb(args.query);
            console.log(`Search: "${args.query}" — ${results.length} chars, ${urls.length} sources`);

            // Send source URLs for favicon display
            res.write(`data: ${JSON.stringify({ type: "search_sources", urls })}\n\n`);

            // Send results back to the model for a synthesized answer
            await streamFollowUp(messages, tc.id, "web_search", results, res);


            res.write(`data: ${JSON.stringify({ type: "search_done" })}\n\n`);
          } catch (err) {
            console.error("Search error:", err);
            res.write(`data: ${JSON.stringify({ type: "search_error", error: "Search failed" })}\n\n`);
          }
        }
      }
    }

    res.write("data: [DONE]\n\n");
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
  console.log(`Image model: ${IMAGE_MODEL} (${IMAGE_DAILY_LIMIT}/day per IP)`);
  console.log(`Search: Exa.ai ${EXA_API_KEY ? "configured" : "NOT configured"}`);
});
