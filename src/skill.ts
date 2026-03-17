import type { SkillTemplateInput } from "./domain";

export function renderSkillTemplate(input: SkillTemplateInput): string {
  const buyingTargets = input.skillBuyingTargets?.trim() || "from merchants in this vertical";

  return `---
name: ${input.deployId}
description: ${input.verticalSummary}
homepage: ${input.deployDomain}
---

# ${input.brandName} Skill

Version: 0.1
Base URL: ${input.deployDomain}

${input.verticalSummary}

Use it when the owner wants to buy ${buyingTargets}. Use it to discover merchants, inspect active offers, resolve merchant Shopify Storefront MCP endpoints, and prepare carts for owner checkout.

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

## Subscription products

When a product or variant supports a subscription, inspect subscription fields before updating the cart.

1. Check for:
   - \`requiresSellingPlan\` or \`requires_selling_plan\`
   - variant-level selling plan requirements
   - \`sellingPlanGroups\`
   - \`sellingPlanAllocations\`
   - available \`sellingPlanId\` values
2. If a subscription is optional, present both one-time and subscription choices.
3. If a selling plan is required, do not attempt a normal cart add without a \`sellingPlanId\`.
4. Ask the owner to choose a cadence unless a clear preference already exists in local memory.
5. Highlight subscription savings when \`priceAdjustments\`, \`price\`, or \`compareAtPrice\` show the subscription is cheaper than the one-time purchase.
6. Try the merchant MCP cart and checkout flow first.
7. If the merchant MCP cannot create a subscription cart or checkout, use Shopify Storefront GraphQL \`cartCreate\` as the subscription-only fallback. Use the same shop behind the merchant MCP URL. Prefer documented tokenless access when it works for that merchant. Use a storefront access token only when merchant context provides one.
8. In the GraphQL fallback, send:
   - \`merchandiseId\`
   - \`quantity\`
   - \`sellingPlanId\`
   - cart \`attributes\`, including \`lb_source__ = ${input.deployId}\`
9. Request:
   - \`checkoutUrl\`
   - \`sellingPlanAllocation\`
   - \`userErrors\`

## Cart rule

When updating carts, attach private cart attribute:

- \`lb_source__ = ${input.deployId}\`

## Final handoff

When you finish, return a structured summary with:

- \`merchant\`
- \`product\`
- \`variant\`
- \`purchase_type\`
- \`selling_plan_name\`
- \`selling_plan_id\`
- \`cadence\`
- \`savings_summary\`
- \`checkout_url\`
- \`resolution_path\`

Use \`resolution_path = mcp_cart\` when merchant MCP created the cart.
Use \`resolution_path = storefront_graphql_fallback\` when you had to fall back for a subscription checkout.

Say clearly when:

- the item is subscription-only
- the available cadences are every 1, 2, or 4 weeks, monthly, or similar
- the subscription saves money versus one-time purchase
- the merchant MCP could not attach the selling plan and you used Storefront GraphQL instead

## Safety

- This skill is for merchant discovery and Shopify Storefront MCP routing, not product truth storage
- Keep preferences and prior purchases in your own local memory
- Do not attempt payment completion
- Return checkout URL to owner for approval and payment
`;
}
