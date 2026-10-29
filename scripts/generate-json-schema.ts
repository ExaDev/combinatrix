/* Writes schemas/combinatrix.schema.json from the Zod schemas in ./json-schema.ts. Run by `pnpm build`, and so by `prepublishOnly`, after the package version is final: the schema's `$id` carries it. The schemas directory is a build artefact, gitignored and shipped through package.json's `files` and `exports`. A failure crashes the script with a non-zero exit. */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildJsonSchema, PACKAGE_VERSION } from "./json-schema";

const schemasDirectory = join(import.meta.dirname, "..", "schemas");
const outputPath = join(schemasDirectory, "combinatrix.schema.json");

mkdirSync(schemasDirectory, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(buildJsonSchema(PACKAGE_VERSION), null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath}`);
