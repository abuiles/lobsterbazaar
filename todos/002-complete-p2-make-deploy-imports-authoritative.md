---
status: complete
priority: p2
issue_id: "002"
tags: [code-review, correctness, data-integrity, deploy]
dependencies: []
---

# Make deploy imports authoritative

## Problem Statement

The new deploy import flow only upserts records that are present in the current package. It never removes merchants, claims, offers, or related country mappings that disappeared from the package, so repeated imports can leave stale data and stale public artifacts behind.

## Findings

- `importDeployPackage` only loops through merchants, claims, and offers and calls `put*`; it never performs a cleanup phase for records that were removed from the package. See `src/import-deploy.ts:5`.
- `buildDeploySql` does the same thing at the SQL layer: it upserts current merchants/claims/offers and only deletes per-record country mappings, with no deletion for removed merchants, removed claims, or removed offers. See `src/sql.ts:15` and `src/sql.ts:65`.
- Reproduced locally with `node --import tsx/esm --eval ...`: importing a package with one active offer and then importing the same package with `offers: []` leaves the original offer visible in `listActiveOffers('US', ...)`.
- Because `materializePublicArtifacts` reads from repository state, any stale records that remain in D1 will continue to be published into generated country/offer artifacts.

## Proposed Solutions

### Option 1: Add a full reconciliation phase

**Approach:** Treat the deploy package as the desired state and delete merchants, claims, offers, and join rows that are absent from the package before materialization.

**Pros:**
- Keeps D1 and generated artifacts aligned with the package.
- Matches the operator expectation of importing a canonical deploy bundle.

**Cons:**
- Requires careful delete ordering and tests for safe reconciliation.
- Higher risk if operators currently rely on additive imports.

**Effort:** 4-6 hours

**Risk:** Medium

---

### Option 2: Introduce explicit prune mode

**Approach:** Keep today’s additive behavior by default, but add a `--prune`/reconcile mode for operator workflows that want the package to be authoritative.

**Pros:**
- Safer migration path.
- Lets operators choose between additive and authoritative imports.

**Cons:**
- Two behaviors to document and maintain.
- Easy to forget prune mode and keep stale data accidentally.

**Effort:** 3-5 hours

**Risk:** Medium

---

### Option 3: Document additive-only semantics and block deletions for V0

**Approach:** Keep the implementation as-is, but document clearly that imports are append/update only and cannot remove entries.

**Pros:**
- Minimal engineering work.
- Avoids changing current behavior.

**Cons:**
- Leaves stale public data as an operational burden.
- Undercuts the “deploy package as source of truth” workflow.

**Effort:** 1 hour

**Risk:** High

## Recommended Action

Treat deploy packages as the desired state for imported merchants, claims, and offers in both repository imports and generated SQL.

## Technical Details

**Affected files:**
- `src/import-deploy.ts:5`
- `src/sql.ts:15`
- `src/sql.ts:65`
- `scripts/build-deploy-sql.ts`
- `scripts/materialize-deploy.ts`
- `test/deploy-package.test.ts`

**Related components:**
- Deploy package import flow
- SQL generation path
- Artifact materialization

**Database changes (if any):**
- Possibly, if reconciliation needs helper queries or delete statements

## Resources

- **PR:** `https://github.com/abuiles/lobsterbazaar/pull/2`
- **Spec:** `specs/2026-03-15-byo-merchant-deploy-model.md`
- **Repro:** `node --import tsx/esm --eval ...` run during review on 2026-03-15

## Acceptance Criteria

- [x] Re-importing a package after removing a merchant or offer no longer leaves stale public data behind.
- [x] SQL generation and in-memory import follow the same reconciliation semantics.
- [x] Tests cover at least one “present on first import, removed on second import” scenario.
- [x] Operator docs describe whether imports are authoritative or additive.

## Work Log

### 2026-03-15 - Review finding creation

**By:** Codex

**Actions:**
- Read the new import and SQL generation paths.
- Verified that current logic only upserts records from the package.
- Reproduced stale-offer retention with two sequential in-memory imports.

**Learnings:**
- The new workflow is deterministic for the input it processes, but not authoritative over prior state.
- Artifact generation will faithfully publish any stale repository data that survives import.

### 2026-03-15 - Fix completed

**By:** Codex

**Actions:**
- Added repository APIs to list and delete imported merchants, claims, and offers in both memory and D1 implementations.
- Updated `src/import-deploy.ts` to prune stale records before re-importing the current package.
- Updated `src/sql.ts` to emit authoritative delete statements ahead of upserts.
- Added regression coverage for two-step imports that remove merchants and offers.

**Learnings:**
- The import and SQL paths need the same reconciliation semantics or operators end up debugging two different sources of truth.

## Notes

- This is primarily a data lifecycle issue. If the package is meant to be the canonical deploy bundle, the current behavior will surprise operators during the second import, not the first.
