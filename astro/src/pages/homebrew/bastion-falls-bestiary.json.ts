/**
 * Static API endpoint — Bastion Falls homebrew bestiary for 5e.tools.
 *
 * Reads every *.creature.{json,yaml,yml} file in src/content/docs/world,
 * validates each against CreatureDataSchema, and returns a single JSON file in the
 * 5e.tools homebrew format.
 *
 * Served at:  /homebrew/bastion-falls-bestiary.json
 * Load on 5e.tools via: Tools → Homebrew Manager → Import from URL
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CreatureDataSchema } from "@bastion-falls/5e-schema-zod";
import type { APIRoute } from "astro";
import { readContentDataFile } from "@/lib/5etools/content-data-file";

const SOURCE_JSON = "BastionFalls";
const SOURCE_VERSION = "1.0.0";
const WORLD_CONTENT_DIR = fileURLToPath(
  new URL("../../content/docs/world", import.meta.url),
);

function findCreatureDataFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findCreatureDataFiles(abs));
    } else if (/\.creature\.(json|ya?ml)$/i.test(entry.name)) {
      files.push(abs);
    }
  }
  return files.sort();
}

function getCreatureRows(raw: unknown): unknown[] {
  if (!raw || typeof raw !== "object") return [raw];
  const monster = (raw as { monster?: unknown }).monster;
  if (!Array.isArray(monster)) return [raw];
  return monster;
}

export const GET: APIRoute = () => {
  const monsters = [];
  const errors: string[] = [];

  for (const filePath of findCreatureDataFiles(WORLD_CONTENT_DIR)) {
    const relativePath = path.relative(WORLD_CONTENT_DIR, filePath);
    let raw: unknown;
    try {
      raw = readContentDataFile(filePath);
    } catch (error) {
      errors.push(`${relativePath}: ${String(error)}`);
      continue;
    }

    for (const row of getCreatureRows(raw)) {
      // Inject the source key so 5e.tools can associate the entry with our _meta.
      const creature =
        typeof row === "object" && row !== null
          ? { source: SOURCE_JSON, ...(row as object) }
          : row;
      const result = CreatureDataSchema.safeParse(creature);
      if (result.success) {
        monsters.push(result.data);
      } else {
        errors.push(`${relativePath}: ${result.error.message}`);
      }
    }
  }

  if (errors.length) {
    console.warn(
      `[bestiary] Skipped ${errors.length} invalid creature file(s):\n${errors.join("\n")}`,
    );
  }

  const now = Math.floor(Date.now() / 1000);

  const homebrew = {
    _meta: {
      sources: [
        {
          json: SOURCE_JSON,
          abbreviation: "BF",
          full: "Bastion Falls",
          version: SOURCE_VERSION,
          url: "https://bastion-falls.thekennel.info",
          authors: ["nicodoggie"],
        },
      ],
      dateAdded: now,
      dateLastModified: now,
      edition: "classic",
    },
    monster: monsters,
  };

  return new Response(JSON.stringify(homebrew, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
};
