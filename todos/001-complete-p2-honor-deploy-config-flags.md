---
status: complete
priority: p2
issue_id: "001"
tags: [code-review, correctness, config, deploy]
dependencies: []
---

# Honor deploy config flags

## Problem Statement

The new deploy-package contract exposes config flags that suggest operators can disable offers, disable the public directory, or choose a claim mode, but the implementation currently ignores or overrides those values. That creates a silent misconfiguration path where deploy output does not match the package the operator supplied.

## Findings

- `parseDeployConfig` parses `public_directory` and `offers_enabled`, but hard-codes `claimMode` to `"operator_managed"` instead of validating `claim_mode` from the file, so unsupported values are silently accepted and rewritten at load time. See `src/deploy-package.ts:53` and `src/deploy-package.ts:73`.
- `materializeDeployPackage` always generates country, offer, merchant, and `skill.md` artifacts with fixed paths and no branching on `publicDirectory` or `offersEnabled`. See `src/import-deploy.ts:22`.
- Reproduced locally with `node --import tsx/esm --eval ...`: a package declaring `"public_directory": false`, `"offers_enabled": false`, and `"claim_mode": "self_service"` still loads as `claimMode: "operator_managed"` and still materializes an offers artifact for `US`.
- There is no test coverage for disabled/off-contract config values in `test/deploy-package.test.ts`, so this contract mismatch can regress unnoticed.

## Proposed Solutions

### Option 1: Enforce the current V0 contract explicitly

**Approach:** Validate `claim_mode`, reject unsupported values, and fail fast if `public_directory` or `offers_enabled` are set to combinations the runtime does not support yet.

**Pros:**
- Removes silent misconfiguration immediately.
- Keeps V0 behavior narrow and easy to reason about.

**Cons:**
- Rejects some packages that currently appear to load.
- Requires documenting the supported config surface more precisely.

**Effort:** 1-2 hours

**Risk:** Low

---

### Option 2: Implement the config switches end to end

**Approach:** Thread `publicDirectory`, `offersEnabled`, and `claimMode` through import/materialization logic so generated artifacts and offer import behavior follow the package config.

**Pros:**
- Makes the deploy package behave like a real contract.
- Avoids surprising operators with ignored values.

**Cons:**
- Larger change surface across artifact generation and routing assumptions.
- Needs additional tests for each flag combination.

**Effort:** 4-6 hours

**Risk:** Medium

---

### Option 3: Remove unsupported fields from the package contract for now

**Approach:** Stop advertising unsupported config knobs in the loader/example package until the runtime can honor them.

**Pros:**
- Simplifies the contract.
- Reduces operator confusion quickly.

**Cons:**
- Gives up forward-looking config fields for V0.
- Still needs validation for any remaining supported fields.

**Effort:** 1-2 hours

**Risk:** Low

## Recommended Action

Reject unsupported V0 deploy-config values at load time and document the supported contract so operators cannot silently request behavior the runtime does not implement.

## Technical Details

**Affected files:**
- `src/deploy-package.ts:53`
- `src/import-deploy.ts:22`
- `deploys/example/config.json`
- `test/deploy-package.test.ts`

**Related components:**
- Deploy package loader
- SQL/artifact generation scripts
- Example package used for operator workflows

**Database changes (if any):**
- No

## Resources

- **PR:** `https://github.com/abuiles/lobsterbazaar/pull/2`
- **Spec:** `specs/2026-03-15-byo-merchant-deploy-model.md`
- **Repro:** `node --import tsx/esm --eval ...` run during review on 2026-03-15

## Acceptance Criteria

- [x] Unsupported `claim_mode` values are rejected or fully implemented.
- [x] `offers_enabled` and `public_directory` are either enforced or rejected explicitly.
- [x] Tests cover at least one disabled/unsupported config scenario.
- [x] README/example package describe only the behavior the runtime actually supports.

## Work Log

### 2026-03-15 - Review finding creation

**By:** Codex

**Actions:**
- Reviewed the deploy-package loader and materialization path.
- Reproduced a package with `offers_enabled=false`, `public_directory=false`, and `claim_mode=self_service`.
- Confirmed the loader rewrites `claim_mode` to `operator_managed` and still emits an offers artifact.

**Learnings:**
- The deploy config shape is ahead of the runtime behavior.
- The current tests only cover the happy path and do not protect the config contract.

### 2026-03-15 - Fix completed

**By:** Codex

**Actions:**
- Updated `src/deploy-package.ts` to reject `public_directory=false`, `offers_enabled=false`, and non-`operator_managed` claim modes.
- Added regression coverage for unsupported config values in `test/deploy-package.test.ts`.
- Updated `README.md` to document the supported V0 deploy-config surface.

**Learnings:**
- Failing fast is cleaner than silently coercing config when the runtime does not honor the requested behavior.

## Notes

- This is a contract/behavior mismatch, not a type-system issue. Operators are the ones who will absorb the surprise.
