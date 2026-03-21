# Lobster Bazaar

<img src="./public/assets/mascots/lobsterbazaar-default.jpg" alt="LobsterBazaar mascot" width="420">

Lobster Bazaar is a lightweight engine for agent-facing merchant discovery, Storefront MCP handoff, and checkout-boundary cart orchestration.

It is the reusable marketplace layer behind deploys like [Lobster Brew](https://lobsterbrew.com/). A buyer-side agent can use it to discover merchants, inspect active offers, resolve the right merchant MCP endpoint, build a cart, and hand checkout back to the human owner.

## What it does

Lobster Bazaar owns the directory and routing layer, not the merchant catalog itself.

- Publishes an agent-readable `skill.md` install surface
- Registers buyer and merchant claws
- Serves country-based merchant discovery and offer discovery
- Resolves a merchant's Storefront MCP endpoint
- Returns cart attribution rules so merchants can trace claw-driven handoffs

The merchant remains the source of truth for catalog, inventory, cart state, and checkout URLs.

## How it works

1. A claw reads `GET /skill.md` and registers with `POST /claws/register`.
2. The claw discovers merchants and offers through country-based artifacts.
3. The claw selects a merchant and requests `GET /merchants/{slug}/connect`.
4. The merchant's Shopify Storefront MCP handles catalog search, cart updates, and checkout URL generation.
5. The claw returns the checkout URL to the human for approval and payment.

## Runtime surface

The Worker currently provides:

- `GET /`
- `GET /skill.md`
- `POST /claws/register`
- `GET /countries/{country_code}`
- `GET /offers/{country_code}`
- `GET /merchants/{slug}/connect`
- `POST /internal/materialize`
- `POST /internal/metrics/materialize`

`D1` is the control plane. `R2` is the public artifact plane.

## Specs and docs

- [LobsterBazaar Spec V0](./specs/spec.md)
- [V0 Build Plan](./plans/2026-03-15-feat-lobsterbazaar-v0-directory-mcp-handoff-plan.md)
- [Analytics Engine metrics](./docs/analytics-engine.md)

Recommended reading order:

1. System map
2. Object model
3. BYO merchant deploy model
4. Merchant manifest and offer schema
5. Buyer claw request flow
6. Agent bootstrap skill
7. API contracts
8. V0 build plan

## Example deploy package

The repo includes a reference deploy package at [`deploys/example`](./deploys/example):

- [`config.json`](./deploys/example/config.json)
- [`categories.json`](./deploys/example/categories.json)
- [`merchants.csv`](./deploys/example/merchants.csv)
- [`offers.json`](./deploys/example/offers.json)

Deploy packages can also set lightweight brand presentation fields such as:

- `brand_name`
- `emoji`

That package is the canonical local example for:

- deploy config loading
- merchant manifest parsing
- claim import
- offer import
- deterministic SQL generation
- deterministic artifact materialization

## Local development

Install dependencies and run the normal checks:

```bash
npm install
npm run typecheck
npm test
```

Before using the Worker with real data, create the local D1 schema and load sample records:

```bash
cp .dev.vars.example .dev.vars
npx wrangler d1 execute lobsterbazaar --local --file migrations/0001_init.sql
npx wrangler d1 execute lobsterbazaar --local --file seeds/example.sql
```

Run local D1 setup before starting `wrangler dev`. If the dev server is already running, stop it before executing local D1 commands or SQLite may return `database is locked`.

`.dev.vars` controls the runtime deploy identity used by the local worker. In particular:

- `DEPLOY_ID` controls the claw API key prefix and `lb_source__` cart attribute
- `VERTICAL_ID` controls the shared Analytics Engine sampling key and defaults to `DEPLOY_ID` when unset
- `BRAND_NAME`, `DEPLOY_DOMAIN`, and `VERTICAL_SUMMARY` control the runtime `GET /skill.md`
- `DEPLOY_EMOJI` controls the landing-page install heading emoji
- `DEPLOY_MASCOT_URL` optionally overrides the landing-page mascot; otherwise the default mascot in `public/assets/mascots/lobsterbazaar-default.jpg` is used
- `OPERATOR_TOKEN` is required for `POST /internal/materialize`

If you change those values, restart `wrangler dev` and rematerialize artifacts so the cached `skill.md` matches the current runtime config.

After local D1 setup and materialization are complete, start the worker:

```bash
npm run dev
```

Useful local checks:

```bash
curl http://127.0.0.1:8787/skill.md
curl http://127.0.0.1:8787/countries/US
curl http://127.0.0.1:8787/offers/US
curl http://127.0.0.1:8787/merchants/sample-roaster/connect
```

## Deploy and import workflow

Keep real deploy packages under [`deploys/private`](./deploys/private/).

- `deploys/example` is the committed reference package
- `deploys/private/<deploy-id>/` is for real operator-managed deploy data
- files under `deploys/private/` are ignored by git, except for the placeholder docs in that directory
- materialize public artifacts from private deploys, but do not commit the raw deploy package by default

For deploy packages, keep instance identity in `config.json`, define explicit categories in `categories.json`, and assign merchant category membership through the `category_slugs` column in `merchants.csv`.

For branding, set the same fields in `config.json` when you want generated artifacts to carry them too. For example:

```json
{
  "deploy_id": "lobsterbrew",
  "brand_name": "Lobster Brew",
  "emoji": "🦞",
  "directory_summary": "Merchant discovery for lobsters."
}
```

Generate deterministic SQL from a deploy package:

```bash
npm run build:deploy:sql -- deploys/example build/example.sql
```

This form writes clean SQL directly to disk and creates parent directories when needed.

For V0, deploy packages must keep:

- `public_directory: true`
- `offers_enabled: true`
- `claim_mode: "operator_managed"`

Load that SQL into local D1:

```bash
npx wrangler d1 execute lobsterbazaar --local --file build/example.sql
```

If `wrangler dev` is already running, stop it first or local SQLite may return `database is locked`.

Then materialize the public artifacts into the bound R2 bucket:

```bash
curl -X POST http://127.0.0.1:8787/internal/materialize \
  -H "Authorization: Bearer replace-me"
```

To process only records added after a timestamp:

```bash
curl -X POST "http://127.0.0.1:8787/internal/materialize?since=2026-03-15T00:00:00Z" \
  -H "Authorization: Bearer replace-me"
```

If operators materialize artifacts outside the Worker, update the Analytics Engine snapshot without rematerializing:

```bash
curl -X POST http://127.0.0.1:8787/internal/metrics/materialize \
  -H "Authorization: Bearer replace-me"
```

## Offline review artifact workflow

Generate local review artifacts directly from the same deploy package:

```bash
npm run build:deploy:artifacts -- deploys/example build/example
```

The output directory is regenerated from scratch on each successful run. Failed runs keep the previous artifact set in place.

For deterministic regeneration, every `offers.json` entry must include a stable `offer_id`.

That writes:

- `build/example/skill.md`
- `build/example/countries/*.json`
- `build/example/offers/*.json`
- `build/example/merchants/*.json`
