import type { CountryArtifact, MerchantArtifact, OffersArtifact } from "./domain";
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

  async getCountry(countryCode: string): Promise<CountryArtifact | null> {
    return readJson<CountryArtifact>(this.bucket, `countries/${countryCode}.json`);
  }

  async putCountry(artifact: CountryArtifact): Promise<void> {
    await writeJson(this.bucket, `countries/${artifact.countryCode}.json`, artifact);
  }

  async getOffers(countryCode: string): Promise<OffersArtifact | null> {
    return readJson<OffersArtifact>(this.bucket, `offers/${countryCode}.json`);
  }

  async putOffers(artifact: OffersArtifact): Promise<void> {
    await writeJson(this.bucket, `offers/${artifact.countryCode}.json`, artifact);
  }

  async getMerchant(slug: string): Promise<MerchantArtifact | null> {
    return readJson<MerchantArtifact>(this.bucket, `merchants/${slug}.json`);
  }

  async putMerchant(artifact: MerchantArtifact): Promise<void> {
    await writeJson(this.bucket, `merchants/${artifact.slug}.json`, artifact);
  }

  async getSkill(): Promise<string | null> {
    const object = await this.bucket.get("skill.md");
    if (!object) {
      return null;
    }

    return object.text();
  }

  async putSkill(skill: string): Promise<void> {
    await this.bucket.put("skill.md", skill, {
      httpMetadata: {
        contentType: "text/markdown; charset=utf-8"
      }
    });
  }
}

