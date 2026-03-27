---
title: "Fix Lobsterstores Merchant Description Publishing Across Source, Build, and R2"
summary: "Stopped exposing CRO ingestion provenance in public lobsterstores artifacts, moved merchant source data to one canonical CSV, aligned the main repo deploy-package parser with description-first rows, recovered valid R2 S3 credentials, and re-synced clean production artifacts to Cloudflare R2."
category: "integration-issues"
tags:
  - "lobsterstores"
  - "merchant-directory"
  - "shopify-storefront"
  - "r2"
  - "rclone"
  - "cloudflare"
  - "deploy-packages"
  - "csv-source-of-truth"
date: 2026-03-26
related_files:
  - "src/deploy-package.ts"
  - "deploys/private/lobsterbrew/scripts/bootstrap_lobsterstores.py"
  - "deploys/private/lobsterbrew/source/merchants.csv"
  - "deploys/private/lobsterbrew/README.md"
  - "deploys/private/lobsterbrew/SKILL.md"
  - "deploys/private/lobsterbrew/lobsterstores/README.md"
  - "plans/2026-03-21-feat-refactor-multi-category-directory-plan.md"
  - "todos/006-pending-p2-separate-public-description-change-from-metrics-work.md"
  - "todos/002-complete-p2-make-deploy-imports-authoritative.md"
related_commits:
  - "7d696d1"
  - "65be7b4"
  - "9b6b58f"
---

# Fix Lobsterstores Merchant Description Publishing Across Source, Build, and R2

## Problem

The public `lobsterstores` directory was surfacing ingestion provenance such as `Merchant discovered via CRO MEDIA ...` instead of the merchant's actual Shopify store description.

The fix was not confined to one file. The break lived across:

- the private repo source manifests and unified bootstrap
- the main repo deploy-package parser and artifact generator
- the Cloudflare R2 publish path and its credential model

## Symptoms

- Generated merchant output showed CRO ingest notes instead of merchant-facing descriptions.
- Shopify-enriched descriptions were present in structured metadata, but not consistently used in public artifacts.
- Merchant data was split across per-vertical CSVs, which made updates and backfills harder to reason about.
- Empty descriptions were stale for some merchants relative to live Shopify Storefront data.
- Production artifact publishing initially failed with `401 Unauthorized`.
- A `cfut_...` Cloudflare profile token looked usable, but it did not work with the `rclone` R2 remote.

## Root Cause

Three issues had drifted apart:

1. `notes` started life as an ingest provenance field, but downstream code treated it like public description text.
2. The private repo moved toward `description`, while the main repo deploy package code still expected `notes`.
3. The R2 publish flow requires S3-compatible credentials (`access_key_id` and `secret_access_key`), but the initial recovery path recreated a Cloudflare profile API token instead.

## Working Solution

### 1. Stop treating provenance as public copy

In the private repo, the unified `lobsterstores` build was changed so public merchant output uses `description`, not `notes`.

Key change:

- `deploys/private/lobsterbrew/scripts/bootstrap_lobsterstores.py`

Important behavior:

- generated merchant rows now carry `description`
- `merchant_description()` prefers explicit `description`
- if needed, it falls back to `vertical_metadata.shop_description`
- CRO provenance is no longer surfaced in public directory artifacts

### 2. Move to one canonical merchant source CSV

The active merchant source of truth moved to:

- `deploys/private/lobsterbrew/source/merchants.csv`

That replaced the build-time merge across `verticals/*/merchants.csv`.

Why this mattered:

- one place to update descriptions and categories
- simpler operator model
- less merge drift between categories
- easier backfills from Shopify into the same source file

### 3. Audit and backfill empty descriptions

The empty-description set was checked against live Shopify Storefront data.

Outcome:

- `52` merchants had recoverable live descriptions and were backfilled
- `33` merchants still had endpoint-level failures and remained unresolved
- the rest were genuinely empty on Shopify

This ensured the canonical merchant source was improved before the production rebuild.

### 4. Align the main repo deploy-package parser

The private repo fix alone was not enough. The main repo still needed to accept description-first rows during artifact generation.

Key change:

- `src/deploy-package.ts`

Compatibility logic:

```ts
const description = typeof row.description === "string" ? row.description.trim() : "";
const notes = typeof row.notes === "string" ? row.notes : description;
```

This kept legacy compatibility while allowing the new production package schema to publish the correct merchant-facing text.

### 5. Rebuild the production artifact tree

The production artifact set was rebuilt from the top-level repo against the generated private production directory package.

```bash
npm run build:deploy:artifacts -- \
  deploys/private/lobsterbrew/lobsterstores/production/directory \
  build/lobsterstores-production-directory-artifacts \
  2026-03-26T00:00:00Z
```

Verification:

```bash
rg -n "Merchant discovered via CRO MEDIA" build/lobsterstores-production-directory-artifacts
```

Expected result:

- no matches

Spot-checks confirmed that known merchants such as `1-shot-energy` and `1818-farms` now carried real descriptions.

### 6. Use the right Cloudflare credential type for R2

The first credential recovery attempt recreated a profile API token from the Cloudflare user token page. That token type is not usable by `rclone` against the R2 S3 endpoint.

What `rclone` actually needed:

- `access_key_id`
- `secret_access_key`
- `endpoint`

Correct credential flow:

- Cloudflare account `R2 Object Storage`
- `Manage API Tokens`
- create or use an R2 token that exposes S3-compatible credentials

