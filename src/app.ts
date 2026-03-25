import {
  ensureCategoriesArtifact,
  ensureCategoryCountryArtifact,
  ensureCategoryMerchantArtifact,
  ensureCategoryOffersArtifact,
  ensurePublishedSkillArtifact,
  ensurePublishedSkillsIndexArtifact,
  ensureRootSkillArtifact,
  materializeSkillArtifacts,
  materializePublicArtifacts
} from "./artifacts";
import { readDeployConfig, type Env } from "./config";
import type {
  CategoriesArtifact,
  Category,
  CategoryDirectoryEntry,
  MerchantArtifact,
  MerchantConnectPayload,
  RegisterClawInput
} from "./domain";
import { badRequest, notFound } from "./errors";
import { errorResponse, html, isMethod, json, parseJson, text } from "./http";
import { prepareRequestMetric, recordRequestMetric } from "./metrics";
import { normalizeCountryCode } from "./merchant";
import { R2ArtifactStore } from "./r2";
import { ROOT_SKILL_NAME } from "./skill";
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

function buildSkillArtifactInput(config: ReturnType<typeof readDeployConfig>) {
  return {
    brandName: config.brandName,
    deployId: config.deployId,
    deployDomain: config.deployDomain,
    directorySummary: config.verticalSummary,
    categoriesPath: "/categories",
    registerPath: "/claws/register"
  };
}

