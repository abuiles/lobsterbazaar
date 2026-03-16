# AGENTS.md

## Scope

This repo runs on Cloudflare Workers.

Do not rely on memory for Cloudflare APIs, limits, bindings, or product behavior. Check current docs first.

## Cloudflare docs

Use the official docs for any Workers-related work:

- `https://developers.cloudflare.com/workers/`
- `https://docs.mcp.cloudflare.com/mcp`

For limits and quotas, use the product-specific `platform/limits` page.

Examples:

- `https://developers.cloudflare.com/workers/platform/limits/`
- `https://developers.cloudflare.com/d1/platform/limits/`

## Products covered by this rule

Always refresh docs before changing code that touches:

- Workers
- Durable Objects
- KV
- R2
- D1
- Queues
- Vectorize
- Workers AI
- Agents SDK
- AI Gateway

## Commands

Common commands in this repo:

- `npm run test`
- `npm run typecheck`
- `npm run check`
- `npx wrangler dev`
- `npx wrangler deploy`

If bindings change in `wrangler.jsonc`, run:

- `npx wrangler types`

## Validation before commit or push

Before committing or pushing code changes:

1. Run `npm run typecheck`
2. Run `npm run test`

If either fails, do not commit or push until the failure is fixed or clearly explained.

## Runtime references

Useful references:

- Node compatibility: `https://developers.cloudflare.com/workers/runtime-apis/nodejs/`
- Workers errors: `https://developers.cloudflare.com/workers/observability/errors/`

# SECURITY

- **NEVER commit** API keys.
- **NEVER commit** `.dev.vars`.
- `wrangler.jsonc` contains Cloudflare account IDs (not secret but do not expose). If an ID gets added then interpolate it like this:

```json
{
  "binding": "DB",
  "database_name": "my-sandbox-tenant-db",
  "database_id": "${DB_ID}"
}
```
