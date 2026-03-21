---
title: feat: Refactor LobsterBazaar into a multi-category directory
type: feat
status: active
date: 2026-03-21
origin: docs/brainstorms/2026-03-21-multi-category-instance-directory-brainstorm.md
---

# feat: Refactor LobsterBazaar into a multi-category directory

## Overview

Refactor `lobsterbazaar` from a single-category deploy model into one instance that hosts many explicit categories such as `coffee` and `bread`.

The instance root should introduce categories for both humans and agents, while category-specific deep links become the canonical discovery surface:

- root landing page and root `skill.md`
- `/{category}/skill.md`
- `/{category}/countries/{country_code}`
- `/{category}/offers/{country_code}`
- `/{category}/merchants/{slug}`
- `/{category}/merchants/{slug}/connect`

Merchant truth remains canonical and shared across the instance, while category membership becomes a discovery lens rather than a duplicate merchant record (see brainstorm: `docs/brainstorms/2026-03-21-multi-category-instance-directory-brainstorm.md`).

## Progress

- [x] Phase 1: Contract and schema refactor
- [ ] Phase 2: Repository and artifact generation refactor
- [ ] Phase 3: HTTP routing and presentation surface
- [ ] Phase 4: Metrics, docs, tooling, and tests

## Problem Statement / Motivation

The current implementation still carries the original assumption that one deploy maps to one vertical:

- runtime config has one `verticalId` and one `verticalSummary` in `src/config.ts`
- skill generation produces one root `skill.md` in `src/skill.ts`
- public routes are rooted at `/countries`, `/offers`, and `/merchants/{slug}/connect` in `src/app.ts`
- artifact keys are unscoped in `src/r2.ts`
- deploy package parsing requires one `vertical_id` and `vertical_name` in `src/deploy-package.ts`
- metrics index by `verticalId` and hardcode root route patterns in `src/metrics.ts`

That shape makes each category feel like a separate instance, which is now the wrong product model. The new goal is one durable instance that serves as a Shopify merchant directory for LLM agents, with explicit flat categories underneath it (see brainstorm: `docs/brainstorms/2026-03-21-multi-category-instance-directory-brainstorm.md`).

## Research Summary

### Origin document

- Brainstorm: `docs/brainstorms/2026-03-21-multi-category-instance-directory-brainstorm.md`

### Relevant codebase findings

- `src/app.ts` is the main routing seam and currently assumes one root skill and one root discovery namespace.
- `src/config.ts` and `src/domain.ts` model one deploy identity plus one vertical identity.
- `src/r2.ts`, `src/artifacts.ts`, and `scripts/materialize-deploy.ts` assume unscoped artifact keys such as `skill.md`, `countries/US.json`, and `offers/US.json`.
- `src/d1.ts`, `src/sql.ts`, and `migrations/0001_init.sql` model merchant-to-country and offer-to-country, but there is no category table or membership join.
- `src/deploy-package.ts` and `deploys/example/config.json` assume a single vertical-specific deploy package.
- `test/app.test.ts`, `test/deploy-package.test.ts`, and `test/metrics.test.ts` encode the current single-vertical contract and will need broad updates.
- `scripts/render-vertical-wrangler.ts` and `DIRECTORY_VERTICALS_JSON` in `src/config.ts` show an older “directory of vertical deploys” concept that now overlaps with the desired in-instance category model.

### Institutional learnings

- No `docs/solutions/` entries were present during planning.

### External research decision

Proceed without external research. This plan is driven by the approved brainstorm and by existing repo structure; no Cloudflare product behavior changes need validation for the planning step.

## Proposed Solution

### 1. Replace single-vertical runtime identity with instance + categories

The root config should describe the instance itself. Categories should become explicit records owned by the deploy package, with stable slugs, names, summaries, and category-specific skill copy.

The runtime contract should distinguish:

- instance identity: brand, domain, root landing copy, root skill copy
- category identity: slug, label, summary, skill buying targets, optional presentation fields

