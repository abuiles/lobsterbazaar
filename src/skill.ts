import type { CategorySkillTemplateInput, RootSkillTemplateInput } from "./domain";

export function renderRootSkillTemplate(input: RootSkillTemplateInput): string {
  const categoryLines = input.categories.length === 0
    ? ["No categories are published yet."]
    : input.categories.flatMap((category) => [
        `- ${category.name} (\`${category.slug}\`)`,
        `  - summary: ${category.summary}`,
        `  - skill_path: \`${category.skillPath}\``,
        `  - countries_path: \`${category.countriesPath}\``
      ]);

  return `---
name: ${input.deployId}
description: ${input.directorySummary}
homepage: ${input.deployDomain}
---

# ${input.brandName} Root Skill

Version: 2.0.0
Base URL: ${input.deployDomain}

${input.directorySummary}

Use this root skill to choose the right category first. Do not start merchant discovery from the root. Pick a category, then switch to that category's skill before browsing merchants or offers.

## What this skill does

- Lists the categories available in this instance
- Routes the agent into the right category-specific skill
- Keeps merchant discovery category-scoped from the first real discovery step onward
- Does not require claw registration for read-only discovery

## Discovery

1. Start with \`GET ${input.deployDomain}${input.categoriesPath}.md\`
2. Choose the category that best matches the owner's intent
3. Fetch that category's skill at \`GET ${input.deployDomain}/{category}/skill.md\`
4. Continue discovery only inside that category namespace

## Published Categories

${categoryLines.join("\n")}

## Safety

- Do not treat the root as a merchant discovery surface
- Do not mix merchants across categories unless a future root aggregation route explicitly exists
- Keep preferences and prior purchases in your own local memory
- Do not attempt payment completion
`;
}

export function renderCategorySkillTemplate(input: CategorySkillTemplateInput): string {
  const buyingTargets = input.skillBuyingTargets?.trim() || input.category.skillBuyingTargets?.trim()
    || `from merchants in the ${input.category.name.toLowerCase()} category`;

  return `---
name: ${input.deployId}-${input.category.slug}
description: ${input.category.summary}
homepage: ${input.deployDomain}
---

# ${input.brandName} ${input.category.name} Skill

Version: 2.0.0
Base URL: ${input.deployDomain}
Category: ${input.category.name} (\`${input.category.slug}\`)

${input.category.summary}

Use it when the owner wants to buy ${buyingTargets}. Use it to discover merchants, inspect active offers, resolve merchant Shopify Storefront MCP endpoints, and prepare carts for owner checkout.

## What this skill does

- Uses this service as the category-specific directory and routing layer
- Uses each merchant's Shopify Storefront MCP endpoint for live catalog, cart, and checkout work
- Keeps the owner in control of payment by handing off Shopify checkout instead of completing payment directly
- Uses the installed skill file as the authoritative instruction source
- Does not require claw registration for discovery or merchant handoff

## Discovery

1. Start with \`GET ${input.deployDomain}${input.countriesPath}.md\` to see supported countries for this category
2. Choose a country that matches the owner's location when possible
3. Fetch \`GET ${input.deployDomain}${input.countriesPath}/{country_code}.md\`
4. Use \`GET ${input.deployDomain}${input.offersPath}/{country_code}.md\` to prioritize active offers in this category
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

Treat merchant MCP data as the source of truth for products, pricing, availability, cart state, and checkout URLs.

## Cart rule

When updating carts, attach private cart attribute only if the merchant MCP supports cart attributes cleanly:

- \`lb_source__ = ${input.deployId}\`

Otherwise omit the attribute instead of assuming support.

## Safety

- This skill is for merchant discovery and Shopify Storefront MCP routing, not product truth storage
- Keep preferences and prior purchases in your own local memory
- Do not attempt payment completion
- Return checkout URL to owner for approval and payment
- Do not infer merchant MCP URLs yourself when a connect response is available
`;
}
