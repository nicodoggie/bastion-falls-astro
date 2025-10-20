# Zarifa Bot (Cloudflare Worker)

Discord slash-command bot deployed on Cloudflare Workers, using Cloudflare AI Search.

## Endpoints

- POST `/interactions` — Discord interaction endpoint
- GET `/health` — health check

## Env / Bindings

- `DISCORD_PUBLIC_KEY` (secret)
- `DISCORD_BOT_TOKEN` (secret)
- `DISCORD_APPLICATION_ID` (var)
- `AI_SEARCH_INDEX` (var)
- `[ai]` binding → `AI`

## Dev

```bash
yarn --cwd packages/zarifa-bot dev
```

## Deploy

```bash
yarn --cwd packages/zarifa-bot deploy
```
