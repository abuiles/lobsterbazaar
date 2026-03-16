import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ArtifactStore } from "../src/storage";
import type { CountryArtifact, MerchantArtifact, OffersArtifact } from "../src/domain";
import { loadDeployPackage } from "../src/deploy-package";
import { importDeployPackage, materializeDeployPackage } from "../src/import-deploy";
import { MemoryRepositories } from "../src/memory";

class FilesystemArtifactStore implements ArtifactStore {
  private readonly outputRoot: string;

  constructor(outputDir: string) {
    this.outputRoot = path.resolve(outputDir);
  }

  async getCountry(): Promise<CountryArtifact | null> {
    return null;
  }

  async putCountry(artifact: CountryArtifact): Promise<void> {
    await this.writeJson(["countries", `${artifact.countryCode}.json`], artifact);
  }

  async getOffers(): Promise<OffersArtifact | null> {
    return null;
  }

  async putOffers(artifact: OffersArtifact): Promise<void> {
    await this.writeJson(["offers", `${artifact.countryCode}.json`], artifact);
  }

  async getMerchant(): Promise<MerchantArtifact | null> {
    return null;
  }

  async putMerchant(artifact: MerchantArtifact): Promise<void> {
    await this.writeJson(["merchants", `${artifact.slug}.json`], artifact);
  }

  async getSkill(): Promise<string | null> {
    return null;
  }

  async putSkill(skill: string): Promise<void> {
    await this.writeText(["skill.md"], skill);
  }

  private async writeJson(parts: string[], value: unknown): Promise<void> {
    const filePath = this.resolveFilePath(parts);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
  }

  private async writeText(parts: string[], value: string): Promise<void> {
    const filePath = this.resolveFilePath(parts);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, value, "utf8");
  }

  private resolveFilePath(parts: string[]): string {
    const filePath = path.resolve(this.outputRoot, ...parts);
    const relative = path.relative(this.outputRoot, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Refusing to write artifact outside output directory: ${filePath}`);
    }

    return filePath;
  }
}

async function replaceOutputDirectory(stagingDir: string, outputDir: string): Promise<void> {
  const backupDir = `${outputDir}.bak-${Date.now()}`;

  try {
    await rename(outputDir, backupDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  try {
    await rename(stagingDir, outputDir);
  } catch (error) {
    try {
      await rename(backupDir, outputDir);
    } catch {
      // Ignore restore errors; surface the original failure below.
    }

    throw error;
  }

  await rm(backupDir, { recursive: true, force: true });
}

async function main() {
  const deployDir = process.argv[2];
  const outputDir = process.argv[3];
  const importedAt = process.argv[4] ?? "2026-03-15T00:00:00Z";

  if (!deployDir || !outputDir) {
    throw new Error("Usage: npm run build:deploy:artifacts -- <deploy-dir> <output-dir> [imported-at]");
  }

  const deployPackage = await loadDeployPackage(deployDir, (file) => readFile(file, "utf8"), importedAt);
  const repositories = new MemoryRepositories();
  const resolvedOutputDir = path.resolve(outputDir);
  await mkdir(path.dirname(resolvedOutputDir), { recursive: true });

  const stagingDir = await mkdtemp(
    path.join(path.dirname(resolvedOutputDir), `${path.basename(resolvedOutputDir)}.tmp-`)
  );

  try {
    const artifacts = new FilesystemArtifactStore(stagingDir);
    await importDeployPackage(repositories, deployPackage);
    await materializeDeployPackage(repositories, artifacts, deployPackage, importedAt);
    await replaceOutputDirectory(stagingDir, resolvedOutputDir);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
