import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { loadDeployPackage } from "../src/deploy-package";
import { buildDeploySql } from "../src/sql";

async function main() {
  const deployDir = process.argv[2];
  const thirdArg = process.argv[3];
  const fourthArg = process.argv[4];

  let importedAt = "2026-03-15T00:00:00Z";
  let outputPath: string | undefined;

  if (thirdArg?.endsWith(".sql")) {
    outputPath = thirdArg;
    importedAt = fourthArg ?? importedAt;
  } else {
    importedAt = thirdArg ?? importedAt;
    outputPath = fourthArg;
  }

  if (!deployDir) {
    throw new Error("Usage: npm run build:deploy:sql -- <deploy-dir> [imported-at] [output.sql]");
  }

  const deployPackage = await loadDeployPackage(deployDir, (path) => readFile(path, "utf8"), importedAt);
  const sql = buildDeploySql(deployPackage);

  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, sql, "utf8");
    return;
  }

  process.stdout.write(sql);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
