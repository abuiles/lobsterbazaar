import {
  ensureCountryArtifact,
  ensureMerchantArtifact,
  ensureOffersArtifact,
  ensureSkillArtifact,
  materializePublicArtifacts,
  materializeSkillArtifact
} from "./artifacts";
import { readDeployConfig, type Env } from "./config";
import type { FeaturedMerchantSummary, MerchantConnectPayload, RegisterClawInput } from "./domain";
import { badRequest, notFound } from "./errors";
import { errorResponse, html, isMethod, json, parseJson, text } from "./http";
import { prepareRequestMetric, recordRequestMetric } from "./metrics";
import { deriveStorefrontMcpUrl, normalizeCountryCode } from "./merchant";
import { R2ArtifactStore } from "./r2";
import { D1Repositories } from "./d1";
import type { ArtifactStore, Repositories } from "./storage";

interface AppDependencies {
  artifacts: ArtifactStore;
  repositories: Repositories;
  config: ReturnType<typeof readDeployConfig>;
  metrics?: AnalyticsEngineDataset;
  staticAssets?: Fetcher;
  operatorToken?: string;
  now: () => string;
}

function requireOperatorAccess(request: Request, operatorToken?: string): void {
  const header = request.headers.get("authorization");
  const providedToken = header?.replace(/^Bearer\s+/i, "");

  if (!operatorToken || !providedToken || providedToken !== operatorToken) {
    throw notFound("Route not found");
  }
}

