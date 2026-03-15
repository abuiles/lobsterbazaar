---
title: LobsterBazaar System Map V0
type: architecture
status: draft
date: 2026-03-15
---

# LobsterBazaar System Map V0

## Product Boundary

`lobsterbazaar` is the generalized engine.

A deploy is built on top of it.

So the architecture should separate:

- **engine concerns** that generalize across many verticals
- **vertical concerns** that are coffee-specific today

## Engine Boundary

The engine is:

- a directory and discovery layer
- a buyer-side reasoning layer for OpenClaw-style agents
- a cart-building orchestration layer
- a checkout handoff layer

The engine is not:

- a payment processor
- a merchant backend
- a full autonomous purchaser

## Coffee Vertical Boundary

The coffee vertical is:

- a specialization of the engine for coffee roasters
- a coffee-specific taxonomy, metadata model, and recommendation layer
- an example vertical surface for the engine

The coffee vertical is not the engine itself.

That distinction matters because the reusable abstractions should live in `lobsterbazaar`, while vertical-specific language and schemas should live in the deploy layer.

The claw can discover, reason, and build carts.
The human owner still completes payment in Shopify checkout.

## High-Level Flow

```text
CSV / source files
    ->
normalized roaster directory
    ->
country index
    ->
agent chooses country-relevant roasters
    ->
agent selects one roaster
    ->
agent resolves that merchant's Storefront MCP endpoint
    ->
agent searches catalog and policies
    ->
agent builds or updates cart
    ->
agent returns Shopify checkout URL to owner
    ->
owner pays
```

## Core Design Choice

For V0, discovery and transaction should be separated:

### Engine discovery layer

`lobsterbazaar` owns:

- merchant directory
- region/country routing
- lightweight merchant metadata
- normalized notes for LLM discoverability
- merchant MCP endpoint resolution
- the handoff contract into a merchant-specific shopping surface

### Vertical metadata layer

A coffee deploy owns coffee-specific concepts like:

- roasters
- origins
- process methods
- roast styles
- brewing intent
- local preference and repeat-avoidance logic inside the lobster

### Merchant transaction layer

The selected merchant owns:

- catalog truth
- pricing truth
- inventory truth
- cart state
- checkout URL
- payment collection

That merchant layer is accessed through Shopify Storefront MCP.

## Why This Boundary Is Good

It keeps your system lean and safe:

- You do not need to mirror every product catalog centrally.
- You do not need payment credentials.
- You do not need to own checkout.
- You only need enough metadata to help the claw choose the right merchant and ask the right questions.

It also matches Shopify's actual model:

- Storefront MCP is merchant-specific.
- It is good for a single store's catalog, policies, cart, and checkout handoff.
- Ecosystem-wide discovery is a separate concern.

Relevant Shopify docs:

- About Storefront MCP: https://shopify.dev/docs/apps/build/storefront-mcp
- Storefront MCP server: https://shopify.dev/docs/apps/build/storefront-mcp/servers/storefront
- Storefront MCP for agents: https://shopify.dev/docs/agents/catalog/storefront-mcp

## Canonical Claw Contract

To keep claw behavior predictable, use one simple rule:

- JSON is the canonical machine surface
- public pages are rendered from the same underlying records
- Markdown is a secondary LLM-friendly representation

That means the simple fix for page/API drift is:

1. keep one canonical record in `R2`
2. return it through the Worker API
3. render the public page from that same record

So claws can browse pages if they want, but the stable contract is still the JSON surface.

## Recommended Runtime Shape

### Static-first

Use static pages and files for:

- country discovery
- roaster pages
- offer listings
- machine-readable metadata

### Minimal dynamic layer

Use one Worker plus a small mutable store for:

- claw registration
- merchant claim state
- active offers
- merchant-to-MCP resolution

That keeps the architecture light while still supporting claims and offers.

## Storage Model

The clean storage split for V0 is:

- `D1` = control plane
- `R2` = data plane

That should be the default architectural rule for `lobsterbazaar`.

### D1 as control plane

Use `D1` for:

- claws
- claw keys
- merchant claims
- merchant MCP connection metadata
- active offers

This is the mutable, relational part of the system.

### R2 as data plane

Use `R2` for:

- roaster directory files
- country indexes
- merchant JSON records
- markdown summaries
- offer exports
- public machine-readable artifacts for claws

This is the read-heavy, publishable part of the system.

### Design principle

Think of it this way:

- `D1` decides what exists, who controls it, and what is active.
- `R2` is what claws and public surfaces mostly read.

## Recommended V0 Architecture

### 1. Roaster directory as static data

Start with files, not a rich backend.

Input:

- CSV like:
  - `store_url`
  - `locations`
  - `country`
  - `notes`

Normalized output:

- `countries/{country}.json`
- `roasters/{slug}.json`
- optionally `roasters/{slug}.md`

Recommended initial shape:

```text
directory/
  countries/
    us.json
    canada.json
    united-kingdom.json
  roasters/
    200-degs.json
    200-degs.md
    1-nation-distribution.json
    1-nation-distribution.md
  index.json
```

### 2. R2 as source of truth for directory files

R2 is a good fit for:

- mostly-static roaster records
- country indexes
- generated markdown summaries
- import artifacts from CSV

Why:

- cheap object storage
- easy to serve through Workers
- simple to regenerate from source CSV
- well aligned with a file-first, LLM-friendly directory

## File Format Recommendation

Use both JSON and Markdown.

### JSON

Use for:

- structured filtering
- machine-readable fields
- country indexes
- MCP endpoint metadata
- active offer listings

Example:

```json
{
  "slug": "200-degs",
  "display_name": "200 Degrees Coffee",
  "store_url": "200degs.com",
  "country": "United Kingdom",
  "country_code": "GB",
  "locations_summary": "20+",
  "notes": "200 Degrees Coffee operates more than twenty independent cafes around the UK.",
  "store_domain": "200degs.myshopify.com",
  "storefront_mcp_url": "https://200degs.myshopify.com/api/mcp",
  "tags": ["specialty-coffee", "uk", "multi-location"]
}
```

### Markdown

Use for:

- LLM-readable summaries
- future prompt injection into the claw
- richer merchant descriptions
- compact human review

Example sections:

- Who they are
- Country
- Why this roaster may be relevant
- What we know
- What we still need to verify
- Storefront MCP endpoint if known

## Country-First Discovery

Your idea is correct as the default first pass:

```text
country -> roasters
```

This is the simplest useful routing primitive.

Why it works:

- it avoids irrelevant roasters early
- it keeps the shortlist small
- it is easy to explain
- it is easy to encode in static files

### My recommendation

Use a routing ladder, not only country:

```text
country
  -> shortlist roasters
  -> active offers first
```

The lobster can apply its own saved preferences and purchase history locally after that.

## Minimum Backend

I would not go fully backend-free.
I would use one very small Worker.

### Worker responsibilities

1. Serve the directory cleanly.
2. Resolve country -> candidate roasters.
3. Resolve roaster metadata into the correct Storefront MCP endpoint.
4. Register claws.
5. Manage merchant claim status.
6. Publish and query active offers.
7. Refresh R2 artifacts when mutable state changes.

That is enough.

In engine terms, those responsibilities become:

1. Serve directory records for the active vertical.
2. Resolve region/country -> merchant candidates.
3. Resolve merchant metadata into the correct Storefront MCP endpoint.
4. Register buyer or merchant claws.
5. Manage merchant claim status.
6. Publish and query active offers.
7. Refresh R2 artifacts when mutable state changes.

### Cart source attribution

When a claw updates a merchant cart through the merchant MCP, it should attach a private cart attribute so the merchant can attribute the handoff.

Recommended V0 convention:

- key: `lb_source__`
- value: deploy ID such as `{deploy_id}`
- fallback value: `lobsterbazaar`

The trailing `__` follows Shopify's private cart attribute convention.

### What should stay out of the backend

- full product indexing for every roaster
- merchant catalog mirroring
- payment logic
- complex session orchestration

## Identity Model V0

For V0, keep identity close to Moltbook:

- claw registers once
- system returns a bearer key
- claw is responsible for persisting that key
- optional owner claim can happen later

That means the first version does not need:

- multi-key management
- key rotation flows
- strong recovery tooling
- a heavier identity control plane

### Registration flow

The Worker returns something like:

```json
{
  "claw": {
    "claw_id": "claw_xxx",
    "api_key": "coffee_xxx",
    "claim_url": "https://your-system.example/claim/coffee_claim_xxx"
  },
  "important": "Save your API key. You may not see it again."
}
```

### Persistence rule

The claw must store:

- `claw_id`
- `api_key`

locally in its own memory or file system.

Preferences and anonymous memory are then associated with `claw_id`.
Preferences and purchase memory should stay with the lobster, not with `lobsterbazaar`.

### Claim model

Claim is still useful even in a lightweight design.

It should mean:

- this claw is associated with a human owner
- the owner can be treated as the trust anchor
- persistent memory is safer to rely on after claim

But claim does not need to unlock a sophisticated recovery system in V0.

### V0 tradeoff

This is intentionally simple.

It accepts:

- if a claw loses its key, recovery may be manual
- durability depends on the claw actually saving the key

That is acceptable for a first version because your product still stops at checkout handoff and does not hold payment credentials.

## Two Claw Types

You now have two useful actor classes:

### 1. Buyer claws