This carries forward the brainstorm decisions that categories are explicit, flat, and first-class (see brainstorm: `docs/brainstorms/2026-03-21-multi-category-instance-directory-brainstorm.md`).

### 2. Keep merchant truth canonical and shared

Merchants should remain one shared record per Shopify store. Category membership should be represented separately, most likely through explicit category membership data rather than merchant duplication.

The minimum relational additions are:

- `categories`
- `merchant_categories`
- optionally `offer_categories` if offer relevance must diverge from merchant membership

Planning assumption for V1: if explicit offer categories are not introduced immediately, offers inherit the categories of their merchant. If that assumption proves too weak during implementation, add `offer_categories` before shipping public multi-category offers.

### 3. Make public artifacts and routes category-aware

The root should expose category discovery and root installation guidance. Canonical merchant discovery should move inside category namespaces.

Recommended public contract:

- `/`
- `/skill.md`
- `/categories`
- `/categories.md`
- `/{category}/skill.md`
- `/{category}/countries`
- `/{category}/countries.md`
- `/{category}/countries/{country_code}`
- `/{category}/offers/{country_code}`
- `/{category}/merchants/{slug}`
- `/{category}/merchants/{slug}/connect`

Non-goal for this refactor:

- root aggregated `/countries/{country_code}` or other category-mixing discovery surfaces in V1 (see brainstorm: `docs/brainstorms/2026-03-21-multi-category-instance-directory-brainstorm.md`)

### 4. Update the deploy package contract to describe categories explicitly

The current single `config.json` plus `merchants.csv` plus `offers.json` contract is insufficient for multi-category routing. The plan should expand the input package with explicit category records and merchant-to-category membership.

Recommended V1 input shape:

- `config.json`: instance-level identity and branding
- `categories.json` or `categories.csv`: explicit category records
- `merchants.csv`: shared merchant truth plus category membership references
- `offers.json`: offers, with either inherited or explicit category scope

The parser should reject ambiguous category references and require that all referenced category slugs exist.

### 5. Preserve one root skill and add category skills

The current `src/skill.ts` template should split into:

- root skill template: explains the instance, lists categories, tells agents to choose one
- category skill template: drives the actual discovery flow for that category using category-scoped routes

This carries forward the brainstorm decision that both root entry and direct category entry matter (see brainstorm: `docs/brainstorms/2026-03-21-multi-category-instance-directory-brainstorm.md`).

## Implementation Phases

### Phase 1: Contract and schema refactor

Goal: make categories first-class in the domain, config, and storage contracts.

Files likely involved:

- `src/domain.ts`
- `src/config.ts`
- `src/deploy-package.ts`
- `migrations/0001_init.sql` or follow-up migration
- `src/storage.ts`
- `src/sql.ts`

Deliverables:

- new domain types for instance config and category config
- explicit category records in deploy package parsing
- merchant-to-category membership in parsed data
- schema updates for category tables and joins
- SQL generation/import logic that preserves shared merchant truth and category memberships

Acceptance gate:

- one deploy package can define multiple categories explicitly
- one merchant can belong to multiple categories without duplication
- config and schema no longer require one canonical vertical per instance

### Phase 2: Repository and artifact generation refactor

Goal: materialize category-aware read models without losing shared merchant identity.

Files likely involved:

- `src/d1.ts`
- `src/artifacts.ts`
- `src/r2.ts`
- `src/import-deploy.ts`
- `scripts/materialize-deploy.ts`
- `src/memory.ts`

Deliverables:

- repository queries that filter merchants and offers by category plus country
- category-aware artifact keys
- root category index artifact(s)
- root `skill.md` plus per-category `skill.md`
- category-scoped merchant artifact materialization

Acceptance gate:

- artifacts can be generated for multiple categories in one run
- shared merchants can appear in more than one category namespace
- root and category skills are generated from canonical templates

### Phase 3: HTTP routing and presentation surface

Goal: serve the new root/category contract cleanly from one Worker.

Files likely involved:

