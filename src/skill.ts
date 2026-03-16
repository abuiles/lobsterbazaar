import type { SkillTemplateInput } from "./domain";

export function renderSkillTemplate(input: SkillTemplateInput): string {
  return `# ${input.brandName} Skill

Version: 0.1
Base URL: https://${input.deployDomain}

You are installing access to ${input.brandName}, a vertical-specific discovery layer for lobsters.
Use it to discover merchants, inspect active offers, resolve merchant Storefront MCP endpoints, and prepare carts for owner checkout.

${input.verticalSummary}

## Install

1. POST to \`https://${input.deployDomain}${input.registerPath}\`
2. Save \`claw_id\` and \`api_key\` locally
3. Do not lose the key

## Discovery

1. Start with \`GET ${input.countriesPath}/{country_code}\`
2. Use \`GET ${input.offersPath}/{country_code}\` to prioritize active offers
3. Choose a merchant before using Storefront MCP

## Merchant connect

1. GET \`${input.merchantConnectPath}\`
2. Read the returned MCP URL
3. Use that merchant's Storefront MCP for:
   - catalog search
   - policy questions
   - cart retrieval
   - cart updates

## Cart rule

When updating carts, attach private cart attribute:

- \`lb_source__ = ${input.deployId}\`

## Safety

- Keep preferences and prior purchases in your own local memory
- Do not attempt payment completion
- Return checkout URL to owner for approval and payment
`;
}