function normalizeWellKnownPath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
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
        const wellKnownPath = normalizeWellKnownPath(url.pathname);
        requestNormalizedPath = normalizedPath;
        requestMetric = await prepareRequestMetric(request, normalizedPath);

        if (pathname.startsWith("/assets/") && dependencies.staticAssets) {
          return dependencies.staticAssets.fetch(request);
        }

        if (wellKnownPath === "/.well-known/agent-skills/index.json" && isMethod(request, "GET")) {
          const index = await ensurePublishedSkillsIndexArtifact(dependencies.artifacts);
          response = json(index);
        } else if (wellKnownPath === "/.well-known/skills/index.json" && isMethod(request, "GET")) {
          const index = await ensurePublishedSkillsIndexArtifact(dependencies.artifacts);
          response = json(index);
        } else if (
          (wellKnownPath === `/.well-known/agent-skills/${ROOT_SKILL_NAME}/SKILL.md`
            || wellKnownPath === `/.well-known/skills/${ROOT_SKILL_NAME}/SKILL.md`)
          && isMethod(request, "GET")
        ) {
          const skill = await ensurePublishedSkillArtifact(
            dependencies.artifacts,
            dependencies.repositories,
            dependencies.now(),
            buildSkillArtifactInput(dependencies.config)
          );

          response = text(skill, { headers: { "content-type": "text/markdown; charset=utf-8" } });
        } else if (normalizedPath === "/" && isMethod(request, "GET")) {
          const categoriesArtifact = await ensureCategoriesArtifact(
            dependencies.artifacts,
            dependencies.repositories,
            dependencies.now()
          );

          response = html(
            renderLandingPage(
              dependencies.config,
              url.origin,
              categoriesArtifact.categories
            )
          );
        } else if (normalizedPath === "/skill" && isMethod(request, "GET")) {
          const skill = await ensureRootSkillArtifact(
            dependencies.artifacts,
            dependencies.repositories,
            dependencies.now(),
            buildSkillArtifactInput(dependencies.config)
          );

          response = text(skill, { headers: { "content-type": "text/markdown; charset=utf-8" } });
        } else if (normalizedPath === "/categories" && isMethod(request, "GET")) {
          const artifact = await ensureCategoriesArtifact(
            dependencies.artifacts,
            dependencies.repositories,
            dependencies.now()
          );

          response = wantsMarkdown
            ? text(renderCategoriesIndexMarkdown(artifact, url.origin), {
              headers: { "content-type": "text/markdown; charset=utf-8" }
            })
            : json({
              generated_at: artifact.generatedAt,
              categories: artifact.categories.map((category) => ({
                slug: category.slug,
                name: category.name,
                summary: category.summary,
                subtitle: category.subtitle,
                mascot_url: category.mascotUrl,
                buying_targets: category.buyingTargets,
                countries_path: category.countriesPath
              }))
            });
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
        } else {
          const categoryCountriesIndexMatch = normalizedPath.match(/^\/([^/]+)\/countries$/);
          if (categoryCountriesIndexMatch && isMethod(request, "GET")) {
            const categorySlug = categoryCountriesIndexMatch[1] ?? "";
            const category = await requireCategory(dependencies.repositories, categorySlug);
            const countryCodes = await dependencies.repositories.listCountryCodesForCategory(category.slug);
            response = wantsMarkdown
              ? text(renderCategoryCountriesIndexMarkdown(category, countryCodes, url.origin), {
                headers: { "content-type": "text/markdown; charset=utf-8" }
              })
              : json({
                category_slug: category.slug,
                generated_at: dependencies.now(),
                countries: countryCodes
              });
          } else {
            const categoryCountryMatch = normalizedPath.match(/^\/([^/]+)\/countries\/([A-Za-z]{2,3})$/);
            if (categoryCountryMatch && isMethod(request, "GET")) {
              const categorySlug = categoryCountryMatch[1] ?? "";
              const countryCode = normalizeCountryCode(categoryCountryMatch[2] ?? "");
              const category = await requireCategory(dependencies.repositories, categorySlug);
              if (!(await dependencies.repositories.supportsCountryForCategory(category.slug, countryCode))) {
                throw notFound("Country not found");
              }

              const artifact = await ensureCategoryCountryArtifact(
                dependencies.artifacts,
                dependencies.repositories,
                category.slug,
                countryCode,
                dependencies.now()
              );

              response = wantsMarkdown
                ? text(renderCountryMarkdown(category, artifact, url.origin), {
                  headers: { "content-type": "text/markdown; charset=utf-8" }
                })
                : json({
                  category_slug: category.slug,
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
              const categoryOffersMatch = normalizedPath.match(/^\/([^/]+)\/offers\/([A-Za-z]{2,3})$/);
              if (categoryOffersMatch && isMethod(request, "GET")) {
                const categorySlug = categoryOffersMatch[1] ?? "";
                const countryCode = normalizeCountryCode(categoryOffersMatch[2] ?? "");
                const category = await requireCategory(dependencies.repositories, categorySlug);
                if (!(await dependencies.repositories.supportsCountryForCategory(category.slug, countryCode))) {
                  throw notFound("Country not found");
                }

                const artifact = await ensureCategoryOffersArtifact(
                  dependencies.artifacts,
                  dependencies.repositories,
                  category.slug,
                  countryCode,
                  dependencies.now()
                );

                response = wantsMarkdown
                  ? text(renderOffersMarkdown(category, artifact.offers, countryCode), {
                    headers: { "content-type": "text/markdown; charset=utf-8" }
                  })
                  : json({
                    category_slug: category.slug,
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
                const categoryMerchantMatch = normalizedPath.match(/^\/([^/]+)\/merchants\/([^/]+)$/);
                if (categoryMerchantMatch && isMethod(request, "GET")) {
                  const categorySlug = categoryMerchantMatch[1] ?? "";
                  const slug = categoryMerchantMatch[2] ?? "";
                  const category = await requireCategory(dependencies.repositories, categorySlug);
                  const artifact = await ensureCategoryMerchantArtifact(
                    dependencies.artifacts,
                    dependencies.repositories,
                    category.slug,
                    slug,
                    dependencies.now()
                  );

                  if (!artifact) {
                    throw notFound("Merchant not found");
                  }

                  response = wantsMarkdown
                    ? text(renderMerchantMarkdown(category, artifact, url.origin), {
                      headers: { "content-type": "text/markdown; charset=utf-8" }
                    })
                    : json(renderMerchantResponse(category, artifact));
                } else {
                  const merchantMatch = normalizedPath.match(/^\/([^/]+)\/merchants\/([^/]+)\/connect$/);
                  if (merchantMatch && isMethod(request, "GET")) {
                    const categorySlug = merchantMatch[1] ?? "";
                    const slug = merchantMatch[2] ?? "";
                    const category = await requireCategory(dependencies.repositories, categorySlug);
                    const artifact = await ensureCategoryMerchantArtifact(
                      dependencies.artifacts,
                      dependencies.repositories,
                      category.slug,
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
                        connectPath: `/${category.slug}/merchants/${artifact.slug}/connect`,
                        storeUrl: artifact.storeUrl
                      },
                      mcp: {
                        url: artifact.storefrontMcpUrl
                      },
                      offers: await listCategoryMerchantOffers(
                        dependencies.repositories,
                        category.slug,
                        artifact,
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
                      ? text(renderMerchantConnectMarkdown(category, payload), {
                        headers: { "content-type": "text/markdown; charset=utf-8" }
                      })
                      : json({
                        category_slug: category.slug,
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

                      const sinceRaw = url.searchParams.get("since");
                      const since = parseSince(sinceRaw);
                      const target = parseMaterializeTarget(url.searchParams.get("target"));
                      const skillInput = buildSkillArtifactInput(dependencies.config);

                      if (target === "skill") {
                        const categories = await dependencies.repositories.listCategories();
                        await materializeSkillArtifacts(
                          dependencies.artifacts,
                          categories,
                          skillInput,
                          dependencies.now()
                        );
                      } else {
                        await materializePublicArtifacts(
                          dependencies.artifacts,
                          dependencies.repositories,
                          dependencies.now(),
                          skillInput,
                          since
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

async function requireCategory(repositories: Repositories, slug: string): Promise<Category> {
  const category = await repositories.getCategory(slug);
  if (!category) {
    throw notFound("Category not found");
  }

  return category;
}

async function listCategoryMerchantOffers(
  repositories: Repositories,
  categorySlug: string,
  merchant: Pick<MerchantArtifact, "slug" | "countryCodes">,
  now: string
) {
  const offersByCountry = await Promise.all(
    merchant.countryCodes.map((countryCode) =>
      repositories.listActiveOffersForCategory(categorySlug, countryCode, now)
    )
  );

  const seen = new Set<string>();
  return offersByCountry
    .flat()
    .filter((offer) => offer.merchantSlug === merchant.slug)
    .filter((offer) => {
      if (seen.has(offer.offerId)) {
        return false;
      }

      seen.add(offer.offerId);
      return true;
    });
}

function renderCategoriesIndexMarkdown(artifact: CategoriesArtifact, origin: string): string {
  if (artifact.categories.length === 0) {
    return "# Categories\n\nNo categories are available yet.";
  }

  const lines = ["# Categories", ""];
  for (const category of artifact.categories) {
    lines.push(`- ${category.name} (\`${category.slug}\`)`);
    lines.push(`  - summary: ${category.summary}`);
    if (category.buyingTargets) {
      lines.push(`  - use_when_buying: ${category.buyingTargets}`);
    }
    lines.push(`  - countries_url: \`${origin}${category.countriesPath}.md\``);
    lines.push("");
  }

  return lines.join("\n");
}

function renderCategoryCountriesIndexMarkdown(category: Category, countryCodes: string[], origin: string): string {
  const header = `# ${category.name} Countries`;
  if (countryCodes.length === 0) {
    return `${header}\n\nNo countries are available in this category yet.`;
  }

  const lines = [header, ""];
  for (const countryCode of countryCodes) {
    lines.push(`- ${countryCode}: \`${origin}/${category.slug}/countries/${countryCode}.md\``);
  }

  return lines.join("\n");
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

function renderCountryMarkdown(category: Category, artifact: {
  countryCode: string;
  merchants: Array<{
    slug: string;
    storeUrl: string;
    summary: string;
    description: string;
    activeOffersCount: number;
  }>;
}, origin: string): string {
  const header = `# ${category.name} Merchants in ${artifact.countryCode}`;
  if (artifact.merchants.length === 0) {
    return `${header}\n\nNo merchants are available in this country.`;
  }

  const merchants = artifact.merchants.map((merchant) => {
    const offerHint = merchant.activeOffersCount === 0 ? "no active offers" : `${merchant.activeOffersCount} active offer(s)`;
    const merchantPath = `/${category.slug}/merchants/${merchant.slug}.md`;
    const connectPath = `/${category.slug}/merchants/${merchant.slug}/connect.md`;
    const descriptionLine = merchant.description ? `\n  - description: ${merchant.description}` : "";
    const summaryLine = merchant.summary ? `\n  - summary: ${merchant.summary}` : "";
    return `- ${merchant.slug}: ${offerHint}${descriptionLine}${summaryLine}\n  - store_url: \`${merchant.storeUrl}\`\n  - merchant_url: \`${origin}${merchantPath}\`\n  - connect_url: \`${origin}${connectPath}\``;
  });

  return `${header}\n\n${merchants.join("\n\n")}`;
}

function renderOffersMarkdown(category: Category, offers: Array<{
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
    `# Active ${category.name} Offers in ${countryCode}`,
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

function renderMerchantResponse(category: Category, artifact: MerchantArtifact) {
  return {
    category_slug: category.slug,
    merchant: {
      slug: artifact.slug,
      display_name: artifact.displayName,
      store_url: artifact.storeUrl,
      country_codes: artifact.countryCodes,
      category_slugs: artifact.categorySlugs,
      active_offers_count: artifact.activeOffersCount,
      connect_path: `/${category.slug}/merchants/${artifact.slug}/connect`
    }
  };
}

function renderMerchantMarkdown(category: Category, artifact: MerchantArtifact, origin: string): string {
  return [
    `# ${artifact.displayName}`,
    "",
    `- category: \`${category.slug}\``,
    `- merchant_slug: \`${artifact.slug}\``,
    `- store_url: \`${artifact.storeUrl}\``,
    `- countries: ${artifact.countryCodes.map((countryCode) => `\`${countryCode}\``).join(", ")}`,
    `- category_slugs: ${artifact.categorySlugs.map((categorySlug) => `\`${categorySlug}\``).join(", ")}`,
    `- active_offers_count: ${artifact.activeOffersCount}`,
    `- connect_url: \`${origin}/${category.slug}/merchants/${artifact.slug}/connect.md\``
  ].join("\n");
}

function renderMerchantConnectMarkdown(category: Category, payload: MerchantConnectPayload): string {
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
    `- category_slug: \`${category.slug}\``,
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

function renderLandingPage(
  config: ReturnType<typeof readDeployConfig>,
  origin: string,
  categories: CategoryDirectoryEntry[]
): string {
  const rootUrl = origin.replace(/\/$/, "");
  const skillUrl = `${rootUrl}/skill.md`;
  const installCommand = `npx skills add ${skillUrl} -g -y`;
  const footerMarkdown = config.landingFooterMarkdown?.trim();
  const navRegisterLink = footerMarkdown ? '<a href="#register">register</a>' : "";
  const heroRegisterLink = footerMarkdown
    ? '<a class="surface-hero__cta surface-hero__cta--ghost" href="#register">register your store</a>'
    : "";
  const categoryCards = normalizeLandingCategories(categories);
  const categoryMarkup = categoryCards.length === 0
    ? `<p class="surface-empty">No categories are available yet.</p>`
    : categoryCards.map((category) => `
        <a class="surface-category-card" href="${escapeHtml(category.countriesPath)}">
          <span class="surface-category-card__art">
            <img src="${escapeHtml(category.mascotUrl)}" alt="${escapeHtml(category.name)} mascot">
          </span>
          <span class="surface-category-card__body">
            <strong>${escapeHtml(category.name)}</strong>
            <span class="surface-category-card__subtitle">${escapeHtml(category.subtitle ?? category.summary)}</span>
          </span>
          <span class="surface-category-card__action">open</span>
        </a>
      `).join("");
  const footerMarkup = footerMarkdown
    ? `
      <section class="panel surface-panel surface-footer" id="register">
        <div class="surface-footer-markdown">
          ${renderMarkdownFragment(footerMarkdown)}
        </div>
      </section>
    `
    : "";
  const installInstruction = `Read and install this skill ${skillUrl} and follow its instructions for all shopping requests.`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(config.brandName)}: Discover merchants by category</title>
    <meta name="color-scheme" content="dark light">
    <meta name="description" content="${escapeHtml(config.verticalSummary)}">
    <style>
      :root {
        color-scheme: dark;
        --bg: #0a0a0a;
        --bg-top: rgba(196, 159, 106, 0.1);
        --bg-start: #090909;
        --bg-mid: #0a0a0a;
        --bg-end: #080808;
        --panel: #101010;
        --panel-strong: #16130f;
        --ink: #ece5d7;
        --muted: #9f9687;
        --line: #2c2720;
        --line-soft: rgba(236, 229, 215, 0.08);
        --accent: #f4ede0;
        --accent-dim: #c49f6a;
        --shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
        --grid-horizontal: rgba(255, 255, 255, 0.02);
        --grid-vertical: rgba(255, 255, 255, 0.018);
        --grid-mask: rgba(0, 0, 0, 0.38);
        --surface-overlay-top: rgba(255, 255, 255, 0.022);
        --surface-overlay-bottom: rgba(255, 255, 255, 0.006);
        --hero-card-tint: rgba(196, 159, 106, 0.1);
        --hero-card-fade: rgba(196, 159, 106, 0);
      }
      @media (prefers-color-scheme: light) {
        :root {
          color-scheme: light;
          --bg: #f4efe6;
          --bg-top: rgba(183, 126, 58, 0.12);
          --bg-start: #fbf7f1;
          --bg-mid: #f4efe6;
          --bg-end: #ece3d4;
          --panel: rgba(255, 251, 245, 0.86);
          --panel-strong: #f6efe3;
          --ink: #241b13;
          --muted: #6e6257;
          --line: rgba(92, 70, 44, 0.18);
          --line-soft: rgba(92, 70, 44, 0.1);
          --accent: #2c2016;
          --accent-dim: #9b6d38;
          --shadow: 0 24px 70px rgba(88, 61, 28, 0.1);
          --grid-horizontal: rgba(61, 39, 15, 0.05);
          --grid-vertical: rgba(61, 39, 15, 0.035);
          --grid-mask: rgba(255, 255, 255, 0.08);
          --surface-overlay-top: rgba(255, 255, 255, 0.7);
          --surface-overlay-bottom: rgba(255, 255, 255, 0.38);
          --hero-card-tint: rgba(183, 126, 58, 0.12);
          --hero-card-fade: rgba(183, 126, 58, 0);
        }
      }
      :root[data-theme="light"] {
        color-scheme: light;
        --bg: #f4efe6;
        --bg-top: rgba(183, 126, 58, 0.12);
        --bg-start: #fbf7f1;
        --bg-mid: #f4efe6;
        --bg-end: #ece3d4;
        --panel: rgba(255, 251, 245, 0.86);
        --panel-strong: #f6efe3;
        --ink: #241b13;
        --muted: #6e6257;
        --line: rgba(92, 70, 44, 0.18);
        --line-soft: rgba(92, 70, 44, 0.1);
        --accent: #2c2016;
        --accent-dim: #9b6d38;
        --shadow: 0 24px 70px rgba(88, 61, 28, 0.1);
        --grid-horizontal: rgba(61, 39, 15, 0.05);
        --grid-vertical: rgba(61, 39, 15, 0.035);
        --grid-mask: rgba(255, 255, 255, 0.08);
        --surface-overlay-top: rgba(255, 255, 255, 0.7);
        --surface-overlay-bottom: rgba(255, 255, 255, 0.38);
        --hero-card-tint: rgba(183, 126, 58, 0.12);
        --hero-card-fade: rgba(183, 126, 58, 0);
      }
      :root[data-theme="dark"] {
        color-scheme: dark;
        --bg: #0a0a0a;
        --bg-top: rgba(196, 159, 106, 0.1);
        --bg-start: #090909;
        --bg-mid: #0a0a0a;
        --bg-end: #080808;
        --panel: #101010;
        --panel-strong: #16130f;
        --ink: #ece5d7;
        --muted: #9f9687;
        --line: #2c2720;
        --line-soft: rgba(236, 229, 215, 0.08);
        --accent: #f4ede0;
        --accent-dim: #c49f6a;
        --shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
        --grid-horizontal: rgba(255, 255, 255, 0.02);
        --grid-vertical: rgba(255, 255, 255, 0.018);
        --grid-mask: rgba(0, 0, 0, 0.38);
        --surface-overlay-top: rgba(255, 255, 255, 0.022);
        --surface-overlay-bottom: rgba(255, 255, 255, 0.006);
        --hero-card-tint: rgba(196, 159, 106, 0.1);
        --hero-card-fade: rgba(196, 159, 106, 0);
      }
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top, var(--bg-top), transparent 30%),
          linear-gradient(180deg, var(--bg-start) 0%, var(--bg-mid) 45%, var(--bg-end) 100%);
        color: var(--ink);
        font-family: "SFMono-Regular", "Menlo", "Monaco", "Consolas", monospace;
        line-height: 1.6;
      }
      body::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        background-image:
          linear-gradient(var(--grid-horizontal) 1px, transparent 1px),
          linear-gradient(90deg, var(--grid-vertical) 1px, transparent 1px);
        background-size: 100% 32px, 32px 100%;
        mask-image: linear-gradient(180deg, var(--grid-mask), transparent 88%);
      }
      a { color: inherit; }
      main {
        width: min(1080px, calc(100% - 32px));
        margin: 0 auto;
        padding: 20px 0 64px;
        display: grid;
        gap: 18px;
      }
      .topbar, .panel {
        border: 1px solid var(--line);
        background: linear-gradient(180deg, var(--surface-overlay-top), var(--surface-overlay-bottom));
        box-shadow: var(--shadow);
        backdrop-filter: blur(12px);
      }
      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 12px 14px;
      }
      .topbar-controls, .nav, .surface-hero__ctas {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }
      .brand, .nav a, .surface-footer-markdown a { text-decoration: none; }
      .brand { color: var(--accent); font-size: 0.96rem; white-space: nowrap; }
      .nav a:hover, .surface-footer-markdown a:hover { color: var(--accent); }
      .theme-toggle {
        border: 1px solid var(--line);
        background: var(--panel);
        color: var(--ink);
        padding: 8px 10px;
        font: inherit;
        cursor: pointer;
      }
      .theme-toggle:hover, .surface-hero__cta:hover, .surface-category-card:hover, .copy-button:hover {
        border-color: var(--accent-dim);
      }
      .surface-hero, .surface-panel { border-radius: 24px; }
      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
        gap: 18px;
        padding: 22px 18px;
        align-items: stretch;
      }
      .surface-hero__copy { display: flex; flex-direction: column; min-width: 0; }
      .surface-hero__copy h1, .surface-section-heading h2 {
        margin: 0;
        line-height: 1.04;
        letter-spacing: -0.04em;
      }
      .surface-hero__copy h1 { font-size: clamp(34px, 7vw, 70px); margin-bottom: 14px; }
      .surface-kicker { margin: 0; color: var(--muted); text-transform: uppercase; letter-spacing: 0.12em; font-size: 12px; }
      .surface-hero__body, .surface-section-heading p, .install-copy, .surface-footer-markdown p { color: var(--muted); }
      .surface-hero__body { margin: 0 0 22px; max-width: 60ch; }
      .surface-hero__cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 12px 16px;
        border-radius: 999px;
        border: 1px solid var(--line);
        text-decoration: none;
      }
      .surface-hero__cta--primary { background: var(--accent); color: var(--bg); border-color: transparent; }
      .surface-hero__panel {
        border: 1px solid var(--line);
        background:
          linear-gradient(180deg, var(--hero-card-tint), var(--hero-card-fade)),
          linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent);
      }
      .surface-hero__art, .surface-hero__art img { width: 100%; height: 100%; }
      .surface-hero__art { overflow: hidden; }
      .surface-hero__art img { display: block; min-height: 100%; object-fit: cover; }
      .panel { padding: 18px; }
      .surface-section-heading { display: grid; gap: 10px; margin-bottom: 18px; }
      .surface-section-heading p { margin: 0; max-width: 68ch; }
      .surface-category-grid { display: grid; gap: 14px; }
      .surface-category-card {
        display: grid;
        grid-template-columns: 84px minmax(0, 1fr) auto;
        gap: 14px;
        align-items: center;
        padding: 14px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.02);
        text-decoration: none;
      }
      .surface-category-card__art {
        display: block;
        aspect-ratio: 1;
        overflow: hidden;
        border-radius: 16px;
        border: 1px solid var(--line-soft);
      }
      .surface-category-card__art img { display: block; width: 100%; height: 100%; object-fit: cover; }
      .surface-category-card__body { min-width: 0; display: grid; gap: 4px; }
      .surface-category-card__subtitle, .surface-category-card__action, .surface-empty { color: var(--muted); }
      .surface-category-card__action {
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 6px 10px;
        white-space: nowrap;
      }
      .install-grid { display: grid; gap: 16px; align-items: stretch; }
      .install-lead { display: grid; gap: 10px; }
      .install-lead h2 { margin: 0; line-height: 1.08; letter-spacing: -0.03em; }
      .install-copy { margin: 0; }
      .install-card {
        border: 1px solid var(--line);
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent);
        padding: 16px;
      }
      .prompt {
        position: relative;
        padding: 64px 18px 18px;
        background: color-mix(in srgb, var(--panel-strong) 92%, transparent);
        border: 1px solid var(--line);
      }
      .prompt pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        padding-right: 116px;
        color: var(--accent);
      }
      .copy-button {
        position: absolute;
        top: 12px;
        right: 12px;
        z-index: 1;
        border: 1px solid var(--line);
        background: transparent;
        color: var(--muted);
        padding: 8px 10px;
        font: inherit;
        cursor: pointer;
      }
      @media (max-width: 640px) {
        .prompt {
          padding: 72px 16px 16px;
        }
        .prompt pre {
          padding-right: 0;
        }
      }
      .surface-footer-markdown { display: grid; gap: 14px; }
      .surface-footer-markdown h2, .surface-footer-markdown h3, .surface-footer-markdown p, .surface-footer-markdown ul { margin: 0; }
      .surface-footer-markdown ul { padding-left: 18px; color: var(--muted); }
      .surface-footer-markdown a { border-bottom: 1px solid transparent; }
      .surface-footer-markdown a:hover { border-bottom-color: var(--accent-dim); }
      @media (min-width: 720px) { .surface-category-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (min-width: 880px) { .install-grid { grid-template-columns: minmax(0, 1fr) minmax(320px, 0.9fr); } }
      @media (max-width: 860px) { .hero { grid-template-columns: 1fr; } }
      @media (max-width: 640px) {
        main { width: min(100%, calc(100% - 20px)); padding-top: 10px; }
        .topbar { align-items: flex-start; }
        .surface-category-card { grid-template-columns: 72px minmax(0, 1fr); }
        .surface-category-card__action { grid-column: 2; justify-self: start; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="topbar">
        <a class="brand" href="#top">${escapeHtml(config.brandName)}</a>
        <div class="topbar-controls">
          <nav class="nav" aria-label="Section navigation">
            <a href="#install">install</a>
            <a href="#directory">directory</a>
            ${navRegisterLink}
          </nav>
          <button class="theme-toggle" type="button" data-theme-toggle>light mode</button>
        </div>
      </div>
      <section class="hero panel surface-hero" id="top">
        <div class="surface-hero__copy">
          <p class="surface-kicker">discovery for AI shoppers</p>
          <h1>Find the right stores with ${escapeHtml(config.brandName)}.</h1>
          <p class="surface-hero__body">${escapeHtml(config.verticalSummary)}</p>
          <div class="surface-hero__ctas">
            <a class="surface-hero__cta surface-hero__cta--primary" href="#install">copy agent prompt</a>
            <a class="surface-hero__cta surface-hero__cta--secondary" href="#directory">browse categories</a>
            ${heroRegisterLink}
          </div>
        </div>
        <div class="surface-hero__panel">
          <div class="surface-hero__art">
            <img src="${escapeHtml(config.mascotUrl)}" alt="${escapeHtml(config.brandName)} mascot">
          </div>
        </div>
      </section>
      <section class="panel surface-panel install-shell" id="install">
        <div class="install-grid">
          <div class="install-lead">
            <p class="surface-kicker">agent prompt</p>
            <h2>Installed for any agent.</h2>
            <p class="install-copy">Use ${escapeHtml(config.brandName)} with OpenClaw, Codex, Cursor, Claude Code, or any agent that can read a URL, start in the right category, compare stores, and jump to the best storefront.</p>
            <p class="install-copy">Canonical install command: <code>${escapeHtml(installCommand)}</code></p>
          </div>
          <article class="install-card">
            <div class="prompt">
              <button class="copy-button" type="button" data-copy-install>copy</button>
              <pre data-install-instruction>${escapeHtml(installInstruction)}</pre>
            </div>
          </article>
        </div>
      </section>
      <section class="panel surface-panel surface-categories" id="directory">
        <div class="surface-section-heading">
          <div>
            <p class="surface-kicker">directory</p>
            <h2>Browse the directory.</h2>
          </div>
          <p>Start with a category, then let your agent stay inside that lane to compare merchants and move toward the right storefront.</p>
        </div>
        <div class="surface-category-grid">
          ${categoryMarkup}
        </div>
      </section>
      ${footerMarkup}
    </main>
    <script>
      (() => {
        const root = document.documentElement;
        const themeToggle = document.querySelector("[data-theme-toggle]");
        const copyButton = document.querySelector("[data-copy-install]");
        const installInstruction = document.querySelector("[data-install-instruction]");
        const storageKey = "lobsterbazaar-theme";

        const applyTheme = (theme) => {
          root.dataset.theme = theme;
          if (themeToggle) {
            themeToggle.textContent = theme === "light" ? "dark mode" : "light mode";
          }
        };

        let initialTheme = "dark";
        try {
          const savedTheme = window.localStorage.getItem(storageKey);
          if (savedTheme === "light" || savedTheme === "dark") {
            initialTheme = savedTheme;
          } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
            initialTheme = "light";
          }
        } catch {
          if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
            initialTheme = "light";
          }
        }
        applyTheme(initialTheme);

        if (themeToggle) {
          themeToggle.addEventListener("click", () => {
            const next = root.dataset.theme === "light" ? "dark" : "light";
            applyTheme(next);
            try {
              window.localStorage.setItem(storageKey, next);
            } catch {
              // Ignore localStorage write failures.
            }
          });
        }

        if (copyButton && installInstruction) {
          copyButton.addEventListener("click", async () => {
            const original = copyButton.textContent || "copy";
            try {
              await navigator.clipboard.writeText(installInstruction.textContent || "");
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
  </body>
</html>`;
}

interface LandingCategoryCard {
  countriesPath: string;
  mascotUrl: string;
  name: string;
  slug: string;
  summary: string;
  subtitle?: string;
}

function normalizeLandingCategories(categories: CategoryDirectoryEntry[]): LandingCategoryCard[] {
  return [...categories]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((category) => ({
      countriesPath: `${category.countriesPath}.md`,
      mascotUrl: category.mascotUrl?.trim() || "/assets/mascots/lobsterbazaar-default.jpg",
      name: category.name,
      slug: category.slug,
      summary: category.summary,
      subtitle: category.subtitle?.trim() || undefined
    }));
}

function renderMarkdownFragment(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return "";
  }

  const blocks = trimmed.split(/\n\s*\n+/);
  return blocks.map((block) => renderMarkdownBlock(block)).join("");
}

function renderMarkdownBlock(block: string): string {
  const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return "";
  }

  if (lines.every((line) => line.startsWith("- "))) {
    return `<ul>${lines.map((line) => `<li>${renderInlineMarkdown(line.slice(2))}</li>`).join("")}</ul>`;
  }

  const firstLine = lines[0] ?? "";
  if (firstLine.startsWith("### ")) {
    return `<h3>${renderInlineMarkdown(firstLine.slice(4))}</h3>`;
  }
  if (firstLine.startsWith("## ")) {
    return `<h2>${renderInlineMarkdown(firstLine.slice(3))}</h2>`;
  }
  if (firstLine.startsWith("# ")) {
    return `<h2>${renderInlineMarkdown(firstLine.slice(2))}</h2>`;
  }

  return `<p>${renderInlineMarkdown(lines.join(" "))}</p>`;
}

function renderInlineMarkdown(textValue: string): string {
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let output = "";
  let lastIndex = 0;

  for (const match of textValue.matchAll(linkPattern)) {
    const start = match.index ?? 0;
    output += escapeHtml(textValue.slice(lastIndex, start));

    const label = match[1] ?? "";
    const href = match[2] ?? "";
    if (isSafeMarkdownHref(href)) {
      output += `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
    } else {
      output += escapeHtml(match[0] ?? "");
    }

    lastIndex = start + (match[0]?.length ?? 0);
  }

  output += escapeHtml(textValue.slice(lastIndex));
  return output;
}

function isSafeMarkdownHref(value: string): boolean {
  return /^(https?:\/\/|mailto:|\/|#)/i.test(value.trim());
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
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
