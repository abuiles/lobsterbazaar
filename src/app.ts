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
  staticAssets?: Fetcher;
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

        if (pathname.startsWith("/assets/") && dependencies.staticAssets) {
          return dependencies.staticAssets.fetch(request);
        }

        if (normalizedPath === "/" && isMethod(request, "GET")) {
          return html(renderLandingPage(dependencies.config, url.origin));
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
              summary: merchant.summary,
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
    summary: string;
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
    const summaryLine = merchant.summary ? `\n  - summary: ${merchant.summary}` : "";
    return `- ${merchant.slug}: ${offerHint}${summaryLine}\n  - store_url: \`${merchant.storeUrl}\`\n  - connect_path: \`${connectPath}\`\n  - connect_url: \`${origin}${connectPath}\``;
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

function renderLandingPage(config: ReturnType<typeof readDeployConfig>, origin: string): string {
  const baseUrl = origin.replace(/\/$/, "");
  const skillUrl = `${baseUrl}/skill.md`;
  const registerUrl = `${baseUrl}/claws/register`;
  const countriesUrl = `${baseUrl}/countries.md`;
  const countryExampleUrl = `${baseUrl}/countries/CO.md`;
  const offersExampleUrl = `${baseUrl}/offers/CO.md`;
  const connectExampleUrl = `${baseUrl}/merchants/devocion/connect.md`;
  const agentPrompt = `Read ${skillUrl} and install ${config.brandName}. Register yourself, save the API key locally, check ${countriesUrl} to match the owner's country, then use /merchants/{slug}/connect.md before calling any Shopify Storefront MCP endpoint.`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${config.brandName}</title>
    <style>
      :root {
        color-scheme: dark light;
        --bg: #121212;
        --bg-elevated: #1b1b1d;
        --panel: rgba(30, 30, 33, 0.92);
        --panel-strong: #0f1012;
        --ink: #f0ece3;
        --muted: #b2ada2;
        --accent: #9ab8e2;
        --accent-2: #4ed4c8;
        --border: rgba(255, 247, 232, 0.12);
        --border-strong: rgba(154, 184, 226, 0.34);
        --shadow: 0 28px 90px rgba(0, 0, 0, 0.4);
        --button-text: #111214;
        --noise: radial-gradient(circle at top, rgba(154, 184, 226, 0.14), transparent 30%), linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0));
      }
      @media (prefers-color-scheme: light) {
        :root {
          --bg: #f4efe6;
          --bg-elevated: #fbf7f0;
          --panel: rgba(255, 252, 246, 0.92);
          --panel-strong: #f5eee4;
          --ink: #171513;
          --muted: #6e665c;
          --accent: #6b8fbe;
          --accent-2: #0f9f95;
          --border: rgba(27, 24, 20, 0.12);
          --border-strong: rgba(107, 143, 190, 0.4);
          --shadow: 0 24px 80px rgba(54, 41, 20, 0.12);
          --button-text: #ffffff;
          --noise: radial-gradient(circle at top, rgba(107, 143, 190, 0.14), transparent 32%), linear-gradient(180deg, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0));
        }
      }
      :root[data-theme="light"] {
        color-scheme: light;
        --bg: #f4efe6;
        --bg-elevated: #fbf7f0;
        --panel: rgba(255, 252, 246, 0.92);
        --panel-strong: #f5eee4;
        --ink: #171513;
        --muted: #6e665c;
        --accent: #6b8fbe;
        --accent-2: #0f9f95;
        --border: rgba(27, 24, 20, 0.12);
        --border-strong: rgba(107, 143, 190, 0.4);
        --shadow: 0 24px 80px rgba(54, 41, 20, 0.12);
        --button-text: #ffffff;
        --noise: radial-gradient(circle at top, rgba(107, 143, 190, 0.14), transparent 32%), linear-gradient(180deg, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0));
      }
      :root[data-theme="dark"] {
        color-scheme: dark;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "IBM Plex Mono", "SFMono-Regular", "Consolas", monospace;
        background:
          radial-gradient(circle at top, rgba(78, 212, 200, 0.08), transparent 25%),
          radial-gradient(circle at 80% 0%, rgba(154, 184, 226, 0.18), transparent 30%),
          var(--bg);
        color: var(--ink);
        transition: background 180ms ease, color 180ms ease;
      }
      main {
        max-width: 1120px;
        margin: 0 auto;
        padding: 34px 20px 64px;
      }
      .shell {
        border: 1px solid var(--border);
        border-radius: 24px;
        padding: 18px;
        background: var(--noise), var(--bg-elevated);
        box-shadow: var(--shadow);
      }
      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 18px;
        padding: 0 4px;
      }
      .brand {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        font-size: 0.92rem;
        color: var(--muted);
        text-transform: lowercase;
      }
      .brand strong {
        color: var(--ink);
        font-size: 1rem;
      }
      .theme-toggle {
        border: 1px solid var(--border);
        background: transparent;
        color: var(--ink);
        border-radius: 999px;
        padding: 9px 12px;
        font: inherit;
        cursor: pointer;
      }
      .grid {
        display: grid;
        gap: 18px;
      }
      .hero,
      .lower-grid > section,
      .mascot-panel {
        border: 1px solid var(--border);
        background: var(--panel);
        border-radius: 18px;
      }
      .hero {
        padding: 18px;
        display: grid;
        gap: 18px;
      }
      @media (min-width: 860px) {
        .grid {
          grid-template-columns: minmax(0, 1.2fr) minmax(300px, 0.8fr);
          align-items: start;
        }
      }
      .eyebrow {
        color: var(--muted);
        font-size: 0.88rem;
        margin: 0;
      }
      h1,
      h2,
      h3,
      p,
      pre,
      ol {
        margin: 0;
      }
      h1 {
        font-size: clamp(2.3rem, 8vw, 4.9rem);
        line-height: 0.95;
        letter-spacing: -0.05em;
        max-width: 11ch;
      }
      .hero-copy {
        display: grid;
        gap: 14px;
      }
      .hero-copy p {
        max-width: 58ch;
        color: var(--muted);
      }
      .prompt-card {
        border: 1px solid var(--border-strong);
        background: var(--panel-strong);
        border-radius: 16px;
        padding: 14px;
        overflow: hidden;
      }
      .prompt-label {
        color: var(--muted);
        font-size: 0.84rem;
        margin-bottom: 10px;
      }
      .prompt-card pre {
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--accent-2);
        font-size: 1rem;
        line-height: 1.55;
      }
      .actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 11px 14px;
        border: 1px solid var(--border-strong);
        border-radius: 12px;
        color: var(--ink);
        text-decoration: none;
        font-size: 0.95rem;
      }
      .button.primary {
        background: var(--accent);
        color: var(--button-text);
      }
      .muted {
        color: var(--muted);
      }
      a {
        color: var(--ink);
      }
      .lower-grid {
        display: grid;
        gap: 18px;
      }
      @media (min-width: 860px) {
        .lower-grid {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        }
      }
      .lower-grid > section,
      .mascot-panel {
        padding: 18px;
      }
      .steps {
        list-style: none;
        display: grid;
        gap: 14px;
        padding: 0;
      }
      .steps li {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 12px;
        align-items: start;
      }
      .step-number {
        min-width: 2rem;
        height: 2rem;
        border-radius: 10px;
        border: 1px solid var(--border-strong);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--accent);
        font-weight: 700;
      }
      .step-copy {
        display: grid;
        gap: 6px;
      }
      .step-copy strong,
      h2,
      h3 {
        color: var(--ink);
      }
      .step-copy p,
      .detail-list li,
      .terminal p {
        color: var(--muted);
      }
      .detail-list {
        list-style: "> ";
        margin: 14px 0 0;
        padding-left: 18px;
        display: grid;
        gap: 10px;
      }
      .mascot-panel {
        display: grid;
        gap: 16px;
        align-content: start;
      }
      .mascot-frame {
        aspect-ratio: 4 / 5;
        border-radius: 14px;
        overflow: hidden;
        background: var(--panel-strong);
        border: 1px solid var(--border);
      }
      .mascot-frame img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .terminal {
        border: 1px solid var(--border);
        background: var(--panel-strong);
        border-radius: 14px;
        padding: 14px;
        display: grid;
        gap: 8px;
      }
      .terminal code,
      .inline-code {
        background: rgba(255, 255, 255, 0.06);
        padding: 0.2rem 0.35rem;
        border-radius: 6px;
        font-size: 0.95em;
      }
      .resource-list {
        display: grid;
        gap: 10px;
      }
      .resource-list a {
        text-decoration: none;
      }
      .resource-item {
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 12px 13px;
        background: rgba(255, 255, 255, 0.02);
      }
      .resource-item strong {
        display: block;
        margin-bottom: 4px;
      }
      .resource-item span {
        color: var(--muted);
        display: block;
        word-break: break-word;
      }
      @media (max-width: 759px) {
        main {
          padding: 20px 12px 42px;
        }
        .shell,
        .hero,
        .lower-grid > section,
        .mascot-panel {
          padding-left: 14px;
          padding-right: 14px;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        * {
          scroll-behavior: auto;
          transition: none !important;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="shell">
        <header class="topbar">
          <div class="brand">
            <span>[ deploy ]</span>
            <strong>${config.brandName}</strong>
          </div>
          <button class="theme-toggle" type="button" data-theme-toggle>toggle theme</button>
        </header>

        <div class="grid">
          <section class="hero">
            <div class="hero-copy">
              <p class="eyebrow">Send your AI agent to ${config.brandName}</p>
              <h1>give your lobster one clear install target.</h1>
              <p>${config.verticalSummary}</p>
              <p>Use the prompt below to install the deploy into a lobster, then let the lobster register itself, discover merchants, and route shopping through merchant Shopify Storefront MCP endpoints.</p>
            </div>

            <div class="prompt-card">
              <p class="prompt-label">Prompt to send to your AI agent</p>
              <pre>${agentPrompt}</pre>
            </div>

            <div class="actions">
              <a class="button primary" href="/skill.md">open skill.md</a>
              <a class="button" href="${countriesUrl}">see supported countries</a>
            </div>
          </section>

          <aside class="mascot-panel">
            <div class="mascot-frame">
              <img src="${config.mascotUrl}" alt="${config.brandName} mascot">
            </div>
            <div class="terminal">
              <p><strong>operator note</strong></p>
              <p>Keep the deploy instructions short and literal. The lobster should read the skill, register once, save its key, then move to country and merchant selection.</p>
            </div>
          </aside>
        </div>

        <div class="lower-grid">
          <section>
            <h2>Setup flow</h2>
            <ol class="steps">
              <li>
                <span class="step-number">1</span>
                <div class="step-copy">
                  <strong>Send the install prompt to your lobster</strong>
                  <p>Start with <span class="inline-code">${skillUrl}</span>. The skill is the canonical contract for registration, discovery, and Shopify MCP routing.</p>
                </div>
              </li>
              <li>
                <span class="step-number">2</span>
                <div class="step-copy">
                  <strong>Let it register and save its one-time key</strong>
                  <p>The lobster should call <span class="inline-code">${registerUrl}</span>, keep the returned credentials locally, and avoid asking for them again.</p>
                </div>
              </li>
              <li>
                <span class="step-number">3</span>
                <div class="step-copy">
                  <strong>Match the owner's country before shopping</strong>
                  <p>Have the lobster read <span class="inline-code">${countriesUrl}</span>, then fetch a country page and any active offers before choosing a merchant.</p>
                </div>
              </li>
              <li>
                <span class="step-number">4</span>
                <div class="step-copy">
                  <strong>Resolve the merchant before opening Shopify MCP</strong>
                  <p>The lobster must call a merchant connect page first, then use the returned Storefront MCP endpoint for live catalog, cart, and checkout work.</p>
                </div>
              </li>
            </ol>
          </section>

          <section>
            <h2>Quick references</h2>
            <div class="resource-list">
              <a class="resource-item" href="${skillUrl}">
                <strong>Install contract</strong>
                <span>${skillUrl}</span>
              </a>
              <a class="resource-item" href="${countryExampleUrl}">
                <strong>Country shortlist example</strong>
                <span>${countryExampleUrl}</span>
              </a>
              <a class="resource-item" href="${offersExampleUrl}">
                <strong>Offer feed example</strong>
                <span>${offersExampleUrl}</span>
              </a>
              <a class="resource-item" href="${connectExampleUrl}">
                <strong>Merchant connect example</strong>
                <span>${connectExampleUrl}</span>
              </a>
            </div>

            <ul class="detail-list">
              <li>Discovery happens here. Product truth and cart truth stay with the merchant Shopify Storefront MCP.</li>
              <li>The lobster should attach <span class="inline-code">lb_source__ = ${config.deployId}</span> when updating carts.</li>
              <li>The owner finishes payment in Shopify checkout. The lobster stops at checkout handoff.</li>
            </ul>
          </section>
        </div>
      </div>
      <script>
        (() => {
          const root = document.documentElement;
          const button = document.querySelector("[data-theme-toggle]");
          const storageKey = "lobsterbazaar-theme";
          const savedTheme = localStorage.getItem(storageKey);
          if (savedTheme === "light" || savedTheme === "dark") {
            root.dataset.theme = savedTheme;
          }
          if (!button) return;
          button.addEventListener("click", () => {
            const nextTheme = root.dataset.theme === "light" ? "dark" : "light";
            root.dataset.theme = nextTheme;
            localStorage.setItem(storageKey, nextTheme);
          });
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
    staticAssets: env.ASSETS,
    operatorToken: env.OPERATOR_TOKEN,
    now: () => new Date().toISOString()
  });
}
