---
status: complete
priority: p1
issue_id: "003"
tags: [code-review, security, filesystem, deploy]
dependencies: []
---

# Block artifact path traversal

## Problem Statement

The local artifact generation workflow writes file paths derived directly from deploy-package contents. Because merchant slugs and country codes are not constrained to safe path segments, a malicious or malformed package can write files outside the requested output directory.

## Findings

- `parseMerchantManifest` accepts any non-empty `slug` string and `normalizeCountryCode` only trims and uppercases values; neither enforces a safe filename/path-segment contract. See `src/deploy-package.ts:136` and `src/merchant.ts:3`.
- `FilesystemArtifactStore` writes country, offers, and merchant artifacts with `path.join(this.outputDir, ...parts)` using `artifact.countryCode` and `artifact.slug` directly in the target filename. See `scripts/materialize-deploy.ts:17`, `scripts/materialize-deploy.ts:25`, `scripts/materialize-deploy.ts:33`, and `scripts/materialize-deploy.ts:45`.
- Reproduced locally on 2026-03-15: a package containing `slug=../../escape` caused `npm run build:deploy:artifacts` to create a sibling file at `<tmp>/escape.json` instead of keeping all writes under `<tmp>/out`.
- The README documents this command as an operator workflow, so the unsafe write path is exposed in a normal supported path, not just in tests. See `README.md:107`.

## Proposed Solutions

### Option 1: Validate identifiers before import

**Approach:** Reject merchant slugs and country codes unless they match a strict allowlist such as URL-safe slugs for merchants and `^[A-Z]{2,3}$` for country codes.

**Pros:**
- Stops traversal at the contract boundary.
- Aligns the importer with the documented "stable URL-safe ID" requirement.

**Cons:**
- Breaking change for any existing packages using looser values.
- Still worth hardening output-path resolution as defense in depth.

**Effort:** 1-2 hours

**Risk:** Low

---

### Option 2: Validate input and enforce output path containment

**Approach:** Add input validation and also resolve candidate output paths against `outputDir`, rejecting writes that escape the root.

**Pros:**
- Protects both the data contract and the filesystem boundary.
- Defends against future regressions in new artifact types.

**Cons:**
- Slightly more implementation and test work.
- Needs explicit error handling/messages for rejected paths.

**Effort:** 2-4 hours

**Risk:** Low

---

### Option 3: Document trusted-input-only semantics

**Approach:** Keep the current implementation and document that deploy packages must be fully trusted.

**Pros:**
- Minimal engineering work.

**Cons:**
- Leaves a local file-write primitive in a documented workflow.
- Too weak for a supported operator command.

**Effort:** < 1 hour

**Risk:** High

## Recommended Action

Reject unsafe deploy-package identifiers before import and enforce output-path containment inside the artifact generator as defense in depth.

## Technical Details

**Affected files:**
- `src/deploy-package.ts:136`
- `src/merchant.ts:3`
- `scripts/materialize-deploy.ts:17`
- `scripts/materialize-deploy.ts:45`
- `README.md:107`

**Related components:**
- Deploy package loader
- Local artifact generation CLI
- Operator review workflow

**Database changes (if any):**
- No

## Resources

- **PR:** `https://github.com/abuiles/lobsterbazaar/pull/2`
- **Spec:** `specs/2026-03-15-merchant-manifest-and-offer-schema.md`
- **Repro:** `slug=../../escape` package run during review on 2026-03-15

## Acceptance Criteria

- [x] Merchant slugs are validated against a safe slug format before import.
- [x] Country codes are validated against the supported country-code format.
- [x] Artifact writes reject resolved paths outside the requested output directory.
- [x] Tests cover at least one traversal attempt for merchant artifacts.

## Work Log

### 2026-03-15 - Review finding creation

**By:** Codex

**Actions:**
- Reviewed the local artifact generation store and its filename construction.
- Verified `path.join(outputDir, "merchants", "../../escape.json")` resolves outside the output directory.
- Reproduced an out-of-tree write with a crafted deploy package and `scripts/materialize-deploy.ts`.

**Learnings:**
- The current importer trusts deploy-package identifiers as filesystem-safe.
- One crafted merchant slug is enough to escape the target artifact directory.

### 2026-03-15 - Fix completed

**By:** Codex

**Actions:**
- Added strict merchant-slug validation in `src/deploy-package.ts`.
- Tightened `normalizeCountryCode` in `src/merchant.ts` to reject invalid country-code shapes.
- Added output-root containment checks in `scripts/materialize-deploy.ts` before any file write.
- Added a regression test that attempts `slug=../../escape` and verifies the script fails without writing outside the output tree.

**Learnings:**
- Input validation and path containment are both worth keeping; each catches a different class of future regression.

## Notes

- This is local-command exposure, not a remote Worker exploit, but it still warrants P1 handling because it enables arbitrary file writes in a documented operator path.
