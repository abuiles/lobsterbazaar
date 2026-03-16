import { readFile } from "node:fs/promises";

import { loadDeployPackage } from "../src/deploy-package";
import { buildDeploySql } from "../src/sql";

async function main() {
  const deployDir = process.argv[2];
  const importedAt = process.argv[3] ?? "2026-03-15T00:00:00Z";

  if (!deployDir) {
    throw new Error("Usage: npm run build:deploy:sql -- <deploy-dir> [imported-at]");
  }

  const deployPackage = await loadDeployPackage(deployDir, (path) => readFile(path, "utf8"), importedAt);
  process.stdout.write(buildDeploySql(deployPackage));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

