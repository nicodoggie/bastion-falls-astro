import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  expandLintPatterns,
  lintGlobPatterns,
  lintLexiconFile,
  lintLexiconParsed,
  lintGraphEntry,
  loadLexLintConfigFile,
  parseLexLintConfigDocument,
  runFixPipeline,
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

  it("accepts standalone JSON-LD (@context + @graph) lexicons", async () => {
    const r = await lintLexiconFile(fx("graph-minimal.jsonld"));
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toHaveLength(0);
  });

  it("supports SHACL on standalone JSON-LD lexicons", async () => {
    const r = await lintLexiconFile(fx("graph-minimal.jsonld"), {
      shacl: true,
    });
    expect(r.ok).toBe(true);
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
    const shaclDiag = d.find(
      (x) => x.code.startsWith("SHACL_") && x.code !== "SHACL_SETUP_FAILED",
    );
    expect(shaclDiag).toBeDefined();
    expect(shaclDiag?.message).toMatch(/sense|ontolex|constraint|path|focus/i);
  });

  it("includes graphEntry line/column for file-backed diagnostics", async () => {
    const r = await lintLexiconFile(fx("broken-no-sense.json"), {
      shacl: true,
    });
    expect(r.ok).toBe(false);
    const violation = r.diagnostics.find(
      (x) => x.code.startsWith("SHACL_") && x.code !== "SHACL_SETUP_FAILED",
    );
    expect(violation?.line).toBeGreaterThan(0);
    expect(violation?.column).toBeGreaterThan(0);
    expect(violation?.file).toBeDefined();
  });

  it("lintGlobPatterns accepts a file path", async () => {
    const r = await lintGlobPatterns([fx("minimal.json")]);
    expect(r.ok).toBe(true);
  });

  it("reports duplicate @id in @graph lexicons", async () => {
    const r = await lintLexiconFile(fx("duplicate-id-graph.jsonld"));
    expect(r.ok).toBe(false);
    const dups = r.diagnostics.filter((x) => x.code === "DUPLICATE_JSON_LD_ID");
    expect(dups.length).toBeGreaterThanOrEqual(2);
    expect(dups.every((x) => x.ruleId === "duplicate-jsonld-id")).toBe(true);
  });

  it("respects duplicate-jsonld-id off", async () => {
    const r = await lintLexiconFile(fx("duplicate-id-graph.jsonld"), {
      ruleSettings: { "duplicate-jsonld-id": "off" },
    });
    expect(r.ok).toBe(true);
    expect(
      r.diagnostics.some((x) => x.code === "DUPLICATE_JSON_LD_ID"),
    ).toBe(false);
  });

  it("maps duplicate-jsonld-id warn to warning severity", async () => {
    const r = await lintLexiconFile(fx("duplicate-id-graph.jsonld"), {
      ruleSettings: { "duplicate-jsonld-id": "warn" },
    });
    expect(r.ok).toBe(true);
    const w = r.diagnostics.filter((x) => x.code === "DUPLICATE_JSON_LD_ID");
    expect(w.length).toBeGreaterThan(0);
    expect(w.every((x) => x.severity === "warning")).toBe(true);
  });

  it("reports duplicate graphEntry @id in wrapper lexicons", async () => {
    const r = await lintLexiconFile(fx("duplicate-id-wrapper.json"));
    expect(r.ok).toBe(false);
    expect(
      r.diagnostics.some(
        (x) =>
          x.code === "DUPLICATE_JSON_LD_ID" && x.entryKey === "ehk:b",
      ),
    ).toBe(true);
  });

  it("rejects unknown config keys", () => {
    expect(() =>
      parseLexLintConfigDocument(`{"unknown": true}`),
    ).toThrow(/Unknown config key/);
  });

  it("rejects unknown rule ids in config", () => {
    expect(() =>
      parseLexLintConfigDocument(
        JSON.stringify({
          rules: { "not-a-real-rule": "off" },
        }),
      ),
    ).toThrow(/Unknown rule id/);
  });

  it("expandLintPatterns respects exclude", () => {
    const pattern = join(__dirname, "fixtures", "*.json");
    const all = expandLintPatterns([pattern], []);
    expect(all.some((p) => p.endsWith("minimal.json"))).toBe(true);
    const filtered = expandLintPatterns([pattern], ["**/minimal.json"]);
    expect(filtered.some((p) => p.endsWith("minimal.json"))).toBe(false);
  });

  it("loads config fixture fields", () => {
    const cfg = loadLexLintConfigFile(fx("lex-lint.config.fixture.json"));
    expect(cfg.files.include).toContain("test/fixtures/minimal.json");
    expect(cfg.rules["duplicate-jsonld-id"]).toBe("error");
  });

  it("merges duplicate @graph nodes on fix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lex-lint-fix-"));
    const target = join(dir, "dup.jsonld");
    await copyFile(fx("duplicate-id-graph.jsonld"), target);
    const before = JSON.parse(await readFile(target, "utf8")) as {
      "@graph": unknown[];
    };
    expect(before["@graph"].length).toBe(2);

    const report = await runFixPipeline([target], { dryRun: false });
    expect(report.ok).toBe(true);
    const after = JSON.parse(await readFile(target, "utf8")) as {
      "@graph": Array<{ sense?: unknown[] }>;
    };
    expect(after["@graph"].length).toBe(1);
    const senses = after["@graph"][0]?.sense;
    expect(Array.isArray(senses) ? senses.length : 0).toBe(2);

    await rm(dir, { recursive: true });
  });

  it("aborts fix when canonicalForm conflicts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lex-lint-fix2-"));
    const target = join(dir, "x.jsonld");
    await copyFile(fx("duplicate-id-graph-conflict.jsonld"), target);
    const report = await runFixPipeline([target], { dryRun: false });
    expect(report.ok).toBe(false);
    expect(report.diagnostics.some((x) => x.code === "FIX_SKIPPED_CONFLICT")).toBe(
      true,
    );
    const doc = JSON.parse(await readFile(target, "utf8")) as {
      "@graph": unknown[];
    };
    expect(doc["@graph"].length).toBe(2);
    await rm(dir, { recursive: true });
  });

  it("lintLexiconParsed matches lintLexiconFile for minimal.json", async () => {
    const raw = await readFile(fx("minimal.json"), "utf8");
    const doc = JSON.parse(raw) as unknown;
    const a = await lintLexiconParsed(doc, raw, fx("minimal.json"));
    const b = await lintLexiconFile(fx("minimal.json"));
    expect(a.ok).toBe(b.ok);
    expect(a.diagnostics.length).toBe(b.diagnostics.length);
  });
});
