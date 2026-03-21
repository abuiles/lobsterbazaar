import {
  ensureCategoriesArtifact,
  ensureCategoryCountryArtifact,
  ensureCategoryMerchantArtifact,
  ensureCategoryOffersArtifact,
  ensureCategorySkillArtifact,
  ensureRootSkillArtifact,
  materializeSkillArtifacts,
  materializePublicArtifacts
} from "./artifacts";
import { readDeployConfig, type Env } from "./config";
import type {
  CategoriesArtifact,
  Category,
  CategoryDirectoryEntry,
  FeaturedMerchantSummary,
  MerchantArtifact,
  MerchantConnectPayload,
  RegisterClawInput
} from "./domain";
import { badRequest, notFound } from "./errors";
import { errorResponse, html, isMethod, json, parseJson, text } from "./http";
import { prepareRequestMetric, recordRequestMetric } from "./metrics";
import { normalizeCountryCode } from "./merchant";
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

type RootSurfaceSectionName = "hero" | "categories" | "featured" | "network" | "merchant_onboarding";

interface RootSurfaceCategoryCardConfig {
  name?: string;
  summary?: string;
  subtitle?: string;
  mascotUrl?: string;
  badge?: string;
  actionLabel?: string;
  eyebrow?: string;
  href?: string;
}

interface RootSurfaceCategoryCard {
  slug: string;
  name: string;
  summary: string;
  subtitle?: string;
  mascotUrl: string;
  badge: string;
  actionLabel: string;
  eyebrow?: string;
  href: string;
}

interface RootSurfaceHeroConfig {
  eyebrow?: string;
  title?: string;
  body?: string;
  imageUrl?: string;
  imageAlt?: string;
  primaryCta?: {
    label: string;
    href: string;
  };
  secondaryCta?: {
    label: string;
    href: string;
  };
  tertiaryCta?: {
    label: string;
    href: string;
  };
}

interface RootSurfaceInstallConfig {
  title?: string;
  body?: string;
  prompt?: string;
  primaryCta?: {
    label: string;
    href: string;
  };
  secondaryCta?: {
    label: string;
    href: string;
  };
}

interface RootSurfaceNetworkEntry {
  brandName: string;
  href: string;
  subtitle?: string;
  emoji?: string;
}

interface RootSurfaceConfig {
  sectionOrder?: RootSurfaceSectionName[];
  hero?: RootSurfaceHeroConfig;
  install?: RootSurfaceInstallConfig;
  categories?: {
    title?: string;
    body?: string;
    emptyMessage?: string;
  };
  categoryOrder?: string[];
  categoryCards?: Record<string, RootSurfaceCategoryCardConfig>;
  featured?: {
    title?: string;
    body?: string;
    maxItems?: number;
  };
  network?: {
    title?: string;
    body?: string;
    entries?: RootSurfaceNetworkEntry[];
  };
  merchantOnboarding?: {
    title?: string;
    body?: string;
    ctaLabel?: string;
    ctaHref?: string;
    note?: string;
    bullets?: string[];
    supportLinks?: Array<{
      label: string;
      href: string;
    }>;
    footerLines?: string[];
  };
}

type ConfigWithRootSurface = ReturnType<typeof readDeployConfig> & {
  rootSurface?: RootSurfaceConfig;
  root_surface?: RootSurfaceConfig;
};

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

