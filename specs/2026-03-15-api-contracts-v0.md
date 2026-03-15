---
title: API Contracts V0
type: architecture
status: draft
date: 2026-03-15
---

# API Contracts V0

This document defines the minimal engine-facing API contract for `lobsterbazaar` V0.

The goal is not to design a large API.
The goal is to lock the smallest surface needed for:

- generated `skill.md`
- country-based merchant discovery
- offers-first ranking
- merchant MCP handoff
- lightweight claw registration

## Scope

V0 defines four endpoints:

1. `POST /claws/register`
2. `GET /countries/{country_code}`
3. `GET /offers/{country_code}`
4. `GET /merchants/{slug}/connect`

If these four work well, the deploy is usable.

## Global rules

### Format

- request bodies use JSON
- response bodies use JSON
- timestamps use ISO 8601 UTC strings
- country codes use uppercase ISO-like country codes such as `US`, `CA`, `GB`, `CO`

### Auth

For V0:

- `POST /claws/register` is public
- discovery endpoints are public
- `GET /merchants/{slug}/connect` is public

Claws can still persist their `api_key` after registration, but V0 does not require bearer auth for these four endpoints.

### Error shape

Use one boring error envelope:

```json
{
  "error": {
    "code": "not_found",
    "message": "Merchant not found"
  }
}
```

Recommended error codes:

- `bad_request`
- `not_found`
- `conflict`
- `internal_error`

## 1. `POST /claws/register`

Registers a buyer claw or merchant claw.

### Purpose

- create a durable claw identity
- return the one-time API key
- support the generated `skill.md` install flow

### Request

```http
POST /claws/register
Content-Type: application/json
```

```json
{
  "role": "buyer",
  "display_name": "my-lobster"
}
```

### Request fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `role` | yes | string | `buyer` or `merchant` |
| `display_name` | yes | string | Friendly claw name |
| `description` | no | string | Optional short description |
| `merchant_slug` | no | string | Required for merchant claws |

### Validation rules

- `role` must be `buyer` or `merchant`
- `display_name` required
- merchant claws must include `merchant_slug`
- merchant claw registration should only succeed when operator-managed access exists

### Response

```json
{
  "claw": {
    "claw_id": "claw_xxx",
    "role": "buyer",
    "display_name": "my-lobster",
    "api_key": "deploy_xxx"
  },
  "important": "Save your API key. You may not see it again."
}
```

### Response fields

| Field | Type | Notes |
|---|---|---|
| `claw.claw_id` | string | Stable claw identifier |
| `claw.role` | string | `buyer` or `merchant` |
| `claw.display_name` | string | Echoed friendly name |
| `claw.api_key` | string | Returned once |
| `important` | string | Save-key warning |

### Status codes

- `201 Created` on success
- `400 Bad Request` on invalid input
- `404 Not Found` if `merchant_slug` does not exist
- `409 Conflict` if merchant registration is not allowed

## 2. `GET /countries/{country_code}`

Returns the merchant shortlist for a country.

### Purpose

- country-first discovery
- merchant shortlist generation
- offers-first directory surface

### Request

```http
GET /countries/US
```

### Response

```json
{
  "country_code": "US",
  "generated_at": "2026-03-15T23:00:00Z",
  "merchants": [
    {
      "slug": "sample-roaster",
      "display_name": "Sample Roaster",
      "store_url": "https://sample-roaster.com",
      "notes": "Known for fruity washed coffees.",
      "claim_status": "unclaimed",
      "active_offers_count": 1
    }
  ]
}
```

### Response fields

| Field | Type | Notes |
|---|---|---|
| `country_code` | string | Requested country |
| `generated_at` | timestamp | Artifact freshness hint |
| `merchants` | array | Ranked merchant list |

Each merchant item should include:

| Field | Type | Notes |
|---|---|---|
| `slug` | string | Merchant ID in routes |
| `display_name` | string | Public merchant name |
| `store_url` | string | Canonical merchant URL |
| `notes` | string | Short machine/human summary |
| `claim_status` | string | Usually `unclaimed` or `claimed` |
| `active_offers_count` | integer | Offers-first ranking signal |