These are the OpenClaw-style agents using the system to:

- discover roasters
- apply their own local preferences
- build carts
- retrieve checkout handoff URLs

### 2. Merchant claws

These are claws associated with a claimed store.

They can later be used to:

- publish structured offers
- answer store-specific questions
- participate in structured negotiation
- help buyers understand merchant constraints

For V0, the engine should at least model that these are different roles, even if both use a very similar registration flow.

## Merchant Claim Model

For V0, merchant management should be operator-led.
If a store wants to manage its entry, it contacts you and you enable access.

### What claim should mean

Claim should mean:

- this merchant record is controlled by the store
- this merchant can edit metadata or publish offers
- this merchant can register a merchant claw

### V0 approach

Keep this simple.

Suggested V0:

1. Merchant exists in the directory as unclaimed.
2. Merchant contacts you to request management access.
3. You verify control of the store in a lightweight way.
4. You mark the merchant as claimed.
5. You let them register a merchant claw and publish offers.

### Verification options

For V0, the best options are:

- manual approval by you
- email verification to a known store contact
- domain-based verification if feasible

I would avoid building a heavy automated verification system in V0.
Manual or semi-manual verification is acceptable at this stage.

## Merchant Claws And Negotiation

The idea of lobsters negotiating with other lobsters is interesting, but I would scope it carefully.

### Recommendation

Do not make freeform negotiation a V0 requirement.

Start with **structured merchant participation**:

- merchant publishes offers
- buyer claw discovers offers
- buyer claw asks structured questions
- merchant claw may respond with structured answers later

That is much safer and lighter than a full autonomous negotiation loop.

### Good V1/V2 shape

If you later add negotiation, make it structured around objects like:

- requested quantity
- shipping region
- offer validity
- discount code
- bundle proposal
- minimum spend

Not open-ended back-and-forth first.

## KV vs D1 Recommendation

For V0, use `D1` and `R2`.
Do not introduce `KV`.

Why:

- claims and offers already justify `D1`
- `R2` can carry the heavy public and discovery reads
- the lobster keeps its own preferences and purchase memory locally

So the recommended storage layout is:

```text
R2 = directory and generated discovery artifacts
D1 = claws, claims, offers
Worker = small API facade and materializer
Worker = small API facade and R2 refresher
```

That is still a lean system.

## Shopify Storefront MCP Role

Once a roaster is selected, your system should hand off to that roaster's Storefront MCP endpoint.

Important points from Shopify docs:

- each store has its own MCP endpoint
- the endpoint is merchant-specific
- it supports store catalog search, policy questions, cart retrieval, and cart updates
- it returns cart state and checkout URL

That means your system should store, derive, or verify:

- the merchant's canonical store domain
- the merchant's Storefront MCP endpoint when known
- optional connection notes

## Proposed Runtime Flow

### Discovery phase

1. Claw asks your directory for roasters relevant to a country.
2. Your system returns a shortlist plus notes.
3. Your system can optionally include active offers in that country.
4. Offers should sort first when present.
5. Claw applies its own saved preferences and picks one or more candidate roasters.

### Merchant phase

1. Your system resolves the chosen roaster to a Storefront MCP endpoint.
2. Claw calls that merchant's MCP tools:
   - `search_shop_catalog`
   - `search_shop_policies_and_faqs`
   - `get_cart`
   - `update_cart`
3. Claw constructs a cart.
4. Claw returns a checkout URL to the owner.

### Merchant offer phase

1. Claimed merchant publishes an offer.
2. Offer is attached to one or more geographies.
3. Offer state is written to `D1`.
4. Derived offer artifacts are written to `R2`.
5. The offer becomes visible in country/region discovery surfaces.
6. Buyer claws can use it as a ranking signal or explicit filter.

## Data Objects

These should be your initial system objects:

- `Merchant`
- `RegionIndex`
- `MerchantConnection`
- `Claw`
- `MerchantClaim`
- `Offer`

For a coffee deploy, those become:

- `Roaster`
- `CountryIndex`
- `RoasterConnection`

### Notes on each

#### Merchant

Static directory metadata.

#### RegionIndex

Fast lookup from country or region to candidate merchants.

#### MerchantConnection

Connection metadata for that merchant:

- store domain
- Storefront MCP endpoint
- notes

#### AnonymousAgentProfile

Top-level anonymous memory keyed by agent or owner scope.

#### Claw

Registered claw identity, buyer or merchant.

#### MerchantClaim

Proof that a merchant record is controlled by the store.

#### Offer

A merchant-authored, geographically scoped incentive that buyer claws can discover.

#### PreferenceProfile

Tastes, brewing intent, recipients, and avoid lists.

#### RecommendationSession

One run of discovery and reasoning.

