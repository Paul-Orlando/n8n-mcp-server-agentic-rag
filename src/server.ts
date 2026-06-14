import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { Pinecone } from "@pinecone-database/pinecone";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const PINECONE_API_KEY = process.env.PINECONE_API_KEY || "";
const PINECONE_INDEX = process.env.PINECONE_INDEX || "mcp-server-v1";

// ── Pinecone client ──────────────────────────────────────────────────────────
const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });

// ── Embed a query using OpenRouter's embedding endpoint ──────────────────────
// OpenRouter proxies OpenAI-compatible embeddings via text-embedding-3-small
// which produces 1536-dim vectors matching your Pinecone index.
async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
}

// ── Search Pinecone for relevant transcript chunks ───────────────────────────
async function searchTranscripts(query: string, topK = 5): Promise<string> {
  const vector = await embedQuery(query);
  const index = pinecone.index(PINECONE_INDEX).namespace("arxiv-papers");

  const results = await index.query({
    vector,
    topK,
    includeMetadata: true,

  });

  if (!results.matches || results.matches.length === 0) {
    return "No relevant transcript content found.";
  }

  // Concatenate the top matching chunks into a context block
  return results.matches
    .map((m, i) => {
      const text = (m.metadata?.text as string) || (m.metadata?.content as string) || "";
      const source = (m.metadata?.source as string) || (m.metadata?.filename as string) || "transcript";
      return `[${i + 1}] Source: ${source}\n${text}`;
    })
    .join("\n\n---\n\n");
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

  // Set up SSE headers for streaming
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event: string, data: string) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // 1. Search Pinecone for relevant context
    send("status", "Searching course transcripts...");
    const context = await searchTranscripts(message);

    // 2. Build messages array with context injected as system context
    const systemPrompt = `You are a helpful assistant for an AI/automation course. 
You have access to course transcript content retrieved from a knowledge base.
Use the following transcript excerpts to answer the user's question accurately.
If the transcripts don't contain relevant information, say so honestly.

TRANSCRIPT CONTEXT:
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
        "X-Title": "MCP Transcription Chat",
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

    // 4. Stream chunks back to the frontend
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
  res.json({ status: "ok", model: "google/gemini-2.5-flash", index: PINECONE_INDEX });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`📚 Pinecone index: ${PINECONE_INDEX}`);
  console.log(`🤖 Model: model: "google/gemini-2.5-flash", via OpenRouter\n`);
});
