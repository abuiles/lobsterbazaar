---
status: pending
priority: p2
issue_id: "006"
tags: [code-review, api, content, regression]
dependencies: []
---

# Separate public merchant description changes from the metrics work

## Problem Statement

This diff changes the public merchant description source from `notes` to `vertical_metadata.shop_description` when present, but that behavior change is unrelated to the Analytics Engine work and is not documented as part of the metrics feature.

## Findings

- [`src/merchant.ts:45`](/Users/abuiles/code/tries/2026-03-15-moltbook/lobsterbazaar/src/merchant.ts#L45) adds `buildPublicMerchantDescription()` and prefers `verticalMetadata.shop_description`.
- [`src/d1.ts:233`](/Users/abuiles/code/tries/2026-03-15-moltbook/lobsterbazaar/src/d1.ts#L233) and [`src/memory.ts:127`](/Users/abuiles/code/tries/2026-03-15-moltbook/lobsterbazaar/src/memory.ts#L127) now use that helper for country artifact descriptions.
- The review test data was changed to codify the new behavior in [`test/helpers.ts:51`](/Users/abuiles/code/tries/2026-03-15-moltbook/lobsterbazaar/test/helpers.ts#L51), and expectations were updated in [`test/app.test.ts:196`](/Users/abuiles/code/tries/2026-03-15-moltbook/lobsterbazaar/test/app.test.ts#L196) and [`test/app.test.ts:289`](/Users/abuiles/code/tries/2026-03-15-moltbook/lobsterbazaar/test/app.test.ts#L289).
- That means the patch is not just adding observability. It also changes public JSON/markdown output for merchants whenever `shop_description` is present.

## Proposed Solutions

### Option 1: Split the description-source change into its own patch

**Approach:** Revert the `shop_description` behavior from this diff and land it separately if desired.

**Pros:**
- Keeps the metrics feature tightly scoped.
- Avoids accidental API/content regressions in an observability patch.

**Cons:**
- Requires a follow-up diff if the description change is wanted.

**Effort:** Small

**Risk:** Low

---

### Option 2: Keep the behavior change but document it explicitly

**Approach:** Treat the description source switch as intentional and update specs/docs accordingly.

**Pros:**
- Preserves the new behavior if it is actually desired.
- Makes the response contract explicit.

**Cons:**
- Still combines two unrelated concerns in one change.

**Effort:** Small

**Risk:** Medium

## Recommended Action

Remove or isolate the public description source change from the Analytics Engine patch unless there is an explicit product decision to prefer `shop_description`.

## Technical Details

**Affected files:**
- `src/merchant.ts`
- `src/d1.ts`
- `src/memory.ts`
- `test/helpers.ts`
- `test/app.test.ts`

**Related components:**
- Country artifact JSON
- Country markdown rendering
- Merchant content sourcing

## Acceptance Criteria

- [ ] The metrics change can land without altering merchant description content, or the description change is separately documented and approved.
- [ ] Tests clearly reflect the intended public source of merchant descriptions.

## Work Log

### 2026-03-16 - Review finding creation

**By:** Codex

**Actions:**
- Compared the metrics-related files with the public artifact description path.
- Traced the new helper through both D1 and memory repositories.
- Verified that test fixtures and expectations were updated to lock in the new public output.

**Learnings:**
- The current diff mixes an observability feature with a public content-source change, which makes review and rollback materially harder.