#### CartCandidate

The products the claw wants to buy before owner approval.

#### CheckoutHandoff

The final checkout URL and related metadata.

## Suggested Directory Shape

The leanest useful public-facing directory API is:

```text
/{vertical}/countries
/{vertical}/countries/{country_code}
/{vertical}/merchants/{slug}
/{vertical}/merchants/{slug}/connect
/{vertical}/offers
/{vertical}/offers/{country_code}
```

Possible responses:

- `/coffee/countries/us` -> returns US roasters
- `/coffee/merchants/200-degs` -> returns merchant record
- `/coffee/merchants/200-degs/connect` -> returns Storefront MCP endpoint and connection notes
- `/coffee/offers/us` -> returns active US offers
- `/coffee/offers/co` -> returns active Colombia offers

This could be served by one Worker in front of R2 and D1.

If you want even less URL nesting in V0, you can still implement it internally as vertical-aware and expose:

```text
/countries/{country_code}
/roasters/{slug}
/offers/{country_code}
```

for the coffee product first, while keeping the internal data model ready for multiple verticals.

## LLM Discoverability Strategy

You said you may do everything as plain text later.
I think the right V0 is not plain text only.
It is:

- structured JSON for routing
- markdown for discoverability

That is the best of both:

- the system stays lean
- the claw gets readable summaries
- you can evolve toward richer prompt-native flows later

## What To Avoid In V0

- importing every Shopify catalog into your own database
- cross-store cart logic in your own system
- user accounts before you need them
- personalized ranking engines before you have enough data
- any payment-touching logic
- fully autonomous merchant-to-buyer negotiation before you have structured offer flows

## Offers

An `/offers` section is a strong idea.

It fits the agent-first product well because it gives claws a fast path to high-intent recommendations.

### Offer requirements

Each offer should have:

- `offer_id`
- `merchant_slug`
- `title`
- `summary`
- `country_codes`
- `active_from`
- `valid_through`
- `offer_type`
- `terms`
- `priority`
- `claim_status`

Possible offer types:

- discount code
- free shipping
- bundle
- first-order incentive
- seasonal promotion
- claw-specific promo

### Geography

Your idea here is right:

```text
/us -> active offers
/co -> active offers
```

I would model offers as country-scoped first, then optionally region-scoped later.

### Publishing model

For V0:

- only claimed merchants can publish offers
- offers are reviewed through an internal admin process
- offers appear in both:
  - country discovery pages
  - merchant pages

### Recommendation use

Offers should influence ranking, not dominate it blindly.

The claw should still reason about:

- taste fit
- repeat avoidance
- merchant trust

Offers can rank first in directory discovery, but the lobster still decides what to buy.

## Open Questions To Resolve Before Coding

1. Should country be determined by explicit user setting, claw memory, or IP/geolocation?
2. Do you want to store lightweight Storefront MCP connection notes, or avoid that entirely in V0?
3. Should the roaster directory be fully public, or only claw-facing?

## Recommended First Slice

If the goal is the leanest possible usable system, the first slice should be:

1. CSV import
2. Vertical-aware country indexes generated from CSV
3. Merchant JSON + Markdown artifacts in R2
4. One D1-backed control plane for claws, claims, and offers
5. One Worker endpoint for directory queries and R2 refresh
6. Storefront MCP handoff when a merchant is selected
7. Country offer pages such as `/us` and `/co`
8. one vertical frontend on top of `lobsterbazaar`

That gets you:

- usable discovery
- lean infrastructure
- safe checkout boundary
- minimal moving parts

## Bottom Line

The V0 architecture I recommend is:

```text
CSV -> normalize -> R2 directory files
                -> D1 control plane
                -> Worker directory API + R2 refresh
                -> vertical-specific merchant selection
                -> resolve merchant Storefront MCP endpoint
                -> build cart + set lb_source__
                -> Shopify checkout URL
```

That is the leanest architecture that still respects your actual product:

- generalized engine first
- coffee specialization on top
- claw shopping second
- Shopify checkout handoff last
- one Storefront MCP endpoint resolved per merchant
- cart provenance marked with `lb_source__`

And the storage rule is:

```text
D1 = control plane
R2 = data plane
```

## What To Standardize Early

Keep this list short:

- merchant manifest schema
- offer schema
- claim flow
- deploy config file

That is enough structure for anyone to bring their own merchants without modifying engine code.

## Optional Growth Hack

Moltbook's claim flow has a built-in growth loop because the human posts publicly to verify ownership.

You could use a lighter version of that idea here for claimed merchants:

- optional post on X
- optional proof link on the merchant page
- optional claim announcement that helps discovery

This should be treated as:

- a growth and social-proof mechanism
- not a required security foundation

For V0, it can be optional and manual.
