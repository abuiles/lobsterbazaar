# LobsterBazaar

`lobsterbazaar` is a lightweight Cloudflare Worker engine for agent-facing merchant discovery, Storefront MCP handoff, and checkout-boundary cart orchestration.

The repo now contains both the V0 specs and the first runnable implementation skeleton.

## Docs

- [System Map V0](./specs/2026-03-15-system-map-v0.md)
- [Object Model V0](./specs/2026-03-15-object-model-v0.md)
- [BYO Merchant Deploy Model](./specs/2026-03-15-byo-merchant-deploy-model.md)
- [Merchant Manifest And Offer Schema](./specs/2026-03-15-merchant-manifest-and-offer-schema.md)
- [Buyer Claw Request Flow](./specs/2026-03-15-buyer-claw-request-flow.md)
- [Agent Bootstrap Skill V0](./specs/2026-03-15-agent-bootstrap-skill-v0.md)
- [API Contracts V0](./specs/2026-03-15-api-contracts-v0.md)
- [V0 Build Plan](./plans/2026-03-15-feat-lobsterbazaar-v0-directory-mcp-handoff-plan.md)

## Reading order

1. System map
2. Object model
3. BYO merchant deploy model
4. Merchant manifest and offer schema
5. Buyer claw request flow
6. Agent bootstrap skill
7. API contracts
8. V0 build plan

## Runtime

The Worker currently provides:

- `GET /`
- `GET /skill.md`
- `POST /claws/register`
- `GET /countries/{country_code}`
- `GET /offers/{country_code}`
- `GET /merchants/{slug}/connect`
- `POST /internal/materialize`

`D1` is the control plane. `R2` is the public artifact plane.

## Example deploy package

The repo now includes a deploy package at [`deploys/example`](./deploys/example):

- [`config.json`](./deploys/example/config.json)
- [`merchants.csv`](./deploys/example/merchants.csv)
- [`offers.json`](./deploys/example/offers.json)

That package is the canonical local example for:

- deploy config loading
- merchant manifest parsing
- claim import
- offer import
- deterministic SQL generation
- deterministic artifact materialization

## Local work

```bash
npm install
npm run typecheck
npm test
npm run dev
```

Before using the Worker with real data, create the local D1 schema and load sample records:

```bash
cp .dev.vars.example .dev.vars
npx wrangler d1 execute lobsterbazaar --local --file migrations/0001_init.sql
npx wrangler d1 execute lobsterbazaar --local --file seeds/example.sql
```

Then materialize the public artifacts into the bound R2 bucket:

```bash
curl -X POST http://127.0.0.1:8787/internal/materialize \
  -H "Authorization: Bearer replace-me"
```

Useful local checks:

```bash
curl http://127.0.0.1:8787/skill.md
curl http://127.0.0.1:8787/countries/US
curl http://127.0.0.1:8787/offers/US
curl http://127.0.0.1:8787/merchants/sample-roaster/connect
```

## Deploy import workflow

Generate deterministic SQL from a deploy package:

```bash
npm run build:deploy:sql -- deploys/example > build/example.sql
```

For V0, deploy packages must keep:

- `public_directory: true`
- `offers_enabled: true`
- `claim_mode: "operator_managed"`

Load that SQL into local D1:

```bash
npx wrangler d1 execute lobsterbazaar --local --file build/example.sql
```

Generate local review artifacts from the same deploy package:

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
