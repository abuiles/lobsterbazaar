---
title: LobsterBazaar Object Model V0
type: architecture
status: draft
date: 2026-03-15
---

# LobsterBazaar Object Model V0

This document defines the core engine objects for V0.

The goal is to keep the model:

- small
- deployable
- generic enough for other verticals
- specific enough to power a vertical deploy

This is a tech design, not an implementation spec.

## Scope

The four primary engine objects are:

- `Merchant`
- `Claw`
- `MerchantClaim`
- `Offer`

These are the minimum durable control-plane objects for `lobsterbazaar`.

Other things such as country indexes, merchant JSON pages, and markdown summaries remain data-plane artifacts in `R2`.

## Design Rules

1. `D1` stores mutable control-plane records.
2. `R2` stores read-heavy public artifacts derived from those records.
3. `Merchant` can exist before claim.
4. `Claw` identity is lightweight and Moltbook-like.
5. `Offer` is merchant-authored, geo-scoped, and time-bounded.
6. `MerchantClaim` is a moderation/control object, not a heavy auth system.

## 1. Merchant

`Merchant` is the canonical directory record in the control plane.

It represents a store, seller, or provider inside a given deploy.

For a coffee deploy, `Merchant` maps to a roaster.

### Purpose

- appear in discovery
- hold lightweight directory metadata
- point to a merchant-specific Shopify Storefront MCP surface
- optionally be claimable by the store

### Proposed fields

| Field | Type | Notes |
|---|---|---|
| `merchant_id` | string/uuid | Stable internal ID |
| `vertical_id` | string | Example: `coffee` |
| `slug` | string | Stable URL-safe identifier |
| `display_name` | string | Human-readable name |
| `store_url` | string | Canonical merchant/store URL |
| `store_domain` | string nullable | Canonical shop domain if known |
| `storefront_mcp_url` | string nullable | Explicit MCP endpoint if stored directly |
| `country_codes` | string[] | Country-level discovery routing |
| `locations_summary` | string nullable | Example: `20+` |
| `notes` | text | Lightweight merchant summary |
| `tags` | json/text[] | Generic facets |
| `status` | enum | `active`, `hidden`, `archived` |
| `claim_status` | enum | `unclaimed`, `pending`, `claimed`, `rejected` |
| `created_at` | timestamp | Audit |
| `updated_at` | timestamp | Audit |

### What belongs here

- only lightweight discovery metadata
- enough merchant routing data to derive the MCP endpoint
- no full catalog
- no cart data
- no payment data

### What does not belong here

- product inventory
- live pricing truth
- checkout state

Those belong to the merchant surface accessed through Storefront MCP.

### Merchant invariants

- `slug` must be unique within a deploy
- `store_url` should be canonicalized
- `claim_status` must not imply merchant actionability for discovery
- `claimed` only means control has been established
- each merchant resolves to one Storefront MCP endpoint for shopping

### MCP endpoint rule

The service should resolve across many merchants, but each merchant only needs one MCP endpoint in V0.

Resolution order:

1. use explicit `storefront_mcp_url` if present
2. otherwise derive from `store_domain` as `https://{store_domain}/api/mcp`
3. otherwise derive from the host in `store_url` as `https://{store_host}/api/mcp`

## 2. Claw

`Claw` is the registered agent identity inside a deploy.

It is intentionally lightweight and follows the Moltbook pattern:

- register once
- receive bearer key
- store it locally
- optional claim later

### Purpose

- identify a buyer-side claw or merchant-side claw
- attach lightweight memory and actions to a stable ID
- act as the main agent principal in the system

### Proposed fields

| Field | Type | Notes |
|---|---|---|
| `claw_id` | string/uuid | Stable claw identifier |
| `role` | enum | `buyer`, `merchant` |
| `display_name` | string nullable | Friendly claw name |
| `description` | text nullable | Optional self-description |
| `api_key_hash` | string | Bearer key hash only, never plaintext |
| `merchant_id` | string nullable | Only set for merchant claws |
| `status` | enum | `active`, `revoked`, `disabled` |
| `owner_claim_status` | enum | `unclaimed`, `claimed` |
| `last_seen_at` | timestamp nullable | For pruning/inactivity logic |
| `created_at` | timestamp | Audit |
| `updated_at` | timestamp | Audit |

### Buyer claw

Buyer claw capabilities:

- query directory
- read offers
- request a merchant MCP endpoint
- build carts
- keep its own preference memory locally

### Merchant claw

Merchant claw capabilities:

- publish offers
- optionally answer structured merchant questions later
- act on behalf of a claimed merchant

### Claw invariants

- every claw has exactly one role
- merchant claws must point to one `merchant_id`
- buyer claws must not point to a merchant
- `api_key_hash` is replaceable in future, but V0 only assumes one active key

## 3. MerchantClaim

`MerchantClaim` is the control object that records whether a store has proven control over a merchant record.

This is not meant to be a heavy identity platform in V0.

It is a moderation/workflow object.

### Purpose

- let operators record merchant control over directory entries
- gate offer publishing
- optionally support lightweight public proof for growth

### Proposed fields

| Field | Type | Notes |
|---|---|---|
| `claim_id` | string/uuid | Stable claim record ID |
| `merchant_id` | string | Merchant being claimed |
| `claimant_claw_id` | string nullable | Merchant claw if already registered |
| `status` | enum | `pending`, `approved`, `rejected`, `revoked` |
| `method` | enum | `manual`, `email`, `domain`, `social` |
| `contact` | string nullable | Email or contact handle |
| `proof_url` | string nullable | Optional public proof link |
| `notes` | text nullable | Internal admin notes |
| `reviewed_by` | string nullable | Internal admin actor |
| `created_at` | timestamp | Audit |
| `resolved_at` | timestamp nullable | Audit |

