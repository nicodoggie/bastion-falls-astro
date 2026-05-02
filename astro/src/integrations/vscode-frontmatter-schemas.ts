/**
 * Astro integration: generate VS Code YAML IntelliSense schemas.
 *
 * Fires on every `astro dev` / `astro build` and writes:
 *   <repo-root>/.vscode/schemas/frontmatter/<collection>.json
 *
 * Each file is a complete frontmatter JSON Schema — Starlight's standard
 * fields (title, description, …) merged with the collection-specific
 * extension produced by calling .toJSONSchema() on the Zod schema exported
 * from collection-schemas.ts.
 *
 * The redhat.vscode-yaml extension reads these via the yaml.schemas entries
 * in .vscode/settings.json to provide autocomplete and validation while
 * editing MDX frontmatter.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AstroIntegration } from "astro";

import { collectionExtensions } from "../collection-schemas.js";

// Zod v4 exposes .toJSONSchema() on every schema instance but has not yet
// re-exported it from the package's public index.d.ts.
type JsonSchema = Record<string, unknown>;
type ZodWithJson = { toJSONSchema(params?: { target?: string }): JsonSchema };
const json = (s: unknown, target = "draft-07") =>
  (s as ZodWithJson).toJSONSchema({ target });

// Starlight fields present on every docs page — merged into every wrapper.
const STARLIGHT_BASE: JsonSchema = {
  title: { type: "string", description: "Page title (required by Starlight)" },
  description: { type: "string" },
  tags: { type: "array", items: { type: "string" } },
  draft: { type: "boolean" },
  sidebar: { type: "object" },
};

export function vscodeFrontmatterSchemas(): AstroIntegration {
  return {
    name: "vscode-frontmatter-schemas",
    hooks: {
      "astro:config:setup": ({ config, logger }) => {
        // config.root is the astro/ sub-directory; go up one to reach repo root.
        const repoRoot = resolve(fileURLToPath(config.root), "..");
        const fmDir = resolve(repoRoot, ".vscode/schemas/frontmatter");
        mkdirSync(fmDir, { recursive: true });

        for (const [name, { schema }] of Object.entries(collectionExtensions)) {
          // Serialise the Zod extension schema to JSON Schema draft-07.
          const extensionJson = json(schema);

          // Merge Starlight base fields with the collection-specific ones.
          const extensionProps =
            (extensionJson.properties as JsonSchema | undefined) ?? {};

          const frontmatterSchema: JsonSchema = {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: `${name} page frontmatter`,
            type: "object",
            properties: { ...STARLIGHT_BASE, ...extensionProps },
            // draft-07 serialiser uses "definitions"; newer drafts use "$defs".
            // Carry over whichever key was emitted so that internal $refs resolve.
            ...(extensionJson.$defs ? { $defs: extensionJson.$defs } : {}),
            ...(extensionJson.definitions
              ? { definitions: extensionJson.definitions }
              : {}),
          };

          writeFileSync(
            resolve(fmDir, `${name}.json`),
            JSON.stringify(frontmatterSchema, null, 2),
          );
        }

        logger.info(
          `Generated .vscode/schemas/frontmatter/ (${Object.keys(collectionExtensions).length} collections)`,
        );
      },
    },
  };
}
