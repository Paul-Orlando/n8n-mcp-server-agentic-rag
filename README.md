# Course Transcription Chat

A minimal full-stack chat app that lets you ask questions about course content. It searches 35 course transcripts stored in Pinecone and answers using Gemini Flash 2.5 via OpenRouter.

## Architecture

```
User → Express backend → Pinecone (semantic search) → OpenRouter/Gemini → streamed response
```

No MCP server required. No n8n dependency. You own the full stack.

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
```

## Run locally

```bash
npm run dev
```

Open http://localhost:3000

## Deploy to Railway

1. Push this repo to GitHub
2. Go to railway.app → New Project → Deploy from GitHub
3. Add environment variables in Railway dashboard
4. Railway auto-detects Node.js and runs `npm start`

> Railway is recommended over Vercel because SSE streaming requires long-lived connections that don't work well with Vercel's serverless functions.

## Cost

- OpenRouter/Gemini Flash 2.5: very cheap (~$0.00015/1K tokens)
- Pinecone: free tier supports this use case
- Railway: free tier available
