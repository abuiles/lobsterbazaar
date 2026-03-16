---
status: complete
priority: p2
issue_id: "004"
tags: [code-review, correctness, filesystem, deploy]
dependencies: []
---

# Make artifact generation convergent and atomic

## Problem Statement

The local artifact generation command writes directly into the target output tree without reconciling or staging files first. Re-running it into the same directory can leave stale files behind, and a mid-run failure can leave consumers with a mixed old/new artifact set.

## Findings

- `FilesystemArtifactStore` only overwrites the files touched by the current run and never removes artifacts that no longer belong to the package. See `scripts/materialize-deploy.ts:10` and `scripts/materialize-deploy.ts:45`.
- The documented workflow encourages reusing a stable output directory (`build/example`), so operators are likely to hit this on ordinary repeated runs. See `README.md:107`.
- Reproduced locally on 2026-03-15: generating artifacts for a package with `sample-roaster` and `second-roaster`, then regenerating into the same output directory after removing `second-roaster`, leaves `second-roaster.json` on disk.
- The plan already calls out that generation failures should not partially overwrite a previously valid artifact set, but the current implementation writes directly to final paths and does not stage/swap output. See `plans/2026-03-15-feat-lobsterbazaar-v0-directory-mcp-handoff-plan.md:318`.

## Proposed Solutions

### Option 1: Clear known artifact subtrees before each run

**Approach:** Remove `countries/`, `offers/`, `merchants/`, and `skill.md` under the output root before regenerating the new set.

**Pros:**
- Simple way to make repeated runs converge.
- Minimal code changes.

**Cons:**
- Not atomic; readers can still see an empty or partially regenerated tree mid-run.
- A failure after cleanup loses the previous good output.

**Effort:** 1-2 hours

**Risk:** Medium

---

### Option 2: Generate into a temp directory and swap into place

**Approach:** Materialize the full artifact set into a temporary sibling directory, verify success, then replace the final output directory atomically.

**Pros:**
- Fixes both stale files and partial-update exposure.
- Matches the plan’s expectation for safe regeneration.

**Cons:**
- More filesystem orchestration.
- Needs care on cross-platform rename behavior and cleanup on failure.

**Effort:** 3-5 hours

**Risk:** Medium

---

### Option 3: Require a fresh output directory per run

**Approach:** Leave the implementation mostly as-is, but require callers to provide a new empty directory every time and fail otherwise.

**Pros:**
- Low implementation cost.
- Avoids stale files if callers comply.

**Cons:**
- Pushes correctness onto operators.
- Still does not address partial-write exposure.

**Effort:** 1 hour

**Risk:** Medium

## Recommended Action

Generate artifacts into a staging directory and swap them into place only after the full materialization succeeds.

## Technical Details

**Affected files:**
- `scripts/materialize-deploy.ts:10`
- `scripts/materialize-deploy.ts:58`
- `README.md:107`
- `plans/2026-03-15-feat-lobsterbazaar-v0-directory-mcp-handoff-plan.md:318`
- `test/deploy-package.test.ts`

**Related components:**
- Local artifact materialization CLI
- Operator review workflow
- Build output layout under `build/`

**Database changes (if any):**
- No

## Resources

- **PR:** `https://github.com/abuiles/lobsterbazaar/pull/2`
- **Plan:** `plans/2026-03-15-feat-lobsterbazaar-v0-directory-mcp-handoff-plan.md`
- **Repro:** repeated `scripts/materialize-deploy.ts` runs into the same output directory on 2026-03-15

## Acceptance Criteria

- [x] Re-running artifact generation into the same output path does not leave stale merchant/country/offer files behind.
- [x] A failed generation attempt does not replace a previously complete artifact set with a partial one.
- [x] Tests cover at least one repeated-run scenario with a removed merchant or country.
- [x] README documents the supported output-directory semantics.

## Work Log

### 2026-03-15 - Review finding creation

**By:** Codex

**Actions:**
- Reviewed the filesystem artifact store and CLI entrypoint.
- Reproduced a repeated-run scenario where a removed merchant file stayed on disk.
- Compared the implementation against the plan’s “no partial overwrite” expectation.

**Learnings:**
- The current command is safe only when pointed at a fresh directory and when the run completes cleanly.
- The documented stable output path makes stale and partial output more likely in real operator use.

### 2026-03-15 - Fix completed

**By:** Codex

**Actions:**
- Reworked `scripts/materialize-deploy.ts` to materialize into a temp directory and swap the finished output into place.
- Preserved the previous output tree when regeneration fails before the swap.
- Added regression tests for repeated runs into the same directory and for failed regeneration preserving the previous artifact set.
- Updated `README.md` to document the output-directory semantics.

**Learnings:**
- Staged replacement solves both stale-file drift and partial-update exposure in one change.

## Notes

- This is separate from the authoritative-import problem: even with a fresh in-memory repository, the filesystem output still fails to converge on reruns.