- `src/app.ts`
- `src/http.ts`
- `src/skill.ts`
- `src/merchant.ts`

Deliverables:

- root category index endpoints
- category-scoped skill, country, offer, merchant, and connect routes
- landing page updates so humans can choose categories from the root
- consistent markdown and JSON mirrors for root and category surfaces

Acceptance gate:

- root skill introduces categories and does not present root merchant discovery as canonical
- `/{category}/skill.md` is the authoritative bootstrap surface for that category
- category-scoped routes return only merchants and offers relevant to the chosen category

### Phase 4: Metrics, docs, tooling, and tests

Goal: bring the operational surface in line with the new contract.

Files likely involved:

- `src/metrics.ts`
- `test/app.test.ts`
- `test/deploy-package.test.ts`
- `test/metrics.test.ts`
- `README.md`
- `deploys/example/config.json`
- `scripts/render-vertical-wrangler.ts`

Deliverables:

- route metrics updated for category-prefixed paths
- metric indexing reviewed so it reflects instance/category semantics instead of only legacy `verticalId`
- example deploy package updated to exercise at least two categories
- README updated to document root vs category entrypoints
- tests rewritten around root skill plus category-specific discovery
- legacy “directory of vertical deploys” tooling either removed, renamed, or repurposed for the new category model

Acceptance gate:

- automated tests cover root entry, direct category entry, multi-category merchant membership, and category-aware metrics
- repo docs no longer describe the product as one deploy per category

## Acceptance Criteria

- [ ] One instance can define multiple explicit flat categories such as `coffee` and `bread`.
- [ ] The root provides a category index plus a root `skill.md` that routes agents into a category.
- [ ] Each category publishes its own `/{category}/skill.md`.
- [ ] Merchant truth remains canonical and shared, and one merchant can belong to multiple categories.
- [ ] Canonical merchant discovery uses category-scoped routes, including `/{category}/countries/{country_code}` and `/{category}/merchants/{slug}/connect`.
- [ ] Root aggregated country discovery is not introduced as a first-class V1 surface.
- [ ] Artifact materialization supports multiple categories within one instance.
- [ ] SQL generation, import, and in-memory repositories remain deterministic under the new category model.
- [ ] Metrics and tests are updated to reflect the category-aware contract.
- [ ] README and example deploy data document the new root-plus-category installation flow.

## Risks and Mitigations

- Breaking the current root-only API contract may invalidate existing agent instructions.
  Mitigation: keep root `skill.md` stable, document the new category-first flow clearly, and decide explicitly whether any temporary compatibility aliases are needed during implementation.

- Category membership may be under-specified for offers.
  Mitigation: start with the explicit planning assumption above and promote to `offer_categories` before release if real data needs category-specific offer routing.

- Artifact cache keys may drift or collide during the refactor.
  Mitigation: introduce centralized path builders for root artifacts, category artifacts, and merchant artifacts instead of constructing raw strings across files.

- Metrics may become noisy or lose comparability if route IDs change without a clear mapping.
  Mitigation: treat metric schema updates as part of the refactor, not cleanup afterward.

## Out of Scope

- Hierarchical or nested category taxonomies
- Personalized ranking or recommendation engines
- Root aggregated country discovery across all categories
- Autonomous purchase or payment completion
- Non-Shopify merchant integrations

## Sources

- Origin brainstorm: `docs/brainstorms/2026-03-21-multi-category-instance-directory-brainstorm.md`
- Existing runtime routes: `src/app.ts`
- Existing deploy/runtime config: `src/config.ts`, `src/deploy-package.ts`, `deploys/example/config.json`
- Existing storage and generation: `src/artifacts.ts`, `src/r2.ts`, `src/import-deploy.ts`, `src/sql.ts`
- Existing relational model: `src/d1.ts`, `migrations/0001_init.sql`
- Existing analytics and test coverage: `src/metrics.ts`, `test/app.test.ts`, `test/deploy-package.test.ts`, `test/metrics.test.ts`
