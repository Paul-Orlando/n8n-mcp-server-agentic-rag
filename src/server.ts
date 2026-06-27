import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "https://pinecone-mcp-server-production-189c.up.railway.app/mcp";
const MCP_API_KEY = process.env.MCP_API_KEY || "";

// ── Call agentic-search tool via MCP server ───────────────────────────────────
async function searchViaMCP(query: string, topK = 5): Promise<string> {
  const res = await fetch(MCP_SERVER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "X-API-Key": MCP_API_KEY,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "agentic-search",
        arguments: { query, topK },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MCP search failed: ${res.status} ${err}`);
  }

  const text = await res.text();
  const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
  if (!dataLine) throw new Error("No data in MCP response");

  const parsed = JSON.parse(dataLine.slice(5).trim());

  if (parsed.error) {
    throw new Error(`MCP error: ${parsed.error.message}`);
  }

  return parsed.result?.content?.[0]?.text || "No results found.";
}

// ── POST /chat — main endpoint ───────────────────────────────────────────────
app.post("/chat", async (req: Request, res: Response) => {
  const { message, history } = req.body as {
    message: string;
    history?: { role: string; content: string }[];
  };

  if (!message?.trim()) {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event: string, data: string) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // 1. Search via MCP server
    send("status", "Searching knowledge base via MCP...");
    const context = await searchViaMCP(message);

    // 2. Build system prompt with context
    const systemPrompt = `You are a helpful GenAI research assistant covering AI Agents, RAG, MCP, and Prompt Engineering.
You have access to content retrieved from a knowledge base of ArXiv research papers via an MCP server.
Use the following excerpts to answer the user's question accurately.
If the content does not contain relevant information, say so honestly.

KNOWLEDGE BASE CONTEXT:
${context}`;

    const messages = [
      ...(history || []),
      { role: "user", content: message },
    ];

    // 3. Stream response from OpenRouter using Gemini Flash 2.5
    send("status", "Generating response...");

    const openRouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "GenAI Concepts Chat",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
      }),
    });

    if (!openRouterRes.ok) {
      const err = await openRouterRes.text();
      throw new Error(`OpenRouter error: ${openRouterRes.status} ${err}`);
    }

    const reader = openRouterRes.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) throw new Error("No response body from OpenRouter");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n").filter((l) => l.startsWith("data:"));

      for (const line of lines) {
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          const text = parsed.choices?.[0]?.delta?.content;
          if (text) send("chunk", text);
        } catch {
          // skip malformed chunks
        }
      }
    }

    send("done", "");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    send("error", message);
  } finally {
    res.end();
  }
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    model: "google/gemini-2.5-flash",
    mcp_server: MCP_SERVER_URL,
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`🔌 MCP Server: ${MCP_SERVER_URL}`);
  console.log(`🤖 Model: google/gemini-2.5-flash via OpenRouter\n`);
});
