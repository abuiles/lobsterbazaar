---
date: 2026-03-21
topic: multi-category-instance-directory
---

# Multi-Category Instance Directory

## What We're Building

LobsterBazaar should move from a "one instance per category" model to a "one instance with many categories" model. The instance becomes the durable directory host, while categories such as `coffee` and `bread` become first-class discovery surfaces under that instance.

The root should support both human and agent entry. It should introduce the available categories and provide a root `skill.md` that tells agents to choose a category before doing merchant discovery. Agents that already know the category should be able to enter directly through category-specific paths such as `/coffee/skill.md`, `/coffee/countries/us`, and `/coffee/merchants/{slug}/connect`.

This keeps the product aligned with the end goal: a directory for LLM agents to discover Shopify merchants by category, without requiring a separate deployed instance for every category.

## Why This Approach

We considered three shapes:

- One instance with an explicit category layer and shared merchant truth
- One instance with category discovery but global merchant pages
- One root directory that federates multiple per-category deploys

The chosen direction is the first option. It matches the product goal directly and keeps the system simple in the right place. Categories become explicit, stable, agent-facing entrypoints. Merchant truth stays canonical and shared, which avoids copying the same merchant into multiple category-specific records. This also preserves room for one merchant to appear in multiple categories without splitting identity or MCP routing.

We are not treating the root as a second merchant discovery surface. The root exists to list categories and guide agents into one. Canonical merchant discovery happens inside a chosen category.

## Key Decisions

- One instance hosts many categories: the instance is the long-lived directory surface, not a single-category deploy.
- Categories are explicit records: categories such as `coffee` and `bread` should be operator-defined first-class entities, not inferred from merchant tags.
- Categories are flat for now: top-level categories are enough for V1; subcategories are deferred.
- Root and direct entry both matter: the root should expose a category index and root `skill.md`, while category-specific deep links remain valid entrypoints.
- Each category gets its own `skill.md`: `/{category}/skill.md` is the authoritative agent bootstrap surface once a category is chosen.
- Merchant truth is shared globally: a merchant should exist as one canonical record and can belong to multiple categories.
- Category membership is a discovery lens: category changes where a merchant appears and how an agent enters the flow, but it does not create duplicate merchant records.
- Merchant pages stay category-scoped: canonical agent-facing paths should remain inside the category namespace, such as `/{category}/merchants/{slug}` and `/{category}/merchants/{slug}/connect`.
- Country discovery is category-scoped: the canonical discovery path is `/{category}/countries/{country_code}`.
- Root aggregated country discovery is deferred: we should not add root `/countries/{country_code}` as a first-class surface in V1 because it mixes categories and weakens the discovery contract.

## Resolved Questions

- Should the instance support both root entry and direct category entry? Yes.
- Can one merchant belong to multiple categories? Yes.
- Should merchant metadata be shared or category-specific? Shared globally.
- Should each category have its own `skill.md`? Yes, plus a root `skill.md`.
- Should merchant routes stay inside the category namespace? Yes.
- Should categories be explicit or inferred from tags? Explicit.
- Should categories be flat or hierarchical for now? Flat.

## Open Questions

- None for the current product scope.

## Next Steps

Move to `/ce:plan` to define the implementation changes required to make routes, artifact generation, and deploy configuration category-aware while preserving one shared merchant directory.
