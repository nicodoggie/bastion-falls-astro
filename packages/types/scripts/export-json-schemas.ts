/**
 * Exports each @bastion-falls/types Zod schema to a JSON Schema file using
 * Zod v4's built-in `.toJSONSchema()` instance method.
 *
 * Output: <repo-root>/.vscode/schemas/types/<SchemaName>.json
 *
 * Usage:  tsx scripts/export-json-schemas.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CharacterSchema,
  ConceptSchema,
  EventSchema,
  FamilySchema,
  ItemSchema,
  LocationSchema,
  OrganizationSchema,
  SpeciesSchema,
  VehicleSchema,
} from '../src/index.js';

// Zod v4 attaches toJSONSchema() to every schema instance but the type is
// not yet re-exported from the package's public index.d.ts.
type SchemaWithJsonExport = {
  toJSONSchema(params?: { target?: string }): unknown;
  omit(keys: Record<string, true>): SchemaWithJsonExport;
};

const cast = (s: unknown) => s as SchemaWithJsonExport;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../../../.vscode/schemas/types');
mkdirSync(OUT, { recursive: true });

// Mirror the omit() calls used in astro/src/content.config.ts so the JSON
// schema matches exactly what the collection validates.
const schemas: Record<string, SchemaWithJsonExport> = {
  character: cast(CharacterSchema).omit({ name: true }),
  concept: cast(ConceptSchema),
  event: cast(EventSchema),
  family: cast(FamilySchema),
  item: cast(ItemSchema),
  location: cast(LocationSchema),
  organization: cast(OrganizationSchema),
  species: cast(SpeciesSchema).omit({ name: true }),
  vehicle: cast(VehicleSchema).omit({ name: true }),
};

for (const [name, schema] of Object.entries(schemas)) {
  const json = schema.toJSONSchema({ target: 'draft-07' });
  const outPath = resolve(OUT, `${name}.json`);
  writeFileSync(outPath, JSON.stringify(json, null, 2));
  console.log(`✓  types/${name}.json`);
}

console.log(`\nDone — ${Object.keys(schemas).length} schemas written to .vscode/schemas/types/`);