function readRootSurfaceConfig(config: ConfigWithRootSurface): RootSurfaceConfig | undefined {
  const rootSurface = config.rootSurface ?? config.root_surface;
  if (!rootSurface || typeof rootSurface !== "object" || Array.isArray(rootSurface)) {
    return undefined;
  }

  return rootSurface as RootSurfaceConfig;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readCategoryString(category: CategoryDirectoryEntry | Category, key: "subtitle" | "mascotUrl" | "badge" | "eyebrow"): string | undefined {
  return readOptionalString((category as unknown as Record<string, unknown>)[key]);
}

function readRootSurfaceCategoryCard(
  category: CategoryDirectoryEntry | Category,
  surface?: RootSurfaceConfig
): RootSurfaceCategoryCard {
  const overrides = surface?.categoryCards?.[category.slug] ?? {};
  const name = readOptionalString(overrides.name) ?? readOptionalString((category as unknown as Record<string, unknown>).name) ?? category.slug;
  const summary = readOptionalString(overrides.summary) ?? readOptionalString((category as unknown as Record<string, unknown>).summary) ?? "";
  const subtitle =
    readOptionalString(overrides.subtitle)
    ?? readCategoryString(category, "subtitle")
    ?? readOptionalString(overrides.summary)
    ?? readOptionalString((category as unknown as Record<string, unknown>).summary);

  return {
    slug: category.slug,
    name,
    summary,
    subtitle,
    mascotUrl:
      readOptionalString(overrides.mascotUrl)
      ?? readCategoryString(category, "mascotUrl")
      ?? "/assets/mascots/lobsterbazaar-default.jpg",
    badge: readOptionalString(overrides.badge) ?? readCategoryString(category, "badge") ?? "open skill",
    actionLabel: readOptionalString(overrides.actionLabel) ?? "Open skill",
    eyebrow: readOptionalString(overrides.eyebrow) ?? readCategoryString(category, "eyebrow"),
    href: readOptionalString(overrides.href) ?? `/${category.slug}/skill.md`
  };
}

function normalizeRootCategories(
  categories: Array<CategoryDirectoryEntry | Category>,
  surface?: RootSurfaceConfig
): RootSurfaceCategoryCard[] {
  const order = surface?.categoryOrder?.map((slug) => slug.trim()).filter(Boolean) ?? [];
  const bySlug = new Map(categories.map((category) => [category.slug, readRootSurfaceCategoryCard(category, surface)]));

  const ordered = order
    .map((slug) => bySlug.get(slug))
    .filter((entry): entry is RootSurfaceCategoryCard => Boolean(entry));

  const seen = new Set(order);
  const remaining = categories
    .filter((category) => !seen.has(category.slug))
    .map((category) => readRootSurfaceCategoryCard(category, surface))
    .sort((left, right) => left.name!.localeCompare(right.name!));

  return [...ordered, ...remaining];
}

function readSectionOrder(surface?: RootSurfaceConfig): RootSurfaceSectionName[] {
  const configured = surface?.sectionOrder?.filter(
    (section): section is RootSurfaceSectionName =>
      section === "hero" || section === "categories" || section === "featured" || section === "network" || section === "merchant_onboarding"
  );

  return configured && configured.length > 0
    ? configured
    : ["hero", "categories", "network", "merchant_onboarding"];
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
          const rootSurface = readRootSurfaceConfig(dependencies.config as ConfigWithRootSurface);
          if (rootSurface) {
            const sectionOrder = readSectionOrder(rootSurface);
            const needsFeatured = sectionOrder.includes("featured") || Boolean(rootSurface.featured);
            const [categories, featuredMerchants] = await Promise.all([
              dependencies.repositories.listCategories(),
              needsFeatured
                ? dependencies.repositories.listFeaturedMerchants(dependencies.now())
                : Promise.resolve([] as FeaturedMerchantSummary[])
            ]);

            response = html(
              renderRootSurfaceLandingPage(
                dependencies.config,
                url.origin,
                categories,
                featuredMerchants,
                rootSurface
              )
            );
          } else {
            const [featuredMerchants, categoriesArtifact] = await Promise.all([
              dependencies.repositories.listFeaturedMerchants(dependencies.now()),
              ensureCategoriesArtifact(
                dependencies.artifacts,
                dependencies.repositories,
                dependencies.now()
              )
            ]);

            response = html(
              renderLegacyLandingPage(
                dependencies.config,
                url.origin,
                featuredMerchants,
                categoriesArtifact.categories
              )
            );
          }
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
                skill_path: category.skillPath,
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
          const categorySkillMatch = normalizedPath.match(/^\/([^/]+)\/skill$/);
          if (categorySkillMatch && isMethod(request, "GET")) {
            const categorySlug = categorySkillMatch[1] ?? "";
            const category = await requireCategory(dependencies.repositories, categorySlug);
            const skill = await ensureCategorySkillArtifact(
              dependencies.artifacts,
              category,
              buildSkillArtifactInput(dependencies.config)
            );

            response = text(skill, { headers: { "content-type": "text/markdown; charset=utf-8" } });
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
    lines.push(`  - skill_url: \`${origin}${category.skillPath}\``);
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
  categories: Category[]
): string {
  const skillUrl = `${origin.replace(/\/$/, "")}/skill.md`;
  const categoriesUrl = `${origin.replace(/\/$/, "")}/categories.md`;
  const categoryCards = categories.length === 0
    ? "<p>No categories are available yet.</p>"
    : categories.map((category) => `
        <a class="category-card" href="/${escapeHtml(category.slug)}/skill.md">
          <strong>${escapeHtml(category.name)}</strong>
          <span>${escapeHtml(category.summary)}</span>
          <code>/${escapeHtml(category.slug)}/skill.md</code>
        </a>
      `).join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(config.brandName)}</title>
    <style>
      body { margin: 0; font-family: monospace; background: #101216; color: #f4efe7; }
      main { width: min(960px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0 48px; display: grid; gap: 24px; }
      .hero, .panel { background: #171a20; border: 1px solid #2b303a; border-radius: 20px; padding: 24px; }
      h1, h2 { margin: 0 0 12px; }
      p { line-height: 1.6; color: #d3c9bb; }
      .paths { display: grid; gap: 8px; margin-top: 16px; }
      .paths code { display: block; padding: 10px 12px; background: #0f1217; border: 1px solid #2b303a; border-radius: 12px; color: #8ef2de; }
      .grid { display: grid; gap: 12px; }
      .category-card { display: grid; gap: 6px; padding: 16px; border: 1px solid #2b303a; border-radius: 16px; text-decoration: none; color: inherit; background: #0f1217; }
      .category-card span { color: #d3c9bb; }
      .category-card code { color: #8ef2de; }
      @media (min-width: 720px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <h1>${escapeHtml(config.brandName)}</h1>
        <p>${escapeHtml(config.verticalSummary)}</p>
        <p>The root introduces categories. Merchant discovery starts only after choosing one category.</p>
        <div class="paths">
          <code>Root skill: ${escapeHtml(skillUrl)}</code>
          <code>Category index: ${escapeHtml(categoriesUrl)}</code>
        </div>
      </section>
      <section class="panel">
        <h2>Categories</h2>
        <div class="grid">
          ${categoryCards}
        </div>
      </section>
    </main>
  </body>
</html>`;
}

function renderRootSurfaceLandingPage(
  config: ReturnType<typeof readDeployConfig>,
  origin: string,
  categories: Category[],
  featuredMerchants: FeaturedMerchantSummary[],
  surface: RootSurfaceConfig
): string {
  const rootUrl = origin.replace(/\/$/, "");
  const skillUrl = `${rootUrl}/skill.md`;
  const categoriesUrl = `${rootUrl}/categories.md`;
  const merchantOnboarding = surface.merchantOnboarding ?? {};
  const hero = surface.hero ?? {};
  const install = surface.install ?? {};
  const categoryCards = normalizeRootCategories(categories, surface);
  const featuredMax = surface.featured?.maxItems ?? 4;
  const featuredList = featuredMerchants.slice(0, featuredMax);
  const sectionOrder = readSectionOrder(surface);
  const sections = new Set(sectionOrder);
  const heroTitle = hero.title ?? `Discover merchants with ${config.brandName}.`;
  const heroBody = hero.body ?? "Use this directory to browse merchants by category, stay inside one discovery lane at a time, and hand off to merchant checkout when the fit is clear.";
  const heroEyebrow = hero.eyebrow ?? "merchant discovery directory";
  const heroPrimary = hero.primaryCta ?? { label: "> install the skill", href: "#install" };
  const heroSecondary = hero.secondaryCta ?? { label: "> browse directory", href: "#directory" };
  const heroTertiary = hero.tertiaryCta ?? { label: "> merchant onboarding", href: "#register" };
  const heroImageUrl = hero.imageUrl?.trim();
  const heroImageAlt = hero.imageAlt?.trim() || `${config.brandName} mascot`;
  const categoriesTitle = surface.categories?.title ?? "Categories";
  const categoriesBody = surface.categories?.body ?? "Start with a category, open its skill, then browse countries, merchants, and connect prompts inside that lane.";
  const categoriesEmpty = surface.categories?.emptyMessage ?? "No categories are available yet.";
  const onboardingTitle = merchantOnboarding.title ?? "Merchant onboarding";
  const onboardingBody = merchantOnboarding.body ?? "Install the Shopify app to create or manage your listing.";
  const onboardingCtaLabel = merchantOnboarding.ctaLabel ?? "Install the Shopify app";
  const onboardingCtaHref = merchantOnboarding.ctaHref ?? "https://apps.shopify.com/store-agent-kit";
  const onboardingNote = (merchantOnboarding.note ?? "Merchant setup lives below the directory so discovery stays first.").trim();
  const onboardingBullets = merchantOnboarding.bullets ?? [
    "Create your merchant listing in the app after installation.",
    "Keep your listing details current in the app.",
    "Share your store URL, category, and merchant details.",
    "Use merchant onboarding as the secondary flow after discovery."
  ];
  const onboardingSupportLinks = merchantOnboarding.supportLinks ?? [];
  const onboardingFooterLines = merchantOnboarding.footerLines ?? [];
  const installTitle = install.title ?? `Use ${config.brandName} with your preferred AI shopper.`;
  const installBody = install.body ?? "Start with the root skill, then browse the directory by category to find the right merchants for the shopper.";
  const installPrompt = install.prompt?.trim();
  const installPrimaryCta = install.primaryCta ?? { label: "Open root skill", href: skillUrl };
  const installSecondaryCta = install.secondaryCta ?? { label: "Browse categories", href: categoriesUrl };
  const networkEntries = surface.network?.entries ?? config.directoryVerticals.map((entry) => ({
    brandName: entry.brandName,
    href: entry.url,
    subtitle: entry.directorySubtitle ?? entry.verticalName ?? "",
    emoji: entry.emoji ?? "🦞"
  }));

  const categoryMarkup = categoryCards.length === 0
    ? `<p class="surface-empty">${escapeHtml(categoriesEmpty)}</p>`
    : categoryCards.map((category) => {
        const cardSummary = category.summary ?? "";
        const cardSubtitle = category.subtitle?.trim() || cardSummary;
        const cardBadge = category.badge ?? "open skill";
        const cardEyebrow = category.eyebrow ?? category.name?.toLowerCase() ?? category.slug;
        const mascotUrl = category.mascotUrl ?? "/assets/mascots/lobsterbazaar-default.jpg";
        const href = category.href ?? `/${category.slug}/skill.md`;

        return `
          <a class="surface-category-card" href="${escapeHtml(href)}">
            <span class="surface-category-card__art">
              <img src="${escapeHtml(mascotUrl)}" alt="${escapeHtml(category.name ?? category.slug)} mascot">
            </span>
            <span class="surface-category-card__body">
              <span class="surface-category-card__eyebrow">${escapeHtml(cardEyebrow)}</span>
              <strong>${escapeHtml(category.name ?? category.slug)}</strong>
              <span class="surface-category-card__subtitle">${escapeHtml(cardSubtitle)}</span>
            </span>
            <span class="surface-category-card__action">
              <span>${escapeHtml(cardBadge)}</span>
              <span>${escapeHtml(category.actionLabel ?? "Open skill")}</span>
            </span>
          </a>
        `;
      }).join("");

  const featuredMarkup = sections.has("featured") && featuredList.length > 0
    ? `
      <section class="panel surface-panel" id="featured">
        <div class="surface-section-heading">
          <div>
            <p class="surface-kicker">featured merchants</p>
            <h2>${escapeHtml(surface.featured?.title ?? "A few shops worth opening first.")}</h2>
          </div>
          <p>${escapeHtml(surface.featured?.body ?? "Use these merchants when the agent needs a trusted starting point.")}</p>
        </div>
        <div class="surface-featured-grid">
          ${renderFeaturedMerchantCards(featuredList)}
        </div>
      </section>
    `
    : "";

  const networkMarkup = sections.has("network") && networkEntries.length > 0
    ? `
      <section class="panel surface-panel" id="network">
        <div class="surface-section-heading">
          <div>
            <p class="surface-kicker">network</p>
            <h2>${escapeHtml(surface.network?.title ?? "The current Lobster network")}</h2>
          </div>
          <p>${escapeHtml(surface.network?.body ?? "These are the sibling deploys and brand entry points currently published alongside the directory.")}</p>
        </div>
        <div class="surface-network-grid">
          ${networkEntries.map((entry) => `
            <a class="surface-network-card" href="${escapeHtml(entry.href)}">
              <span class="surface-network-card__emoji">${escapeHtml(entry.emoji ?? "🦞")}</span>
              <span class="surface-network-card__body">
                <strong>${escapeHtml(entry.brandName)}</strong>
                <span>${escapeHtml(entry.subtitle ?? "")}</span>
              </span>
              <span class="surface-network-card__href">${escapeHtml(entry.href)}</span>
            </a>
          `).join("")}
        </div>
      </section>
    `
    : "";

  const onboardingMarkup = sections.has("merchant_onboarding")
    ? `
      <section class="panel surface-panel surface-onboarding" id="register">
        <div class="surface-section-heading">
          <div>
            <p class="surface-kicker">merchant onboarding</p>
            <h2>${escapeHtml(onboardingTitle)}</h2>
          </div>
          <p>${escapeHtml(onboardingBody)}</p>
        </div>
        <div class="surface-onboarding__content">
          <div class="surface-onboarding__lead">
            <a class="surface-onboarding__cta" href="${escapeHtml(onboardingCtaHref)}">${escapeHtml(onboardingCtaLabel)}</a>
            ${onboardingNote ? `<p class="surface-onboarding__note">${escapeHtml(onboardingNote)}</p>` : ""}
          </div>
          <div class="surface-onboarding__details">
            <ul class="surface-onboarding__bullets">
              ${onboardingBullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}
            </ul>
            <ul class="surface-onboarding__links">
              ${onboardingSupportLinks.map((link) => `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`).join("")}
            </ul>
            <div class="surface-onboarding__footer">
              ${onboardingFooterLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
            </div>
          </div>
        </div>
      </section>
    `
    : "";

  const installMarkup = sections.has("hero")
    ? `
      <section class="panel surface-panel install-shell" id="install">
        <div class="install-grid">
          <div class="install-lead">
            <p class="surface-kicker">install</p>
            <h2>${escapeHtml(installTitle)}</h2>
            <p class="install-copy">${escapeHtml(installBody)}</p>
          </div>
          ${installPrompt
            ? `
              <article class="install-card">
                <div class="prompt">
                  <button class="copy-button" type="button" data-copy-install>copy</button>
                  <pre data-install-instruction>${escapeHtml(installPrompt)}</pre>
                </div>
              </article>
            `
            : `
              <article class="install-card install-card--human">
                <div class="install-actions">
                  <a class="surface-hero__cta surface-hero__cta--primary" href="${escapeHtml(installPrimaryCta.href)}">${escapeHtml(installPrimaryCta.label)}</a>
                  <a class="surface-hero__cta surface-hero__cta--secondary" href="${escapeHtml(installSecondaryCta.href)}">${escapeHtml(installSecondaryCta.label)}</a>
                </div>
              </article>
            `}
        </div>
      </section>
    `
    : "";

  const heroMarkup = sections.has("hero")
    ? `
      <section class="hero panel surface-hero" id="top">
        <div class="surface-hero__copy">
          <p class="surface-kicker">${escapeHtml(heroEyebrow)}</p>
          <h1>${escapeHtml(heroTitle)}</h1>
          <p class="surface-hero__body">${escapeHtml(heroBody)}</p>
          <div class="surface-hero__ctas">
            <a class="surface-hero__cta surface-hero__cta--primary" href="${escapeHtml(heroPrimary.href)}">${escapeHtml(heroPrimary.label)}</a>
            <a class="surface-hero__cta surface-hero__cta--secondary" href="${escapeHtml(heroSecondary.href)}">${escapeHtml(heroSecondary.label)}</a>
            <a class="surface-hero__cta surface-hero__cta--ghost" href="${escapeHtml(heroTertiary.href)}">${escapeHtml(heroTertiary.label)}</a>
          </div>
        </div>
        <div class="surface-hero__panel">
          ${heroImageUrl
            ? `
              <div class="surface-hero__art">
                <img src="${escapeHtml(heroImageUrl)}" alt="${escapeHtml(heroImageAlt)}">
              </div>
            `
            : `
              <div class="surface-hero__panel-inner">
                <div>
                  <p class="surface-kicker">directory overview</p>
                  <h2>Discover merchants across the directory.</h2>
                  <p>Use the root to pick a category, then browse merchants without losing context.</p>
                </div>
              </div>
            `}
        </div>
      </section>
    `
    : "";

  const categoriesMarkup = sections.has("categories")
    ? `
      <section class="panel surface-panel surface-categories" id="directory">
        <div class="surface-section-heading">
          <div>
            <p class="surface-kicker">directory</p>
            <h2>${escapeHtml(categoriesTitle)}</h2>
          </div>
          <p>${escapeHtml(categoriesBody)}</p>
        </div>
        <div class="surface-category-grid">
          ${categoryMarkup}
        </div>
      </section>
    `
    : "";

  const sectionMarkup = sectionOrder.map((section) => {
    if (section === "hero") {
      return `${heroMarkup}${installMarkup}`;
    }

    if (section === "categories") {
      return categoriesMarkup;
    }

    if (section === "featured") {
      return featuredMarkup;
    }

    if (section === "network") {
      return networkMarkup;
    }

    if (section === "merchant_onboarding") {
      return onboardingMarkup;
    }

    return "";
  }).join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(config.brandName)}: Discover merchants by category</title>
    <meta name="color-scheme" content="dark light">
    <meta name="description" content="${escapeHtml(heroBody)}">
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
      }
      * {
        box-sizing: border-box;
      }
      html {
        scroll-behavior: smooth;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top, var(--bg-top), transparent 30%),
          linear-gradient(180deg, var(--bg-start) 0%, var(--bg-mid) 45%, var(--bg-end) 100%);
        color: var(--ink);
        font-family: "SFMono-Regular", "Menlo", "Monaco", "Consolas", monospace;
        line-height: 1.6;
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
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
      a {
        color: inherit;
      }
      main {
        width: min(1080px, calc(100% - 32px));
        margin: 0 auto;
        padding: 20px 0 64px;
        display: grid;
        gap: 18px;
      }
      .topbar,
      .panel {
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
      .topbar-controls {
        display: flex;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
      }
      .brand {
        color: var(--accent);
        font-size: 0.96rem;
        text-decoration: none;
        white-space: nowrap;
      }
      .nav {
        display: flex;
        gap: 14px;
        flex-wrap: wrap;
      }
      .nav a,
      .surface-quick-links a,
      .surface-onboarding__links a {
        color: var(--ink);
        text-decoration: none;
        transition:
          color 160ms ease,
          border-color 160ms ease,
          transform 160ms ease,
          background 160ms ease;
      }
      .nav a:hover,
      .surface-quick-links a:hover,
      .surface-onboarding__links a:hover {
        color: var(--accent);
      }
      .theme-toggle {
        border: 1px solid var(--line);
        background: var(--panel);
        color: var(--ink);
        padding: 8px 10px;
        font: inherit;
        cursor: pointer;
      }
      .theme-toggle:hover {
        border-color: var(--accent-dim);
      }
      .surface-hero,
      .surface-panel {
        border-radius: 24px;
      }
      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
        gap: 18px;
        padding: 22px 18px;
        align-items: stretch;
      }
      @media (max-width: 860px) {
        .hero {
          grid-template-columns: 1fr;
        }
      }
      .surface-hero__copy {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .surface-hero__copy h1,
      .surface-section-heading h2 {
        margin: 0;
        line-height: 1.04;
        letter-spacing: -0.04em;
      }
      .surface-hero__copy h1 {
        font-size: clamp(34px, 7vw, 70px);
        margin-bottom: 14px;
      }
      .surface-kicker {
        margin: 0;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-size: 12px;
        margin-bottom: 10px;
      }
      .surface-hero__body,
      .surface-section-heading p,
      .surface-onboarding__note {
        margin: 0;
        color: var(--muted);
      }
      .surface-hero__body {
        max-width: 60ch;
      }
      .surface-hero__ctas,
      .surface-quick-links {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }
      .surface-hero__cta,
      .surface-onboarding__cta {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        text-decoration: none;
        border: 1px solid var(--line);
        transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
      }
      .surface-hero__cta:hover,
      .surface-onboarding__cta:hover,
      .surface-category-card:hover,
      .surface-network-card:hover,
      .surface-featured-card:hover {
        transform: translateY(-1px);
      }
      .surface-hero__cta--primary,
      .surface-onboarding__cta {
        color: var(--bg);
        background: var(--accent);
        border-color: var(--accent);
      }
      .surface-hero__cta--primary:hover,
      .surface-onboarding__cta:hover {
        color: var(--bg);
        opacity: 0.94;
      }
      .surface-hero__cta--secondary,
      .surface-hero__cta--ghost {
        background: var(--panel);
      }
      .surface-hero__note {
        margin-top: 18px;
        max-width: 54ch;
        color: var(--muted);
      }
      .surface-quick-links a {
        color: var(--muted);
      }
      .surface-hero__panel {
        padding: 28px;
        background:
          linear-gradient(180deg, var(--hero-card-tint), var(--hero-card-fade)),
          linear-gradient(180deg, var(--surface-overlay-top), var(--surface-overlay-bottom));
      }
      .surface-hero__art {
        border-radius: 18px;
        overflow: hidden;
        background: rgba(255,255,255,0.04);
      }
      .surface-hero__art img {
        width: 100%;
        height: 100%;
        min-height: 320px;
        object-fit: cover;
        display: block;
      }
      .surface-hero__panel-inner {
        display: grid;
        align-content: start;
        gap: 16px;
        padding-right: 6px;
      }
      .surface-hero__panel-inner h2 {
        margin: 0;
        max-width: 14ch;
        font-size: clamp(1.6rem, 2.2vw, 2.35rem);
        line-height: 1.02;
        letter-spacing: -0.045em;
      }
      .surface-flow-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 8px;
      }
      .surface-flow-list li {
        display: flex;
        gap: 10px;
        align-items: baseline;
        color: var(--muted);
      }
      .surface-flow-list strong {
        color: var(--accent-dim);
        min-width: 1.4em;
      }
      .surface-panel {
        padding: 20px;
        min-width: 0;
      }
      .surface-section-heading {
        display: flex;
        gap: 12px;
        justify-content: space-between;
        align-items: end;
        flex-wrap: wrap;
        margin-bottom: 18px;
      }
      .surface-section-heading h2 {
        font-size: clamp(1.4rem, 2vw, 2.2rem);
      }
      .surface-category-grid,
      .surface-network-grid,
      .surface-featured-grid {
        display: grid;
        gap: 12px;
      }
      @media (min-width: 760px) {
        .surface-category-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .surface-network-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .surface-featured-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (min-width: 1080px) {
        .surface-category-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .surface-network-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }
      .surface-category-card,
      .surface-network-card,
      .surface-featured-card {
        color: inherit;
        text-decoration: none;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.02);
      }
      .surface-category-card {
        display: grid;
        gap: 12px 14px;
        padding: 14px;
        align-items: center;
      }
      .surface-category-card__art {
        aspect-ratio: 4 / 3;
        border-radius: 14px;
        overflow: hidden;
        background: rgba(255,255,255,0.04);
      }
      .surface-category-card__art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .surface-category-card__body {
        display: grid;
        gap: 4px;
      }
      .surface-category-card__body strong {
        font-size: 1rem;
      }
      .surface-category-card__eyebrow,
      .surface-category-card__subtitle {
        color: var(--muted);
        font-size: 0.94rem;
      }
      .surface-category-card__eyebrow {
        font-size: 0.8rem;
      }
      .surface-category-card__action {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .surface-category-card__action span:first-child {
        color: var(--muted);
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 3px 8px;
        font-size: 0.8rem;
      }
      .surface-category-card__action span:last-child {
        color: var(--muted);
      }
      .surface-featured-card {
        display: grid;
        gap: 6px;
        padding: 14px 16px;
      }
      .featured-domain,
      .featured-summary,
      .featured-description,
      .featured-offers {
        color: var(--muted);
      }
      .featured-offers {
        color: var(--accent-dim);
      }
      .surface-onboarding {
        display: grid;
        gap: 18px;
      }
      .install-grid {
        display: grid;
        gap: 18px;
      }
      @media (min-width: 920px) {
        .install-grid {
          grid-template-columns: minmax(0, 1fr) minmax(300px, 0.9fr);
        }
      }
      .install-lead h2 {
        margin: 0 0 10px;
        font-size: clamp(1.6rem, 2.2vw, 2.35rem);
        line-height: 1.02;
        letter-spacing: -0.045em;
      }
      .install-copy {
        margin: 0;
        color: var(--muted);
      }
      .install-card {
        min-width: 0;
      }
      .install-card--human {
        display: grid;
        align-items: center;
      }
      .install-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }
      .surface-onboarding__content {
        display: grid;
        gap: 18px;
        padding-top: 4px;
      }
      @media (min-width: 860px) {
        .surface-onboarding__content {
          grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
        }
      }
      .surface-onboarding__lead {
        display: grid;
        align-content: start;
        gap: 14px;
      }
      .surface-onboarding__details {
        display: grid;
        gap: 18px;
      }
      .surface-onboarding__bullets {
        margin: 0;
        padding-left: 20px;
        color: var(--muted);
        display: grid;
        gap: 8px;
      }
      .surface-onboarding__links {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 10px;
      }
      .surface-onboarding__footer {
        display: grid;
        gap: 6px;
      }
      .surface-onboarding__footer p {
        margin: 0;
        color: var(--muted);
      }
      .surface-empty {
        margin: 0;
        color: var(--muted);
      }
      @media (max-width: 640px) {
        .topbar {
          align-items: start;
        }
        .topbar-controls {
          width: 100%;
          justify-content: space-between;
        }
        .nav {
          gap: 10px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header class="topbar">
        <a class="brand" href="#top">[ ${escapeHtml(config.brandName)} ]</a>
        <div class="topbar-controls">
          <nav class="nav" aria-label="Primary">
            <a href="#install">install</a>
            <a href="#directory">directory</a>
            <a href="#register">register</a>
          </nav>
          <button class="theme-toggle" type="button" data-theme-toggle>light mode</button>
        </div>
      </header>
      ${sectionMarkup}
    </main>
    <script>
      (() => {
        const root = document.documentElement;
        const button = document.querySelector("[data-theme-toggle]");
        const copyButton = document.querySelector("[data-copy-install]");
        const installInstruction = document.querySelector("[data-install-instruction]");
        const storageKey = "${escapeHtml(config.deployId)}-theme";
        const savedTheme = localStorage.getItem(storageKey);
        const syncButtonLabel = () => {
          if (!button) {
            return;
          }
          const currentTheme = root.dataset.theme === "light" ? "light" : "dark";
          button.textContent = currentTheme === "light" ? "dark mode" : "light mode";
        };
        if (savedTheme === "light" || savedTheme === "dark") {
          root.dataset.theme = savedTheme;
        }
        syncButtonLabel();
        if (button) {
          button.addEventListener("click", () => {
            const nextTheme = root.dataset.theme === "light" ? "dark" : "light";
            root.dataset.theme = nextTheme;
            localStorage.setItem(storageKey, nextTheme);
            syncButtonLabel();
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

function renderDirectoryCards(categories: CategoryDirectoryEntry[]): string {
  if (categories.length === 0) {
    return `<p class="directory-empty muted">No categories are published yet.</p>`;
  }

  return [...categories]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((category) => {
    return `
      <a class="directory-card" href="${category.skillPath}">
        <span class="directory-emoji">🦞</span>
        <span class="directory-meta">
          <strong>${escapeHtml(category.name)}</strong>
          <span>${escapeHtml(category.summary)}</span>
        </span>
        <span class="directory-domain">${escapeHtml(category.slug)}</span>
        <span class="directory-badge">open skill</span>
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

function renderLegacyLandingPage(
  config: ReturnType<typeof readDeployConfig>,
  origin: string,
  featuredMerchants: FeaturedMerchantSummary[],
  categories: CategoryDirectoryEntry[]
): string {
  const skillUrl = `${origin.replace(/\/$/, "")}/skill.md`;
  const installInstruction = `Read ${skillUrl} and follow the instructions to choose a category before browsing merchants.`;
  const contactEmail = "hello@lobsterstores.com";
  const directoryCards = renderDirectoryCards(categories);
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
        min-width: 0;
        white-space: normal;
        line-height: 1.2;
        text-align: center;
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
        .surface-switcher {
          display: grid;
          width: 100%;
          border-radius: 20px;
        }
        .surface-tab {
          width: 100%;
          padding: 10px 14px;
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
              <li><strong>2.</strong><span>Let the agent read the root skill and choose a category</span></li>
              <li><strong>3.</strong><span>Then the agent can discover merchants through the category-specific skill</span></li>
            </ol>
          </section>
          ${featuredPanel}
          <section class="surface-panel" data-surface-panel="directory" role="tabpanel" hidden>
            <div class="directory-intro">
              <p class="prompt-title">All Lobster Categories</p>
              <p class="muted">Pick a category first, then stay inside that namespace for discovery.</p>
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