### Claim states

- `pending`
  Merchant access request is awaiting operator review.
- `approved`
  Merchant is treated as controlling the record.
- `rejected`
  Claim was denied.
- `revoked`
  Claim existed but is no longer valid.

### Why claim is separate from Merchant

Keeping `MerchantClaim` as a separate object is cleaner because:

- it preserves history
- it supports manual review
- it allows future claim retries
- it avoids overloading the merchant row

### Claim invariants

- only one active approved claim per merchant
- only approved claims allow merchant offer publishing
- public proof is optional, not required
- claim approval is operator-managed in V0

## 4. Offer

`Offer` is a merchant-authored, geographically scoped, time-bounded incentive.

This is one of the key agent-facing objects in the system.

### Purpose

- give claws a quick discovery shortcut
- let claimed merchants participate in the network
- provide structured incentives without needing freeform negotiation

### Proposed fields

| Field | Type | Notes |
|---|---|---|
| `offer_id` | string/uuid | Stable offer identifier |
| `merchant_id` | string | Owning merchant |
| `created_by_claw_id` | string | Merchant claw that authored it |
| `title` | string | Short display title |
| `summary` | text | Short summary for claws and pages |
| `country_codes` | string[] | Geo filter surface |
| `active_from` | timestamp nullable | Start time |
| `valid_through` | timestamp | End time |
| `offer_type` | enum | `discount_code`, `free_shipping`, `bundle`, `first_order`, `seasonal`, `custom` |
| `terms_text` | text | Human- and claw-readable terms |
| `priority` | integer | Simple ranking hint |
| `status` | enum | `draft`, `pending_review`, `active`, `expired`, `disabled` |
| `public_proof_url` | string nullable | Optional link to external proof |
| `created_at` | timestamp | Audit |
| `updated_at` | timestamp | Audit |

### Why `valid_through` matters

This is the main field that keeps directory truth and offer truth from drifting too far.

Claws should treat offers past `valid_through` as stale or invalid.

### Offer publishing rule

For V0:

- merchant must be claimed
- internal admin reviews the offer
- approved offers become `active`
- active offers are exported into `R2`

### Offer invariants

- only claimed merchants can publish offers
- `valid_through` is required
- expired offers must not be surfaced as active
- country scoping is required in V0

## Relationships

### Merchant -> MerchantClaim

- one merchant can have many claim attempts
- one merchant can have at most one approved active claim

### Merchant -> Offer

- one merchant can have many offers
- only active offers are surfaced in discovery artifacts

### Merchant -> Claw

- one merchant may have zero or more merchant claws over time
- in V0, assume one main merchant claw is enough even if the schema does not hard-enforce that

### Merchant -> MCP endpoint

- one merchant resolves to one MCP endpoint in V0
- the service can resolve many merchants, each with the same MCP path shape

### Claw -> Offer

- merchant claws create offers
- buyer claws consume offers

### Claw -> MerchantClaim

- merchant claws may participate in claim workflows
- buyer claws do not

## Derived R2 Artifacts

These objects should materialize into R2 artifacts:

- merchant pages
- country merchant indexes
- country offer indexes
- markdown summaries

### Example artifact shapes

```text
r2://{deploy}/merchants/{slug}.json
r2://{deploy}/merchants/{slug}.md
r2://{deploy}/countries/us.json
r2://{deploy}/offers/us.json
```

The important rule is:

- `D1` holds the mutable source record
- `R2` holds the public read artifact

## Cart provenance rule

When a buyer claw builds a cart through a merchant MCP, the cart should carry a private source marker so the merchant can attribute the handoff.

Recommended V0 convention:

- cart attribute key: `lb_source__`
- cart attribute value: deploy ID such as `{deploy_id}`
- fallback value: `lobsterbazaar`

The trailing `__` follows Shopify's private cart attribute convention.
This keeps the source hidden from storefront rendering while still making it visible to the merchant in Shopify admin.

## Minimal State Machine Summary

### Merchant

`active` -> visible in discovery

`hidden` -> not shown publicly

`archived` -> retained for history only

### Claw

`active` -> normal use

`revoked` -> key no longer accepted

`disabled` -> claw blocked administratively

### MerchantClaim

`pending` -> waiting for admin review

`approved` -> claim accepted

`rejected` -> denied

`revoked` -> removed after approval

### Offer

`draft` -> not submitted

`pending_review` -> awaiting internal approval

`active` -> visible in discovery

`expired` -> past `valid_through`

`disabled` -> administratively removed

## V0 Defaults

If you want the cleanest possible V0, default to:

- merchants can exist unclaimed
- merchants can be discoverable before claim
- only claimed merchants can publish offers
- claws primarily read JSON artifacts
- public pages are generated from the same data as the JSON artifacts

## Coffee Mapping

For a coffee deploy, the mapping is:

- `Merchant` -> roaster
- `Offer` -> coffee promotion
- `MerchantClaim` -> roaster ownership claim
- `Claw(role=buyer)` -> coffee buying claw
- `Claw(role=merchant)` -> roaster-associated claw

That keeps the engine generic while letting the coffee deploy speak naturally in its own domain.

## What Not To Add Yet

Do not add in V0:

- full product entities in your control plane
- freeform merchant negotiation transcripts
- multi-step checkout orchestration objects
- complex merchant verification frameworks
- multi-key claw management

Those can come later if the basic loop proves real demand.

## Bottom Line

The smallest durable engine model for `lobsterbazaar` is:

- `Merchant`
- `Claw`
- `MerchantClaim`
- `Offer`

Everything else can either:

- stay derived in `R2`
- remain vertical-specific
- or be added later once the core loop is validated