The key operational distinction:

- `cfut_...` token: Cloudflare API bearer token
- R2 S3 credentials: what `rclone sync` actually uses

### 7. Store local publish credentials in direnv

For reuse in this workspace, a local `.envrc` was added in the private repo and ignored by git.

It exports:

- `CLOUDFLARE_R2_API_TOKEN`
- `LOBSTERSTORES_R2_ACCESS_KEY_ID`
- `LOBSTERSTORES_R2_SECRET_ACCESS_KEY`
- `LOBSTERSTORES_R2_ACCOUNT_ID`
- `LOBSTERSTORES_R2_BUCKET`
- `LOBSTERSTORES_R2_ENDPOINT`
- `RCLONE_CONFIG_R2_*` overrides for the existing `r2:` remote

And `.gitignore` was updated to ignore:

- `.envrc`
- `.direnv/`

Then:

```bash
direnv allow .
```

### 8. Publish the clean artifacts to R2

Credential validation:

```bash
direnv exec . rclone lsd r2:
direnv exec . rclone lsd r2:lobsterstores-artifacts
```

Publish:

```bash
direnv exec . rclone sync \
  /Users/abuiles/code/tries/2026-03-15-moltbook/lobsterbazaar/build/lobsterstores-production-directory-artifacts \
  r2:lobsterstores-artifacts/ \
  --progress
```

The sync completed successfully.

Remote verification:

```bash
direnv exec . rclone cat r2:lobsterstores-artifacts/coffee/countries/US.json | \
  rg -n "Merchant discovered via CRO MEDIA|1-shot-energy|1818-farms"
```

Expected result:

- `1-shot-energy` present
- `1818-farms` present
- no CRO provenance match

## Files Changed

Private repo:

- `deploys/private/lobsterbrew/scripts/bootstrap_lobsterstores.py`
- `deploys/private/lobsterbrew/source/merchants.csv`
- `deploys/private/lobsterbrew/README.md`
- `deploys/private/lobsterbrew/SKILL.md`
- `deploys/private/lobsterbrew/.gitignore`
- `deploys/private/lobsterbrew/.envrc`

Main repo:

- `src/deploy-package.ts`

## Verification

Build verification:

```bash
npm run test -- test/deploy-package.test.ts test/d1.test.ts test/app.test.ts
```

Artifact verification:

```bash
rg -n "Merchant discovered via CRO MEDIA" build/lobsterstores-production-directory-artifacts
```

Remote verification:

```bash
direnv exec . rclone cat r2:lobsterstores-artifacts/coffee/countries/US.json | head -c 1200
```

Confirmed result:

- remote `coffee/countries/US.json` now shows real descriptions
- the CRO provenance string is absent from the rebuilt artifact path

## Prevention

### Keep public description flow explicit

- Keep `description` first-class in both the unified manifest and deploy package.
- Treat CRO provenance as ingest-only metadata.
- Do not let public artifact builders read raw `notes`.

### Keep one committed merchant source

- Continue treating `deploys/private/lobsterbrew/source/merchants.csv` as the only active merchant source.
- Merge future API-created or manually corrected merchants back into that file before production publishes.

### Make publish verification part of the runbook

Before publish:

```bash
rg -n "Merchant discovered via CRO MEDIA" build/lobsterstores-production-directory-artifacts
direnv exec . rclone lsd r2:
direnv exec . rclone lsd r2:lobsterstores-artifacts
```

After publish:

```bash
direnv exec . rclone cat r2:lobsterstores-artifacts/coffee/countries/US.json | \
  rg -n "Merchant discovered via CRO MEDIA|1-shot-energy|1818-farms"
```

### Document credential types explicitly

Add or preserve a short note in the operator docs:

- `rclone sync` to R2 does not use `cfut_...` profile tokens
- it uses S3-style R2 credentials

### Remember artifact sync is not the full production story

The R2 sync fixed the public artifact plane. If a production path still reads from `D1`, the SQL import must still be run separately.

## Cross References

- `deploys/private/lobsterbrew/README.md`
- `deploys/private/lobsterbrew/SKILL.md`
- `deploys/private/lobsterbrew/lobsterstores/README.md`
- `README.md`
- `plans/2026-03-21-feat-refactor-multi-category-directory-plan.md`
- `todos/006-pending-p2-separate-public-description-change-from-metrics-work.md`
- `todos/002-complete-p2-make-deploy-imports-authoritative.md`

- Keep `source/merchants.csv` as the only merchant source of truth for Lobsterstores.
- Do not use `notes` for public merchant copy. Reserve it for internal provenance if it exists at all.
- Treat deploy package schema changes as two-repo changes:
  - private repo data/bootstrap
  - main repo package parser and artifact generation
- Before publishing, always verify the built artifacts directly with:
  - `rg -n "Merchant discovered via CRO MEDIA" build/...`
- For R2 uploads, do not use profile API tokens. Use R2 API tokens with S3 credentials.
- Keep operator-only credentials in ignored local env files, not committed config.

## Testing And Verification

- targeted tests in the main repo passed for deploy package parsing after the `description` fallback fix
- local artifact tree had zero CRO provenance matches
- remote R2 bucket copy of `coffee/countries/US.json` showed real descriptions after sync
- sync completed with `rclone` exit code `0`

## Residual Risk

This publish updated the R2 artifact plane. If any production reads still depend on D1-backed merchant fields rather than R2 artifacts, a separate SQL import is still required to make those paths consistent.
