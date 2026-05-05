import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  lintGlobPatterns,
  lintGraphEntry,
  lintLexiconFile,
} from "../src/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name: string): string => join(__dirname, "fixtures", name);

type LexEntry = { graphEntry: Record<string, unknown> };

describe("lex-lint", () => {
  it("passes merged JSON-LD expand for minimal fixture", async () => {
    const r = await lintLexiconFile(fx("minimal.json"));
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toHaveLength(0);
  });

  it("flags bare graphEntry without lex-lint context merge", async () => {
    const doc = JSON.parse(await readFile(fx("minimal.json"), "utf8")) as {
      lexicon: Record<string, LexEntry>;
    };
    const graphEntry = doc.lexicon["ehk:-en"].graphEntry;

    const d = await lintGraphEntry("ehk:-en", graphEntry, {
      mergeContext: false,
      baseIri: "https://example.org/test/",
    });

    expect(d.some((x) => x.code === "MISSING_MERGED_CONTEXT")).toBe(true);
  });

  it("reports SHACL violations when sense is missing", async () => {
    const doc = JSON.parse(
      await readFile(fx("broken-no-sense.json"), "utf8"),
    ) as { lexicon: Record<string, LexEntry> };

    const d = await lintGraphEntry("ehk:x", doc.lexicon["ehk:x"].graphEntry, {
      baseIri: "https://example.org/b/",
      shacl: true,
      mergeContext: true,
    });

    expect(d.filter((x) => x.code === "SHACL_SETUP_FAILED")).toHaveLength(0);
    expect(d.some((x) => x.code === "SHACL_VIOLATION")).toBe(true);
  });

  it("includes graphEntry line/column for file-backed diagnostics", async () => {
    const r = await lintLexiconFile(fx("broken-no-sense.json"), {
      shacl: true,
    });
    expect(r.ok).toBe(false);
    const violation = r.diagnostics.find((x) => x.code === "SHACL_VIOLATION");
    expect(violation?.line).toBeGreaterThan(0);
    expect(violation?.column).toBeGreaterThan(0);
    expect(violation?.file).toBeDefined();
  });

  it("lintGlobPatterns accepts a file path", async () => {
    const r = await lintGlobPatterns([fx("minimal.json")]);
    expect(r.ok).toBe(true);
  });
});