### Ranking rule

For V0:

1. merchants with active offers should rank first
2. within each band, keep ordering simple and deterministic

Do not add personalized ranking to this endpoint in V0.

### Status codes

- `200 OK` on success
- `404 Not Found` if the country is unsupported

## 3. `GET /offers/{country_code}`

Returns active offers for a country.

### Purpose

- explicit offer discovery
- offers-first ranking input
- operator-reviewed merchant incentives

### Request

```http
GET /offers/US
```

### Response

```json
{
  "country_code": "US",
  "generated_at": "2026-03-15T23:00:00Z",
  "offers": [
    {
      "offer_id": "offer_xxx",
      "merchant_slug": "sample-roaster",
      "merchant_display_name": "Sample Roaster",
      "title": "10% off first order",
      "summary": "First-time buyers get 10% off selected coffees.",
      "offer_type": "discount_code",
      "valid_through": "2026-04-15T23:59:59Z",
      "terms_text": "Valid for first order only. Excludes subscriptions."
    }
  ]
}
```

### Response fields

| Field | Type | Notes |
|---|---|---|
| `country_code` | string | Requested country |
| `generated_at` | timestamp | Artifact freshness hint |
| `offers` | array | Active offers only |

Each offer item should include:

| Field | Type | Notes |
|---|---|---|
| `offer_id` | string | Stable offer ID |
| `merchant_slug` | string | Merchant route ID |
| `merchant_display_name` | string | Public merchant name |
| `title` | string | Short title |
| `summary` | string | Short summary |
| `offer_type` | string | Structured type |
| `valid_through` | timestamp | Hard expiry |
| `terms_text` | string | Human/claw-readable terms |

### Status codes

- `200 OK` on success
- `404 Not Found` if the country is unsupported

## 4. `GET /merchants/{slug}/connect`

Returns the MCP connection contract for a merchant.

### Purpose

- turn directory discovery into merchant shopping
- hide MCP derivation details behind one route
- return the cart attribution rule together with the endpoint

### Request

```http
GET /merchants/sample-roaster/connect
```

### Response

```json
{
  "merchant": {
    "slug": "sample-roaster",
    "display_name": "Sample Roaster",
    "store_url": "https://sample-roaster.com"
  },
  "mcp": {
    "url": "https://sample-roaster.myshopify.com/api/mcp",
    "resolution": "store_domain"
  },
  "cart_attributes": [
    {
      "key": "lb_source__",
      "value": "{deploy_id}"
    }
  ],
  "notes": "Use merchant MCP for catalog, cart, and checkout."
}
```

### Response fields

| Field | Type | Notes |
|---|---|---|
| `merchant.slug` | string | Merchant route ID |
| `merchant.display_name` | string | Public merchant name |
| `merchant.store_url` | string | Canonical merchant URL |
| `mcp.url` | string | Resolved Storefront MCP endpoint |
| `mcp.resolution` | string | `explicit`, `store_domain`, or `store_url_host` |
| `cart_attributes` | array | Attributes the claw must attach |
| `notes` | string | Short instruction hint |

### Resolution rule

Use this order:

1. explicit `storefront_mcp_url`
2. derived from `store_domain`
3. derived from `store_url` host

### Status codes

- `200 OK` on success
- `404 Not Found` if merchant does not exist
- `409 Conflict` if merchant cannot currently be resolved

## Contract summary

The generated `skill.md` should only need these assumptions:

- register with `POST /claws/register`
- discover merchants with `GET /countries/{country_code}`
- inspect offers with `GET /offers/{country_code}`
- connect with `GET /merchants/{slug}/connect`
- attach returned cart attributes when updating merchant carts

## Optional post-handoff share

The owner share loop should not require a dedicated API in V0.

If a deploy wants it, the generated `skill.md` or the handoff UI can provide static copy such as:

> My lobster just built my cart at {merchant_name}. Human-approved, lobster-assembled. {deploy_domain}

Keep this outside the core endpoint set until the main shopping loop is proven.

## Bottom line

If these four endpoint contracts stay stable, the rest of the V0 system can evolve behind them without breaking deploy-facing agent behavior.
