import { ensureCountryArtifact, ensureMerchantArtifact, ensureOffersArtifact, ensureSkillArtifact, materializePublicArtifacts } from "./artifacts";
import { readDeployConfig, type Env } from "./config";
import type { MerchantConnectPayload, RegisterClawInput } from "./domain";
import { badRequest, notFound } from "./errors";
import { errorResponse, html, isMethod, json, parseJson, text } from "./http";
import { deriveStorefrontMcpUrl, normalizeCountryCode } from "./merchant";
import { R2ArtifactStore } from "./r2";
import { D1Repositories } from "./d1";
import type { ArtifactStore, Repositories } from "./storage";

interface AppDependencies {
  artifacts: ArtifactStore;
  repositories: Repositories;
  config: ReturnType<typeof readDeployConfig>;
  operatorToken?: string;
  now: () => string;
}

export function createApp(dependencies: AppDependencies) {
  return {
    fetch: async (request: Request): Promise<Response> => {
      try {
        const url = new URL(request.url);
        const pathname = url.pathname.replace(/\/+$/, "") || "/";
        const wantsMarkdown = pathname.endsWith(".md");
        const normalizedPath = wantsMarkdown ? pathname.slice(0, -3) : pathname;

        if (normalizedPath === "/" && isMethod(request, "GET")) {
          return html(renderLandingPage(dependencies.config));
        }

        if (normalizedPath === "/skill" && isMethod(request, "GET")) {
          const skill = await ensureSkillArtifact(dependencies.artifacts, {
            brandName: dependencies.config.brandName,
            deployId: dependencies.config.deployId,
            deployDomain: dependencies.config.deployDomain,
            verticalSummary: dependencies.config.verticalSummary,
            registerPath: "/claws/register",
            countriesPath: "/countries",
            offersPath: "/offers",
            merchantConnectPath: "/merchants/{slug}/connect"
          });

          return text(skill, { headers: { "content-type": "text/markdown; charset=utf-8" } });
        }

        if (normalizedPath === "/claws/register" && isMethod(request, "POST")) {
          const payload = await parseRegisterRequest(request);
          const result = await dependencies.repositories.createClaw(payload, dependencies.config.deployId);

          return json(
            {
              claw: {
                claw_id: result.claw.clawId,
                role: result.claw.role,
                display_name: result.claw.displayName,
                api_key: result.apiKey
              },
              important: "Save your API key. You may not see it again."
            },
            { status: 201 }
          );
        }

        if (normalizedPath === "/countries" && isMethod(request, "GET")) {
          const countryCodes = await dependencies.repositories.listCountryCodes();
          return wantsMarkdown
            ? text(
                renderCountriesIndexMarkdown(countryCodes),
                { headers: { "content-type": "text/markdown; charset=utf-8" } }
              )
            : json({
                generated_at: dependencies.now(),
                countries: countryCodes
              });
        }

        const countryMatch = normalizedPath.match(/^\/countries\/([A-Za-z]{2,3})$/);
        if (countryMatch && isMethod(request, "GET")) {
          const countryCode = normalizeCountryCode(countryMatch[1] ?? "");
          if (!(await dependencies.repositories.supportsCountry(countryCode))) {
            throw notFound("Country not found");
          }

          const artifact = await ensureCountryArtifact(
            dependencies.artifacts,
            dependencies.repositories,
            countryCode,
            dependencies.now()
          );

          if (wantsMarkdown) {
            return text(renderCountryMarkdown(artifact, url.origin), {
              headers: { "content-type": "text/markdown; charset=utf-8" }
            });
          }

          return json({
            country_code: artifact.countryCode,
            generated_at: artifact.generatedAt,
            merchants: artifact.merchants.map((merchant) => ({
              slug: merchant.slug,
              display_name: merchant.displayName,
              store_url: merchant.storeUrl,
              notes: merchant.notes,
              claim_status: merchant.claimStatus,
              active_offers_count: merchant.activeOffersCount
            }))
          });
        }

        const offersMatch = normalizedPath.match(/^\/offers\/([A-Za-z]{2,3})$/);
        if (offersMatch && isMethod(request, "GET")) {
          const countryCode = normalizeCountryCode(offersMatch[1] ?? "");
          if (!(await dependencies.repositories.supportsCountry(countryCode))) {
            throw notFound("Country not found");
          }

          const artifact = await ensureOffersArtifact(
            dependencies.artifacts,
            dependencies.repositories,
            countryCode,
            dependencies.now()
          );

          if (wantsMarkdown) {
            return text(renderOffersMarkdown(artifact.offers, countryCode), {
              headers: { "content-type": "text/markdown; charset=utf-8" }
            });
          }

          return json({
            country_code: artifact.countryCode,
            generated_at: artifact.generatedAt,
            offers: artifact.offers.map((offer) => ({
              offer_id: offer.offerId,
              merchant_slug: offer.merchantSlug,
              merchant_display_name: offer.merchantDisplayName,
              title: offer.title,
              summary: offer.summary,
              offer_type: offer.offerType,
              valid_through: offer.validThrough,
              terms_text: offer.termsText
            }))
          });
        }

        const merchantMatch = normalizedPath.match(/^\/merchants\/([^/]+)\/connect$/);
        if (merchantMatch && isMethod(request, "GET")) {
          const slug = merchantMatch[1] ?? "";
          const artifact = await ensureMerchantArtifact(
            dependencies.artifacts,
            dependencies.repositories,
            slug,
            dependencies.now()
          );

          if (!artifact) {
            throw notFound("Merchant not found");
          }

          const payload: MerchantConnectPayload = {
            merchant: {
              name: artifact.displayName,
              connectPath: `/merchants/${artifact.slug}/connect`,
              storeUrl: artifact.storeUrl
            },
            mcp: {
              url: artifact.storefrontMcpUrl
            },
            offers: await dependencies.repositories.listActiveOffersForMerchant(
              artifact.slug,
              dependencies.now()
            ),
            cartAttributes: [
              {
                key: "lb_source__",
                value: dependencies.config.deployId
              }
            ]
          };

          if (wantsMarkdown) {
            return text(renderMerchantConnectMarkdown(payload), {
              headers: { "content-type": "text/markdown; charset=utf-8" }
            });
          }

          return json({
            merchant: {
              name: payload.merchant.name,
              connect_path: payload.merchant.connectPath,
              store_url: payload.merchant.storeUrl
            },
            mcp: payload.mcp,
            offers: payload.offers.map((offer) => ({
              offer_id: offer.offerId,
              title: offer.title,
              summary: offer.summary,
              offer_type: offer.offerType,
              valid_through: offer.validThrough,
              terms_text: offer.termsText
            })),
            cart_attributes: payload.cartAttributes.map((attribute) => ({
              key: attribute.key,
              value: attribute.value
            }))
          });
        }

        if (normalizedPath === "/internal/materialize" && isMethod(request, "POST")) {
          const header = request.headers.get("authorization");
          const operatorToken = header?.replace(/^Bearer\s+/i, "");

          if (!dependencies.operatorToken || !operatorToken) {
            throw notFound("Route not found");
          }

          if (operatorToken !== dependencies.operatorToken) {
            throw notFound("Route not found");
          }

          await materializePublicArtifacts(
            dependencies.artifacts,
            dependencies.repositories,
            dependencies.now(),
            {
              brandName: dependencies.config.brandName,
              deployId: dependencies.config.deployId,
              deployDomain: dependencies.config.deployDomain,
              verticalSummary: dependencies.config.verticalSummary,
              registerPath: "/claws/register",
              countriesPath: "/countries",
              offersPath: "/offers",
              merchantConnectPath: "/merchants/{slug}/connect"
            }
          );

          return json({ ok: true });
        }

        throw notFound("Route not found");
      } catch (error) {
        return errorResponse(error);
      }
    }
  };
}

