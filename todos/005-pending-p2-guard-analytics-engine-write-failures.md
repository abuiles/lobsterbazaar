---
status: pending
priority: p2
issue_id: "005"
tags: [code-review, analytics, workers, reliability]
dependencies: []
---

# Guard Analytics Engine write failures from breaking requests

## Problem Statement

The new Analytics Engine instrumentation runs on the request path after the application response is built, but it is not protected against `writeDataPoint()` failures. If the metrics payload or binding ever causes a runtime error, otherwise successful requests can fail at the last step.

## Findings

- [`src/app.ts:256`](/Users/abuiles/code/tries/2026-03-15-moltbook/lobsterbazaar/src/app.ts#L256) always calls `recordRequestMetric(...)` before returning the response.
- [`src/metrics.ts:203`](/Users/abuiles/code/tries/2026-03-15-moltbook/lobsterbazaar/src/metrics.ts#L203) calls `dataset.writeDataPoint(...)` directly with no local `try/catch`.
- The metrics feature is intentionally optional (`METRICS?: AnalyticsEngineDataset`), so it should behave like observability, not like a required dependency. Today a bad binding, invalid payload, or future schema drift can turn metrics into request failures.

## Proposed Solutions

### Option 1: Wrap metrics writes in a best-effort guard

**Approach:** Catch any exception inside `recordRequestMetric()` and swallow it.

**Pros:**
- Preserves user-facing behavior when analytics fails.
- Keeps the guard close to the risky API.

**Cons:**
- Metrics write failures become silent unless separately logged.

**Effort:** Small

**Risk:** Low

---

### Option 2: Guard metrics at the call site and log failures

**Approach:** Keep `recordRequestMetric()` strict, but wrap the call in `src/app.ts` and optionally emit a console error.

**Pros:**
- Makes request-path behavior explicit.
- Easier to attach request context to the log.

**Cons:**
- Repeats the responsibility at the app layer instead of in the metrics module.

**Effort:** Small

**Risk:** Low

## Recommended Action

Make Analytics Engine writes best-effort and ensure they can never change the HTTP outcome for tracked routes.

## Technical Details

**Affected files:**
- `src/app.ts`
- `src/metrics.ts`
- `test/metrics.test.ts`

**Related components:**
- Cloudflare Workers Analytics Engine binding
- Request instrumentation wrapper

## Acceptance Criteria

- [ ] A thrown `writeDataPoint()` error does not change the HTTP response status or body for any route.
- [ ] Tests cover a failing dataset binding or a dataset double that throws.
- [ ] The metrics path remains a no-op when `METRICS` is unset.

## Work Log

### 2026-03-16 - Review finding creation

**By:** Codex

**Actions:**
- Reviewed the request wrapper in `src/app.ts`.
- Traced the metrics write path into `src/metrics.ts`.
- Confirmed the current implementation calls `writeDataPoint()` without a protective guard.

**Learnings:**
- The instrumentation is correctly optional at config time, but not yet best-effort at runtime.

