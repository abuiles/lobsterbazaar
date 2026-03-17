---
status: pending
priority: p1
issue_id: "005"
tags: [code-review, observability, cloudflare, correctness]
dependencies: []
---

# Guard post-response metrics from breaking requests

## Problem Statement

The new Analytics Engine instrumentation performs snapshot reads and `writeDataPoint()` calls after the route handler has already produced a response, but this post-response path is not guarded. If either the snapshot query or the Analytics Engine write throws, the whole Worker request can fail even though the primary business logic already succeeded.

## Findings

- [`src/app.ts:256`](/Users/abuiles/code/tries/2026-03-15-moltbook/lobsterbazaar/src/app.ts#L256) fetches metrics snapshots outside the main `try/catch`. A D1 failure here will reject the request after a successful `/internal/materialize`.
- [`src/app.ts:261`](/Users/abuiles/code/tries/2026-03-15-moltbook/lobsterbazaar/src/app.ts#L261) calls `recordRequestMetric(...)` outside the main `try/catch`.
- [`src/metrics.ts:203`](/Users/abuiles/code/tries/2026-03-15-moltbook/lobsterbazaar/src/metrics.ts#L203) calls `dataset.writeDataPoint(...)` without a protective guard. Any synchronous binding/runtime error would surface to the caller.

## Proposed Solutions

### Option 1: Wrap the entire post-response metrics path in a defensive `try/catch`

**Approach:** Keep metrics best-effort. Catch and swallow snapshot/write failures after the main response is ready.

**Pros:**
- Prevents telemetry from breaking user-facing requests.
- Minimal code change.

**Cons:**
- Metrics failures become silent unless logged separately.

**Effort:** 30-60 minutes

**Risk:** Low

---

### Option 2: Move snapshot and write logic behind a helper that never throws

**Approach:** Create one `recordRequestMetricSafely(...)` helper that handles snapshot reads, AE writes, and optional logging internally.

**Pros:**
- Centralizes the best-effort contract.
- Easier to test explicitly.

**Cons:**
- Slightly larger refactor.

**Effort:** 1-2 hours

**Risk:** Low

## Recommended Action

Make Analytics Engine recording explicitly best-effort: no snapshot lookup or metrics write should be able to change a successful route into a failed request.

## Technical Details

**Affected files:**
- [`src/app.ts`](/Users/abuiles/code/tries/2026-03-15-moltbook/lobsterbazaar/src/app.ts)
- [`src/metrics.ts`](/Users/abuiles/code/tries/2026-03-15-moltbook/lobsterbazaar/src/metrics.ts)

**Acceptance Criteria**

- [ ] Successful route handlers still return success even if snapshot lookup fails.
- [ ] Successful route handlers still return success even if `writeDataPoint()` throws.
- [ ] Tests cover both failure modes.

## Work Log

### 2026-03-16 - Review finding creation

**By:** Codex

**Actions:**
- Reviewed the post-response metrics flow in `src/app.ts`.
- Traced the unguarded call chain into `src/metrics.ts`.
- Verified that any thrown error after response construction would escape the handler and fail the request.

**Learnings:**
- Observability code must be strictly best-effort in the Worker request path.