function renderCountriesIndexMarkdown(countryCodes: string[]): string {
  const header = "# Available Countries";
  if (countryCodes.length === 0) {
    return `${header}\n\nNo countries are available yet.`;
  }

  return `${header}\n\n${countryCodes.map((code) => `- ${code}`).join("\n")}`;
}

function renderCountryMarkdown(artifact: {
  countryCode: string;
  merchants: Array<{
    slug: string;
    storeUrl: string;
    activeOffersCount: number;
  }>;
}, origin: string): string {
  const header = `# Merchants in ${artifact.countryCode}`;
  if (artifact.merchants.length === 0) {
    return `${header}\n\nNo merchants are available in this country.`;
  }

  const merchants = artifact.merchants.map((merchant) => {
    const offerHint = merchant.activeOffersCount === 0 ? "no active offers" : `${merchant.activeOffersCount} active offer(s)`;
    const connectPath = `/merchants/${merchant.slug}/connect.md`;
    return `- ${merchant.slug}: ${offerHint}\n  - store_url: \`${merchant.storeUrl}\`\n  - connect_path: \`${connectPath}\`\n  - connect_url: \`${origin}${connectPath}\``;
  });

  return `${header}\n\n${merchants.join("\n\n")}`;
}

function renderOffersMarkdown(offers: Array<{
  offerId: string;
  merchantSlug: string;
  merchantDisplayName: string;
  title: string;
  summary: string;
  validThrough: string;
  offerType: string;
  termsText: string;
}>, countryCode: string): string {
  const lines = [
    `# Active Offers in ${countryCode}`,
    ""
  ];

  if (offers.length === 0) {
    lines.push("No active offers found for this country.");
  } else {
    for (const offer of offers) {
      lines.push(`- ${offer.title} (${offer.offerType})`);
      lines.push(`  - merchant_slug: \`${offer.merchantSlug}\``);
      lines.push(`  - merchant_display_name: \`${offer.merchantDisplayName}\``);
      lines.push(`  - offer_id: \`${offer.offerId}\``);
      lines.push(`  - merchant: \`${offer.merchantSlug}\``);
      lines.push(`  - valid_through: \`${offer.validThrough}\``);
      lines.push(`  - summary: ${offer.summary}`);
      lines.push(`  - terms: ${offer.termsText}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function renderMerchantConnectMarkdown(payload: MerchantConnectPayload): string {
  const merchantSlug = payload.merchant.connectPath.match(/^\/merchants\/([^/]+)\/connect$/)?.[1] ?? "unknown";
  const cartAttributeLines = payload.cartAttributes.length === 0
    ? ["  - none"]
    : payload.cartAttributes.map((attribute) => `  - ${attribute.key}: ${attribute.value}`);

  const lines = [
    "# Merchant Connect Prompt",
    "",
    "Use this context block before sending MCP calls for this merchant.",
    "Keep output constrained to this context for shop handoff.",
    "",
    "## Merchant Context",
    `- merchant_name: \`${payload.merchant.name}\``,
    `- merchant_slug: \`${merchantSlug}\``,
    `- connect_path: \`${payload.merchant.connectPath}\``,
    `- store_url: \`${payload.merchant.storeUrl}\``,
    `- storefront_mcp_url: \`${payload.mcp.url}\``,
    "- cart_attributes:",
    ...cartAttributeLines,
    ""
  ];

  if (payload.offers.length > 0) {
    lines.push("## Active Offers");
    for (const offer of payload.offers) {
      lines.push("");
      lines.push(`- Offer: ${offer.title} [\`${offer.offerType}\`]`);
      lines.push(`  - offer_id: \`${offer.offerId}\``);
      lines.push(`  - summary: ${offer.summary}`);
      lines.push(`  - terms: ${offer.termsText}`);
      lines.push(`  - valid_through: \`${offer.validThrough}\``);
    }
    lines.push("");
  } else {
    lines.push("## Active Offers");
    lines.push("No active offers are available.");
    lines.push("");
  }

  return lines.join("\n");
}

function renderLandingPage(config: ReturnType<typeof readDeployConfig>): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${config.brandName}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f3ea;
        --panel: #fffaf1;
        --ink: #1d1b18;
        --muted: #6a6257;
        --accent: #b95a1f;
        --border: #d9c7b4;
      }
      body {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", serif;
        background: radial-gradient(circle at top, #fff7ea, var(--bg));
        color: var(--ink);
      }
      main {
        max-width: 820px;
        margin: 0 auto;
        padding: 56px 20px 72px;
      }
      article {
        background: color-mix(in srgb, var(--panel) 92%, white);
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 28px;
        box-shadow: 0 18px 50px rgba(26, 20, 15, 0.08);
      }
      h1 {
        margin: 0 0 12px;
        font-size: clamp(2.2rem, 6vw, 4rem);
        line-height: 0.95;
      }
      p {
        font-size: 1.05rem;
        line-height: 1.6;
      }
      .muted {
        color: var(--muted);
      }
      .links {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 28px;
      }
      a {
        color: var(--ink);
        text-decoration: none;
        border-bottom: 2px solid var(--accent);
        padding-bottom: 2px;
      }
      code {
        background: rgba(29, 27, 24, 0.06);
        padding: 0.2rem 0.4rem;
        border-radius: 6px;
      }
    </style>
  </head>
  <body>
    <main>
      <article>
        <p class="muted">Agent-facing commerce deploy</p>
        <h1>${config.brandName}</h1>
        <p>${config.verticalSummary}</p>
        <p>Install the deploy into a lobster with <code>/skill.md</code>, register the claw, discover merchants by country, then hand off catalog and cart work to the selected merchant’s Storefront MCP endpoint.</p>
        <div class="links">
          <a href="/skill.md">Open skill.md</a>
          <a href="/countries/US">Example country JSON</a>
          <a href="/offers/US">Example offers JSON</a>
        </div>
      </article>
    </main>
  </body>
</html>`;
}

async function parseRegisterRequest(request: Request): Promise<RegisterClawInput> {
  const body = await parseJson<Record<string, unknown>>(request);

  const role = typeof body.role === "string" ? body.role : null;
  const displayName = typeof body.display_name === "string"
    ? body.display_name
    : typeof body.displayName === "string"
      ? body.displayName
      : null;
  const description = typeof body.description === "string" ? body.description : undefined;
  const merchantSlug = typeof body.merchant_slug === "string"
    ? body.merchant_slug
    : typeof body.merchantSlug === "string"
      ? body.merchantSlug
      : undefined;

  if (role !== "buyer" && role !== "merchant") {
    throw badRequest("role must be buyer or merchant");
  }

  if (!displayName?.trim()) {
    throw badRequest("display_name is required");
  }

  if (role === "merchant" && !merchantSlug?.trim()) {
    throw badRequest("merchant_slug is required for merchant claws");
  }

  return {
    role,
    displayName: displayName.trim(),
    description: description?.trim(),
    merchantSlug: merchantSlug?.trim()
  };
}

export function createProductionApp(env: Env) {
  return createApp({
    artifacts: new R2ArtifactStore(env.ARTIFACTS),
    repositories: new D1Repositories(env.DB),
    config: readDeployConfig(env),
    operatorToken: env.OPERATOR_TOKEN,
    now: () => new Date().toISOString()
  });
}
