# ugpt

<https://ugpt.ca>

ugpt is a minimalist canvas-based AI chat app. The frontend is a Next.js app with a node-based chat canvas, and the backend is a small Express server that proxies model, image, and web-search requests.

## Stack

- Next.js 16 + React 19
- `@xyflow/react` for the canvas UI
- Express backend for chat streaming, image generation, and search
- OpenRouter for model and image requests
- Exa for web search

## Local development

Install dependencies in both app roots:

```bash
npm install
cd server && npm install
```

Create local env files from the examples:

```bash
cp .env.example .env
cp server/.env.example server/.env
```

Run the backend:

```bash
cd server
npm run dev
```

Run the frontend:

```bash
npm run dev
```

Open <http://localhost:3000>.

## Environment

Frontend envs are optional for local development because the Next.js API route falls back to `http://localhost:3001`.

Backend envs:

- `OPENROUTER_API_KEY`
- `EXA_API_KEY`
- `MODEL` (optional)
- `DAILY_BUDGET` (optional)
- `CORS_ORIGINS` (optional)

## Deployment notes

- Production site: <https://ugpt.ca>
- Backend origin allowlist already includes `https://ugpt.ca` and `https://www.ugpt.ca`
- Deployment helper scripts live in [`deploy-scripts/`](/Users/ace/projects/ugpt/deploy-scripts)

## Open-source note

This repository is licensed under the GNU Affero General Public License v3.0 or later. See [LICENSE](/Users/ace/projects/ugpt/LICENSE).
