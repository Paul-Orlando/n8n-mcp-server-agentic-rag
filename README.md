# Course Transcription Chat

An AI-powered chat app that lets you ask questions about course content. It searches 35 course transcripts stored in Pinecone and answers using Gemini Flash 2.5 via OpenRouter.

## The Evolution of This Project

This project started as an MCP (Model Context Protocol) demo built on top of n8n. The original architecture looked like this:

```
User → Express backend → Anthropic API (with MCP) → n8n MCP server → Pinecone → response
```

While that worked, it had a few drawbacks:
- Required an active n8n subscription
- Added latency through an extra hop
- Depended on a third-party service for core functionality

So we evolved it. The current architecture cuts out n8n and MCP entirely, calling Pinecone directly from the backend:

```
User → Express backend → Pinecone (direct search) → OpenRouter/Gemini → response
```

The result is faster, cheaper, and fully owned — no subscriptions beyond Pinecone's free tier and OpenRouter's pay-per-use pricing.

This evolution is a good example of how real projects start with convenience (n8n + MCP) and then migrate to owned infrastructure as they mature.

## Architecture

- **Frontend:** Plain HTML/CSS/JS with streaming SSE
- **Backend:** Node.js + Express + TypeScript
- **Embeddings:** OpenAI text-embedding-3-small via OpenRouter
- **Vector search:** Pinecone (index: mcp-server-v1, namespace: mcp-research)
- **LLM:** Google Gemini Flash 2.5 via OpenRouter

## Prerequisites

- Node.js 18+
- OpenRouter account + API key (openrouter.ai)
- Pinecone account + API key with index `mcp-server-v1`

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your .env file
copy .env.example .env   # Windows
cp .env.example .env     # Mac/Linux

# 3. Add your keys to .env
OPENROUTER_API_KEY=your_key_here
PINECONE_API_KEY=your_key_here
PINECONE_INDEX=mcp-server-v1
PORT=3000
```

## Run Locally

```bash
npm run dev
```

Open http://localhost:3000

## Deploy to Railway

1. Push this repo to GitHub
2. Go to railway.app → New Project → Deploy from GitHub
3. Add environment variables in Railway dashboard:
   - `OPENROUTER_API_KEY`
   - `PINECONE_API_KEY`
   - `PINECONE_INDEX`
4. Railway auto-detects Node.js and runs `npm start`

> Railway is recommended over Vercel because SSE streaming requires long-lived connections that don't work well with Vercel's serverless functions.

## Cost

- OpenRouter/Gemini Flash 2.5: very cheap (~$0.00015/1K tokens)
- Pinecone: free tier supports this use case
- Railway: free tier available

## What We Learned

- MCP is powerful but adds complexity and dependency
- Direct Pinecone search is faster and simpler for this use case
- OpenRouter makes it easy to swap models without changing code
- Owning your stack beats subscription services for long-term projects
