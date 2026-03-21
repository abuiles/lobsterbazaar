import type { CategoriesArtifact, CountryArtifact, MerchantArtifact, OffersArtifact } from "./domain";
import type { ArtifactStore } from "./storage";

async function readJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const object = await bucket.get(key);
  if (!object) {
    return null;
  }

  return (await object.json()) as T;
}

async function writeJson(bucket: R2Bucket, key: string, value: unknown): Promise<void> {
  await bucket.put(key, JSON.stringify(value, null, 2), {
    httpMetadata: {
      contentType: "application/json; charset=utf-8"
    }
  });
}

export class R2ArtifactStore implements ArtifactStore {
  constructor(private readonly bucket: R2Bucket) {}

  async getCategories(): Promise<CategoriesArtifact | null> {
    return readJson<CategoriesArtifact>(this.bucket, "categories/index.json");
  }

  async putCategories(artifact: CategoriesArtifact): Promise<void> {
    await writeJson(this.bucket, "categories/index.json", artifact);
  }

  async getCategoryCountry(categorySlug: string, countryCode: string): Promise<CountryArtifact | null> {
    return readJson<CountryArtifact>(this.bucket, `${categorySlug}/countries/${countryCode}.json`);
  }

  async putCategoryCountry(categorySlug: string, artifact: CountryArtifact): Promise<void> {
    await writeJson(this.bucket, `${categorySlug}/countries/${artifact.countryCode}.json`, artifact);
  }

  async getCategoryOffers(categorySlug: string, countryCode: string): Promise<OffersArtifact | null> {
    return readJson<OffersArtifact>(this.bucket, `${categorySlug}/offers/${countryCode}.json`);
  }

  async putCategoryOffers(categorySlug: string, artifact: OffersArtifact): Promise<void> {
    await writeJson(this.bucket, `${categorySlug}/offers/${artifact.countryCode}.json`, artifact);
  }

  async getCategoryMerchant(categorySlug: string, slug: string): Promise<MerchantArtifact | null> {
    return readJson<MerchantArtifact>(this.bucket, `${categorySlug}/merchants/${slug}.json`);
  }

  async putCategoryMerchant(categorySlug: string, artifact: MerchantArtifact): Promise<void> {
    await writeJson(this.bucket, `${categorySlug}/merchants/${artifact.slug}.json`, artifact);
  }

  async getRootSkill(): Promise<string | null> {
    const object = await this.bucket.get("skill.md");
    if (!object) {
      return null;
    }

    return object.text();
  }

  async putRootSkill(skill: string): Promise<void> {
    await this.bucket.put("skill.md", skill, {
      httpMetadata: {
        contentType: "text/markdown; charset=utf-8"
      }
    });
  }

  async getCategorySkill(categorySlug: string): Promise<string | null> {
    const object = await this.bucket.get(`${categorySlug}/skill.md`);
    if (!object) {
      return null;
    }

    return object.text();
  }

  async putCategorySkill(categorySlug: string, skill: string): Promise<void> {
    await this.bucket.put(`${categorySlug}/skill.md`, skill, {
      httpMetadata: {
        contentType: "text/markdown; charset=utf-8"
      }
    });
  }
}
