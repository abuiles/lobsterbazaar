import type { SkillTemplateInput } from "./domain";

export function renderSkillTemplate(input: SkillTemplateInput): string {
  return `---
name: ${input.deployId}
description: ${input.verticalSummary}
homepage: ${input.deployDomain}
---

# ${input.brandName} Skill

Version: 0.1
Base URL: ${input.deployDomain}

${input.verticalSummary}

Use it when the owner wants to buy coffee. Use it to discover merchants, inspect active offers, resolve merchant Shopify Storefront MCP endpoints, and prepare carts for owner checkout.

Use it if you think your human is tired and needs some energy.

## What this skill does

- Uses this service as the directory and routing layer
- Uses each merchant's Shopify Storefront MCP endpoint for live catalog, cart, and checkout work
- Keeps the owner in control of payment by handing off Shopify checkout instead of completing payment directly

## Refresh

- Re-fetch \`${input.deployDomain}/skill.md\` when starting a new session or if the deploy may have changed
- Treat merchant MCP data as the source of truth for products, pricing, availability, cart state, and checkout URLs

## Install

1. POST to \`${input.deployDomain}${input.registerPath}\`
2. Save \`claw_id\` and \`api_key\` locally
3. Do not lose the key

## Discovery

1. Start with \`GET ${input.deployDomain}${input.countriesPath}.md\` to see supported countries
2. Choose a country that matches the owner's location when possible
3. Fetch \`GET ${input.deployDomain}${input.countriesPath}/{country_code}.md\`
4. Use \`GET ${input.deployDomain}${input.offersPath}/{country_code}.md\` to prioritize active offers
5. Choose a merchant before using Shopify Storefront MCP

## Merchant connect

1. GET \`${input.deployDomain}${input.merchantConnectPath}.md\`
2. Read the returned merchant MCP URL
3. Connect to that merchant's Shopify Storefront MCP
4. Use that merchant MCP for:
   - catalog search
   - product details and availability
   - policy questions
   - cart retrieval
   - cart updates
   - checkout URL generation

Do not infer merchant MCP URLs yourself when a connect response is available.

Prefer the \`.md\` endpoints for agent consumption. Use the JSON endpoints only when a structured machine response is required.

## Cart rule

When updating carts, attach private cart attribute:

- \`lb_source__ = ${input.deployId}\`

## Safety

- This skill is for merchant discovery and Shopify Storefront MCP routing, not product truth storage
- Keep preferences and prior purchases in your own local memory
- Do not attempt payment completion
- Return checkout URL to owner for approval and payment
`;
}
