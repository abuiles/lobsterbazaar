---
title: feat: Internal Dashboard For Analytics And Merchant Approvals
type: feat
status: active
date: 2026-03-23
---

# feat: Internal Dashboard For Analytics And Merchant Approvals

Build a new private internal dashboard under `deploys/private/` that lets operators:

- inspect LobsterBazaar product usage from the existing Cloudflare Workers Analytics Engine dataset
- review and approve merchant submissions
- promote approved submissions into the current D1 merchant and claim model
- rematerialize public artifacts after approval changes
- establish an API-first sync contract so Lobster Stores can ingest submissions without depending on CSV-only workflows

## Why This Work Exists

Current state:

- runtime analytics already write to Workers Analytics Engine via `lobsterbazaar_metrics`
- merchant inventory and claim state already live in D1
- public artifacts are materialized into R2
- `storeagent-kit` no longer contains a live submission or approval backend
- operator-managed CSV import remains the main source-of-truth flow for merchant data

That leaves a gap between the existing control plane and the operator workflow we need.

## Constraints

- Cloudflare implementation details must follow current docs, not memory
- the new app should run locally first and should not be deployed yet
- the dashboard should be implemented as a Cloudflare Pages app with Functions
- the visual design should follow the OpenAI GPT-5.4 frontend guidance:
  - define a clear design system up front
  - keep a strong page narrative
  - use intentional motion
  - avoid generic card-heavy UI and default purple gradients
- private dashboard source should live under `deploys/private/`

## Architecture

### Dashboard runtime

Create `deploys/private/internal-dashboard/` as a standalone Pages app:

- React + Vite frontend
- Pages Functions for `/api/*`
- local dev via `wrangler pages dev`

### Data access

Dashboard Functions bind directly to the same Cloudflare resources:

- `DB` for merchant, claim, offer, and submission state
- `ARTIFACTS` for rematerialization
- Cloudflare account analytics read token for Analytics Engine SQL API queries

### Approval model

Add a new D1-backed submission model inside `lobsterbazaar`:

- `merchant_submissions` captures pending intake from the Shopify app or manual ops entry
- approval action promotes the reviewed submission into:
  - `merchants`
  - `merchant_countries`
  - `merchant_categories`
  - `merchant_claims`
- submission status remains the dashboard source of truth for review history

### Sync foundation

Add a normalized API contract for future non-CSV sync:

- one canonical submission payload shape
- one approval action payload shape
- explicit sync metadata on submissions so Lobster Stores API ingestion can be attached later without redesigning the dashboard

## Stages

## Stage 1: Control-Plane Extension

- add D1 migration for merchant submissions
- extend domain and storage contracts
- implement repository reads and writes for submissions and approval promotion
- add tests for submission lifecycle and merchant promotion

## Stage 2: Private Pages App

- scaffold the Pages project under `deploys/private/internal-dashboard/`
- add Functions APIs for:
  - overview metrics
  - analytics queries
  - merchant list/detail
  - submission list/detail
  - approve/reject actions
  - materialize trigger
- document required local env vars

## Stage 3: Frontend

- create an operator-facing dashboard with a strong editorial control-room aesthetic
- implement:
  - analytics overview
  - trend views
  - submissions inbox
  - merchant registry
  - sync architecture panel
- keep the UI responsive on desktop and mobile

## Stage 4: Local Verification

- run root `npm run typecheck`
- run root `npm run test`
- run dashboard typecheck/build
- start the Pages app locally
- verify APIs respond and the frontend renders

## Acceptance Criteria

- a new local-only private dashboard app exists under `deploys/private/internal-dashboard/`
- the dashboard can display analytics from Workers Analytics Engine when account credentials are configured
- the dashboard can still boot locally without analytics credentials by showing a clear disconnected state
- merchant submissions can be created, listed, approved, and rejected through the new control-plane code
- approval can promote a submission into the existing merchant/claim model
- operators can trigger artifact rematerialization after approvals
- the repo test and typecheck commands pass

## Risks

- Pages local development and the root Worker use different Wrangler shapes, so the dashboard must stay isolated from the root config
- Analytics Engine queries require account-level read credentials that should never be committed
- approval promotion must update both merchant state and claim history coherently because runtime authorization depends on both