export function createApp(dependencies: AppDependencies) {
  return {
    fetch: async (request: Request): Promise<Response> => {
      const startedAt = Date.now();
      let response: Response | null = null;
      let handledError: unknown;
      let requestMetric: Awaited<ReturnType<typeof prepareRequestMetric>> = null;
      let requestNormalizedPath = "/";

      try {
        const url = new URL(request.url);
        const pathname = url.pathname.replace(/\/+$/, "") || "/";
        const wantsMarkdown = pathname.endsWith(".md");
        const normalizedPath = wantsMarkdown ? pathname.slice(0, -3) : pathname;
        requestNormalizedPath = normalizedPath;
        requestMetric = await prepareRequestMetric(request, normalizedPath);

        if (pathname.startsWith("/assets/") && dependencies.staticAssets) {
          return dependencies.staticAssets.fetch(request);
        }

        if (normalizedPath === "/" && isMethod(request, "GET")) {
          const featuredMerchants = await dependencies.repositories.listFeaturedMerchants(dependencies.now());
          response = html(renderLandingPage(dependencies.config, url.origin, featuredMerchants));
        } else if (normalizedPath === "/skill" && isMethod(request, "GET")) {
          const skill = await ensureSkillArtifact(dependencies.artifacts, {
            brandName: dependencies.config.brandName,
            deployId: dependencies.config.deployId,
            deployDomain: dependencies.config.deployDomain,
            verticalSummary: dependencies.config.verticalSummary,
            skillBuyingTargets: dependencies.config.skillBuyingTargets,
            registerPath: "/claws/register",
            countriesPath: "/countries",
            offersPath: "/offers",
            merchantConnectPath: "/merchants/{slug}/connect"
          });

          response = text(skill, { headers: { "content-type": "text/markdown; charset=utf-8" } });
        } else if (normalizedPath === "/claws/register" && isMethod(request, "POST")) {
          const payload = await parseRegisterRequest(request);
          const result = await dependencies.repositories.createClaw(payload, dependencies.config.deployId);

          response = json(
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
        } else if (normalizedPath === "/countries" && isMethod(request, "GET")) {
          const countryCodes = await dependencies.repositories.listCountryCodes();
          response = wantsMarkdown
            ? text(
              renderCountriesIndexMarkdown(countryCodes),
              { headers: { "content-type": "text/markdown; charset=utf-8" } }
            )
            : json({
              generated_at: dependencies.now(),
              countries: countryCodes
            });
        } else {
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

            response = wantsMarkdown
              ? text(renderCountryMarkdown(artifact, url.origin), {
                headers: { "content-type": "text/markdown; charset=utf-8" }
              })
              : json({
                country_code: artifact.countryCode,
                generated_at: artifact.generatedAt,
                merchants: artifact.merchants.map((merchant) => ({
                  slug: merchant.slug,
                  display_name: merchant.displayName,
                  store_url: merchant.storeUrl,
                  summary: merchant.summary,
                  description: merchant.description,
                  active_offers_count: merchant.activeOffersCount
                }))
              });
          } else {
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

              response = wantsMarkdown
                ? text(renderOffersMarkdown(artifact.offers, countryCode), {
                  headers: { "content-type": "text/markdown; charset=utf-8" }
                })
                : json({
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
            } else {
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
                    slug: artifact.slug,
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

                response = wantsMarkdown
                  ? text(renderMerchantConnectMarkdown(payload), {
                    headers: { "content-type": "text/markdown; charset=utf-8" }
                  })
                  : json({
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
              } else if (normalizedPath === "/internal/materialize" && isMethod(request, "POST")) {
                requireOperatorAccess(request, dependencies.operatorToken);

                const target = parseMaterializeTarget(url.searchParams.get("target"));
                const sinceRaw = url.searchParams.get("since");
                const since = parseSince(sinceRaw);
                const templateInput = {
                  brandName: dependencies.config.brandName,
                  deployId: dependencies.config.deployId,
                  deployDomain: dependencies.config.deployDomain,
                  verticalSummary: dependencies.config.verticalSummary,
                  skillBuyingTargets: dependencies.config.skillBuyingTargets,
                  registerPath: "/claws/register",
                  countriesPath: "/countries",
                  offersPath: "/offers",
                  merchantConnectPath: "/merchants/{slug}/connect"
                };

                if (target === "skill") {
                  await materializeSkillArtifact(dependencies.artifacts, templateInput);
                } else {
                  await materializePublicArtifacts(
                    dependencies.artifacts,
                    dependencies.repositories,
                    dependencies.now(),
                    templateInput,
                    { since }
                  );
                }

                response = json({ ok: true });
              } else if (normalizedPath === "/internal/metrics/materialize" && isMethod(request, "POST")) {
                requireOperatorAccess(request, dependencies.operatorToken);
                response = json({ ok: true });
              } else {
                throw notFound("Route not found");
              }
            }
          }
        }
      } catch (error) {
        handledError = error;
        response = errorResponse(error);
      }

      await recordRequestMetricSafely(dependencies, {
        requestNormalizedPath,
        requestMetric,
        response,
        durationMs: Date.now() - startedAt,
        handledError
      });

      return response;
    }
  };
}

async function recordRequestMetricSafely(
  dependencies: Pick<AppDependencies, "metrics" | "config" | "repositories" | "now">,
  input: {
    requestNormalizedPath: string;
    requestMetric: Awaited<ReturnType<typeof prepareRequestMetric>>;
    response: Response;
    durationMs: number;
    handledError: unknown;
  }
): Promise<void> {
  try {
    const snapshot =
      (input.requestNormalizedPath === "/internal/materialize"
        || input.requestNormalizedPath === "/internal/metrics/materialize")
      && input.response.ok
        ? await dependencies.repositories.getMetricsSnapshot(dependencies.now())
        : undefined;

    recordRequestMetric({
      dataset: dependencies.metrics,
      config: dependencies.config,
      metric: input.requestMetric,
      response: input.response,
      durationMs: input.durationMs,
      error: input.handledError,
      snapshot
    });
  } catch (error) {
    console.warn("Failed to record analytics metric", error);
  }
}

function renderCountriesIndexMarkdown(countryCodes: string[]): string {
  const header = "# Available Countries";
  if (countryCodes.length === 0) {
    return `${header}\n\nNo countries are available yet.`;
  }

  return `${header}\n\n${countryCodes.map((code) => `- ${code}`).join("\n")}`;
}

function parseSince(since: string | null): string | undefined {
  if (!since) {
    return undefined;
  }

  const parsed = new Date(since);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest("`since` must be an ISO timestamp");
  }

  return parsed.toISOString();
}

function parseMaterializeTarget(target: string | null): "all" | "skill" {
  if (!target) {
    return "all";
  }

  if (target === "skill") {
    return target;
  }

  throw badRequest("`target` must be `skill` when provided");
}

function renderCountryMarkdown(artifact: {
  countryCode: string;
  merchants: Array<{
    slug: string;
    storeUrl: string;
    summary: string;
    description: string;
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
    const descriptionLine = merchant.description ? `\n  - description: ${merchant.description}` : "";
    const summaryLine = merchant.summary ? `\n  - summary: ${merchant.summary}` : "";
    return `- ${merchant.slug}: ${offerHint}${descriptionLine}${summaryLine}\n  - store_url: \`${merchant.storeUrl}\`\n  - connect_path: \`${connectPath}\`\n  - connect_url: \`${origin}${connectPath}\``;
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
    `- merchant_slug: \`${payload.merchant.slug}\``,
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

function renderDirectoryCards(config: ReturnType<typeof readDeployConfig>): string {
  const directoryVerticals = [...config.directoryVerticals].sort((left, right) => {
    if (left.deployId === config.deployId) {
      return -1;
    }
    if (right.deployId === config.deployId) {
      return 1;
    }
    return left.brandName.localeCompare(right.brandName);
  });

  if (directoryVerticals.length === 0) {
    return `<p class="directory-empty muted">No categories are published yet.</p>`;
  }

  return directoryVerticals.map((vertical) => {
    const isCurrent = vertical.deployId === config.deployId;
    const badge = isCurrent ? "current" : "open";
    const subtitle = vertical.directorySubtitle || (vertical.verticalName ? `${vertical.verticalName} category` : "Live category");
    const emoji = vertical.emoji || "🦞";
    return `
      <a class="directory-card${isCurrent ? " is-active" : ""}" href="${vertical.url}">
        <span class="directory-emoji">${emoji}</span>
        <span class="directory-meta">
          <strong>${vertical.brandName}</strong>
          <span>${subtitle}</span>
        </span>
        <span class="directory-domain">${vertical.domain}</span>
        <span class="directory-badge">${badge}</span>
      </a>
    `;
  }).join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function getStoreDomain(storeUrl: string): string {
  try {
    return new URL(storeUrl).host;
  } catch {
    return storeUrl.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "");
  }
}

function renderFeaturedMerchantCards(featuredMerchants: FeaturedMerchantSummary[]): string {
  return featuredMerchants.map((merchant) => {
    const description = merchant.description.trim();
    const summary = merchant.summary.trim();
    const domain = getStoreDomain(merchant.storeUrl);
    const offerHint = merchant.activeOffersCount > 0
      ? `${merchant.activeOffersCount} active offer${merchant.activeOffersCount === 1 ? "" : "s"}`
      : "";
    const summaryMarkup = summary ? `<span class="featured-summary">${escapeHtml(summary)}</span>` : "";
    const descriptionMarkup = description ? `<span class="featured-description">${escapeHtml(description)}</span>` : "";
    const offerMarkup = offerHint ? `<span class="featured-offers">${escapeHtml(offerHint)}</span>` : "";

    return `
      <a class="featured-card" href="${escapeHtml(merchant.storeUrl)}">
        <span class="featured-header">
          <strong>${escapeHtml(merchant.displayName)}</strong>
          <span class="featured-domain">${escapeHtml(domain)}</span>
        </span>
        ${summaryMarkup}
        ${descriptionMarkup}
        ${offerMarkup}
      </a>
    `;
  }).join("");
}

function renderLandingPage(
  config: ReturnType<typeof readDeployConfig>,
  origin: string,
  featuredMerchants: FeaturedMerchantSummary[]
): string {
  const skillUrl = `${origin.replace(/\/$/, "")}/skill.md`;
  const installInstruction = `Read ${skillUrl} and follow the instructions to browse the directory and connect to the right merchant MCP.`;
  const contactEmail = "hello@lobsterstores.com";
  const directoryCards = renderDirectoryCards(config);
  const featuredCards = renderFeaturedMerchantCards(featuredMerchants);
  const featuredTab = featuredMerchants.length > 0
    ? '<button class="surface-tab" type="button" role="tab" aria-selected="false" data-surface-tab="featured">featured merchants</button>'
    : "";
  const featuredPanel = featuredMerchants.length > 0
    ? `
          <section class="surface-panel" data-surface-panel="featured" role="tabpanel" hidden>
            <div class="directory-intro">
              <p class="prompt-title">Featured Merchants</p>
              <p class="muted">A few shops worth opening first.</p>
            </div>
            <div class="featured-grid">
              ${featuredCards}
            </div>
          </section>
        `
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${config.brandName}</title>
    <style>
      :root {
        color-scheme: dark light;
        --bg: #232323;
        --panel: #2c2c2f;
        --prompt: #1a1a1d;
        --ink: #f1efe8;
        --muted: #a39d94;
        --accent: #12decf;
        --accent-soft: #ff4a4a;
        --border: rgba(255, 255, 255, 0.12);
        --shadow: 0 28px 60px rgba(0, 0, 0, 0.24);
      }
      @media (prefers-color-scheme: light) {
        :root {
          --bg: #f3efe6;
          --panel: #faf7f0;
          --prompt: #ece7de;
          --ink: #1a1714;
          --muted: #6f675c;
          --accent: #0ea99c;
          --accent-soft: #c43838;
          --border: rgba(26, 23, 20, 0.12);
          --shadow: 0 20px 48px rgba(71, 54, 31, 0.12);
        }
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        font-family: "SFMono-Regular", "Menlo", "Monaco", "Consolas", monospace;
        background: var(--bg);
        color: var(--ink);
      }
      :root[data-theme="light"] {
        color-scheme: light;
        --bg: #f3efe6;
        --panel: #faf7f0;
        --prompt: #ece7de;
        --ink: #1a1714;
        --muted: #6f675c;
        --accent: #0ea99c;
        --accent-soft: #c43838;
        --border: rgba(26, 23, 20, 0.12);
        --shadow: 0 20px 48px rgba(71, 54, 31, 0.12);
      }
      :root[data-theme="dark"] {
        color-scheme: dark;
      }
      main {
        width: min(980px, calc(100% - 32px));
        margin: 0 auto;
        padding: 26px 0 40px;
      }
      article {
        position: relative;
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 22px;
        padding: 28px;
        padding-top: 56px;
        box-shadow: var(--shadow);
        display: grid;
        gap: 24px;
      }
      @media (min-width: 860px) {
        article {
          grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
          align-items: start;
        }
      }
      .copy {
        min-width: 0;
        display: grid;
        gap: 18px;
      }
      .topline {
        position: absolute;
        top: 18px;
        right: 18px;
        z-index: 1;
      }
      .mascot-panel {
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 14px;
        background: rgba(255,255,255,0.02);
      }
      .mascot-frame {
        aspect-ratio: 4 / 5;
        border-radius: 14px;
        overflow: hidden;
        background: #181818;
      }
      .mascot-frame img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .kicker {
        color: var(--muted);
        font-size: 0.9rem;
      }
      .theme-toggle {
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.04);
        color: var(--muted);
        border-radius: 999px;
        padding: 6px 10px;
        font: inherit;
        cursor: pointer;
        font-size: 0.9rem;
        letter-spacing: 0.01em;
      }
      .theme-toggle:hover {
        color: var(--ink);
        border-color: color-mix(in srgb, var(--border) 55%, var(--ink));
      }
      h1 {
        margin: 0;
        font-size: clamp(2rem, 6vw, 3.4rem);
        line-height: 1.06;
        letter-spacing: -0.03em;
      }
      .install-copy {
        color: var(--muted);
        font-size: 1.02rem;
      }
      p {
        font-size: 1rem;
        line-height: 1.65;
      }
      .muted {
        color: var(--muted);
      }
      .prompt-title {
        color: var(--muted);
        font-size: 0.92rem;
        margin: 0;
      }
      .surface-switcher {
        display: inline-flex;
        gap: 8px;
        padding: 6px;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.03);
      }
      .surface-tab {
        border: 0;
        background: transparent;
        color: var(--muted);
        border-radius: 999px;
        padding: 8px 14px;
        font: inherit;
        cursor: pointer;
        text-transform: lowercase;
      }
      .surface-tab.is-active {
        background: var(--prompt);
        color: var(--ink);
        box-shadow: inset 0 0 0 1px var(--border);
      }
      .surface-panel {
        display: grid;
        gap: 14px;
      }
      .surface-panel[hidden] {
        display: none;
      }
      .prompt {
        background: var(--prompt);
        border-radius: 12px;
        padding: 18px 22px;
      }
      .prompt-bar {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 10px;
      }
      .copy-button {
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.04);
        color: var(--muted);
        border-radius: 999px;
        padding: 6px 10px;
        font: inherit;
        cursor: pointer;
        font-size: 0.86rem;
      }
      .copy-button:hover {
        color: var(--ink);
      }
      .prompt pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: clamp(1rem, 2vw, 1.18rem);
        line-height: 1.65;
        color: var(--accent);
      }
      .steps {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 8px;
      }
      .steps li {
        display: flex;
        gap: 10px;
        align-items: baseline;
        color: var(--muted);
        font-size: clamp(1rem, 2vw, 1.12rem);
      }
      .steps strong {
        color: var(--accent-soft);
        min-width: 1.4em;
      }
      .caption {
        max-width: 54ch;
      }
      .directory-intro {
        display: grid;
        gap: 6px;
      }
      .directory-grid {
        display: grid;
        gap: 12px;
      }
      .featured-grid {
        display: grid;
        gap: 12px;
      }
      .featured-card {
        display: grid;
        gap: 6px;
        padding: 14px 16px;
        border: 1px solid var(--border);
        border-radius: 16px;
        text-decoration: none;
        color: inherit;
        background: rgba(255, 255, 255, 0.02);
      }
      .featured-card:hover {
        border-color: color-mix(in srgb, var(--ink) 20%, var(--border));
      }
      .featured-header {
        display: grid;
        gap: 2px;
      }
      .featured-header strong {
        font-size: 1rem;
      }
      .featured-domain,
      .featured-summary,
      .featured-description,
      .featured-offers {
        color: var(--muted);
        font-size: 0.94rem;
      }
      .featured-description {
        line-height: 1.5;
      }
      .featured-offers {
        color: var(--accent);
      }
      .directory-card {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 12px 14px;
        align-items: center;
        padding: 14px 16px;
        border: 1px solid var(--border);
        border-radius: 16px;
        text-decoration: none;
        color: inherit;
        background: rgba(255, 255, 255, 0.02);
      }
      .directory-card.is-active {
        border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
        background: color-mix(in srgb, var(--prompt) 88%, transparent);
      }
      .directory-card:hover {
        border-color: color-mix(in srgb, var(--ink) 20%, var(--border));
      }
      .directory-emoji {
        font-size: 1.25rem;
      }
      .directory-meta {
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      .directory-meta strong {
        font-size: 1rem;
      }
      .directory-meta span,
      .directory-domain {
        color: var(--muted);
        font-size: 0.94rem;
      }
      .directory-domain {
        grid-column: 2;
      }
      .directory-badge {
        justify-self: start;
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 3px 8px;
        font-size: 0.8rem;
        color: var(--muted);
      }
      .directory-empty {
        margin: 0;
      }
      .contact-grid {
        margin-top: 18px;
        display: grid;
        gap: 18px;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      }
      .contact-card {
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 22px 28px;
        background: var(--panel);
        box-shadow: var(--shadow);
      }
      .contact-card h2 {
        margin: 0 0 6px;
        font-size: 1.1rem;
      }
      .contact-card p {
        margin: 0 0 14px;
      }
      .contact-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 10px;
      }
      .contact-list a {
        color: var(--ink);
        text-decoration: none;
        border-bottom: 1px solid transparent;
      }
      .contact-list a:hover {
        border-bottom-color: var(--accent);
      }
      @media (max-width: 640px) {
        .topline {
          top: 14px;
          right: 14px;
        }
        article {
          padding-top: 62px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <article>
        <div class="copy">
          <div class="topline">
            <button class="theme-toggle" type="button" data-theme-toggle>toggle theme</button>
          </div>
          <h1>${config.brandName}</h1>
          <p class="caption muted">${config.verticalSummary}</p>
          <p class="install-copy">Send your agent to ${config.brandName} ${config.emoji}</p>
<p>Built for OpenClaw, but it works with Codex, Cursor, Claude Code, or any agent that can read a URL and follow instructions.</p>
          <div class="surface-switcher" role="tablist" aria-label="Deploy surfaces">
            <button class="surface-tab is-active" type="button" role="tab" aria-selected="true" data-surface-tab="install">install skill</button>
            ${featuredTab}
            <button class="surface-tab" type="button" role="tab" aria-selected="false" data-surface-tab="directory">directory</button>
          </div>
          <section class="surface-panel is-active" data-surface-panel="install" role="tabpanel">
            <p class="prompt-title">Skill install instruction</p>
            <div class="prompt">
              <div class="prompt-bar">
                <button class="copy-button" type="button" data-copy-install>copy</button>
              </div>
              <pre data-install-instruction>${installInstruction}</pre>
            </div>
            <ol class="steps">
              <li><strong>1.</strong><span>Send this to your agent</span></li>
              <li><strong>2.</strong><span>Let the agent read the skill and pick a merchant</span></li>
              <li><strong>3.</strong><span>Then the agent can start shopping through the right merchant MCP</span></li>
            </ol>
          </section>
          ${featuredPanel}
          <section class="surface-panel" data-surface-panel="directory" role="tabpanel" hidden>
            <div class="directory-intro">
              <p class="prompt-title">All Lobster Categories</p>
              <p class="muted">Browse every lobster category and find the right shop faster.</p>
            </div>
            <div class="directory-grid">
              ${directoryCards}
            </div>
          </section>
        </div>
        <aside class="mascot-panel">
          <div class="mascot-frame">
            <img src="${config.mascotUrl}" alt="${config.brandName} mascot">
          </div>
        </aside>
      </article>
      <div class="contact-grid">
        <section class="contact-card">
          <h2>contact</h2>
          <p class="muted">get in touch</p>
          <ul class="contact-list">
            <li><a href="mailto:${contactEmail}">${contactEmail}</a></li>
            <li>request a walkthrough / waitlist / demo</li>
            <li><a href="https://github.com/abuiles/lobsterbazaar">source code on GitHub</a></li>
            <li>made for claws, shoppers, and merchants</li>
            <li>host-agnostic install surface: <code>skill.md</code></li>
            <li>built by <a href="https://x.com/abuiles">@abuiles</a></li>
            <li>powered by <a href="https://lobsterbazaar.com/">lobsterbazaar.com</a></li>
          </ul>
        </section>
        <section class="contact-card">
          <h2>for merchants</h2>
          <p class="muted">verify your shop or create an agent-buyer offer</p>
          <ul class="contact-list">
            <li>You can be listed here without installing anything in your store.</li>
            <li>Want to verify your account on ${config.brandName}? Email <a href="mailto:${contactEmail}">${contactEmail}</a>.</li>
            <li>Want to offer a discount for agent buyers? Reach out at <a href="mailto:${contactEmail}">${contactEmail}</a>.</li>
            <li>We can help you claim your merchant profile and set up a claw to interact with customers.</li>
          </ul>
        </section>
      </div>
      <script>
        (() => {
          const root = document.documentElement;
          const button = document.querySelector("[data-theme-toggle]");
          const copyButton = document.querySelector("[data-copy-install]");
          const instruction = document.querySelector("[data-install-instruction]");
          const surfaceTabs = Array.from(document.querySelectorAll("[data-surface-tab]"));
          const surfacePanels = Array.from(document.querySelectorAll("[data-surface-panel]"));
          const storageKey = "lobsterbazaar-theme";
          const savedTheme = localStorage.getItem(storageKey);
          if (savedTheme === "light" || savedTheme === "dark") {
            root.dataset.theme = savedTheme;
          }
          const setSurface = (nextSurface) => {
            surfaceTabs.forEach((tab) => {
              const isActive = tab.dataset.surfaceTab === nextSurface;
              tab.classList.toggle("is-active", isActive);
              tab.setAttribute("aria-selected", isActive ? "true" : "false");
            });
            surfacePanels.forEach((panel) => {
              const isActive = panel.dataset.surfacePanel === nextSurface;
              panel.classList.toggle("is-active", isActive);
              panel.hidden = !isActive;
            });
          };
          surfaceTabs.forEach((tab) => {
            tab.addEventListener("click", () => {
              if (tab.dataset.surfaceTab) {
                setSurface(tab.dataset.surfaceTab);
              }
            });
          });
          setSurface("install");
          if (button) {
            button.addEventListener("click", () => {
              const nextTheme = root.dataset.theme === "light" ? "dark" : "light";
              root.dataset.theme = nextTheme;
              localStorage.setItem(storageKey, nextTheme);
            });
          }
          if (copyButton && instruction) {
            copyButton.addEventListener("click", async () => {
              const original = copyButton.textContent || "copy";
              try {
                await navigator.clipboard.writeText(instruction.textContent || "");
                copyButton.textContent = "copied";
              } catch {
                copyButton.textContent = "copy failed";
              }
              setTimeout(() => {
                copyButton.textContent = original;
              }, 1200);
            });
          }
        })();
      </script>
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
    metrics: env.METRICS,
    staticAssets: env.ASSETS,
    operatorToken: env.OPERATOR_TOKEN,
    now: () => new Date().toISOString()
  });
}
