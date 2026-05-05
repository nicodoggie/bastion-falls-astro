import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { AstroIntegration } from "astro";
import { glob } from "glob";

import { generateLexiconSite } from "./generate-site.js";
import { writeStarlightLexiconMdxPages } from "./starlight-mdx.js";

export interface LexiconIntegrationInput {
  /** Stable id (e.g. early-hick). */
  localeId: string;
  /** Human title for manifest. */
  title: string;
  /**
   * Glob of lexicon shard files, relative to the Astro project root
   * (e.g. `src/assets/languages/hickic/seneran/early-hick/lexicon/*.jsonld`).
   */
  lexiconGlob: string;
  /**
   * Output directory relative to Astro project root
   * (e.g. `src/generated/lexicon/early-hick`).
   */
  outputDir: string;
  pageSize?: number;
  /**
   * When set, writes Starlight MDX paginations under this docs path (must be
   * under `src/content/docs/...`) so routes use the normal Starlight chrome.
   */
  starlightMdx?: {
    contentLexiconDirRelative: string;
  };
}

function isLexiconShardPath(pathname: string): boolean {
  const n = pathname.replace(/\\/g, "/");
  return n.includes("/lexicon/") && n.endsWith(".jsonld");
}

function starlightLexiconMdxNeedsWrite(
  astroRoot: string,
  contentLexiconDirRelative: string,
): boolean {
  const alpha1 = path.join(
    astroRoot,
    contentLexiconDirRelative,
    "alpha",
    "1.mdx",
  );
  return !existsSync(alpha1);
}

function relativeLexiconShards(
  astroRoot: string,
  shardPaths: readonly string[],
): string[] {
  const root = path.resolve(astroRoot);
  return [...shardPaths]
    .map((p) => path.relative(root, path.resolve(p)).replace(/\\/g, "/"))
    .sort((a, b) => a.localeCompare(b, "en"));
}

function lexiconRunNoiseKey(options: {
  skipped: boolean;
  relativeShards: readonly string[];
  outputDir: string;
  entryCount: number;
  alphaPageCount: number;
  byFieldPageCount: number;
}): string {
  return JSON.stringify({
    skipped: options.skipped,
    shards: options.relativeShards,
    outputDir: options.outputDir,
    entryCount: options.entryCount,
    alphaPageCount: options.alphaPageCount,
    byFieldPageCount: options.byFieldPageCount,
  });
}

const lastLexiconIntegrationNoiseKeyByLocale = new Map<
  string,
  string
>();
const lastLexiconShardInventoryKeyByLocale = new Map<
  string,
  string
>();

export function lexiconIntegration(
  options: LexiconIntegrationInput,
): AstroIntegration {
  const pageSize = options.pageSize ?? 80;
  let astroRoot = process.cwd();
  let shardRegenTimer: ReturnType<typeof setTimeout> | undefined;

  const run = async (logger: { info: (m: string) => void }) => {
    const shardPaths = await glob(options.lexiconGlob, {
      cwd: astroRoot,
      absolute: true,
      nodir: true,
    });
    const shardRel = relativeLexiconShards(astroRoot, shardPaths);

    if (shardPaths.length === 0) {
      logger.info(
        `lexicon-integration: [${options.localeId}] glob ${JSON.stringify(options.lexiconGlob)} matched 0 files under ${astroRoot}`,
      );
    }

    const outDir = path.join(astroRoot, options.outputDir);
    mkdirSync(outDir, { recursive: true });

    const { manifest, skipped } = generateLexiconSite({
      astroRoot,
      shardPaths,
      outputDirRelative: options.outputDir,
      localeId: options.localeId,
      title: options.title,
      pageSize,
      starlightContentLexiconDirRelative: options.starlightMdx?.contentLexiconDirRelative,
    });
    const starlightDir = options.starlightMdx?.contentLexiconDirRelative;
    let starlightMdxFilesWritten = 0;
    let mustWriteStarlightMdx = false;
    if (starlightDir) {
      mustWriteStarlightMdx =
        !skipped || starlightLexiconMdxNeedsWrite(astroRoot, starlightDir);
      if (mustWriteStarlightMdx) {
        const { filesWritten } = writeStarlightLexiconMdxPages({
          astroRoot,
          manifest,
          contentLexiconDirRelative: starlightDir,
        });
        starlightMdxFilesWritten = filesWritten;
      }
    }

    const noiseKey = lexiconRunNoiseKey({
      skipped,
      relativeShards: shardRel,
      outputDir: options.outputDir,
      entryCount: manifest.alpha.entryCount,
      alphaPageCount: manifest.alpha.pageCount,
      byFieldPageCount: manifest.byField.pageCount,
    });
    const shouldLogOutcome =
      noiseKey !==
      lastLexiconIntegrationNoiseKeyByLocale.get(options.localeId);
    lastLexiconIntegrationNoiseKeyByLocale.set(
      options.localeId,
      noiseKey,
    );

    const inventoryKey = shardRel.join("\0");
    const shouldLogInventory =
      inventoryKey !==
      lastLexiconShardInventoryKeyByLocale.get(options.localeId);
    if (shouldLogInventory) {
      lastLexiconShardInventoryKeyByLocale.set(
        options.localeId,
        inventoryKey,
      );
    }

    if (!(shouldLogOutcome || shouldLogInventory)) {
      return;
    }

    if (shouldLogInventory) {
      const shardLines =
        shardRel.length === 0
          ? "  (none — check lexiconGlob and cwd)"
          : shardRel.map((r) => `  • ${r}`).join("\n");

      logger.info(
        `lexicon-integration: [${options.localeId}] ${options.lexiconGlob} → ` +
          `${shardRel.length} JSON-LD shard(s):\n${shardLines}`,
      );
    }

    if (shouldLogOutcome) {
      if (skipped) {
        const mdxNote = starlightDir
          ? !mustWriteStarlightMdx
            ? "left Starlight MDX unchanged"
            : starlightMdxFilesWritten > 0
              ? `wrote ${String(starlightMdxFilesWritten)} Starlight MDX page(s)`
              : "Starlight MDX on disk already matched (no writes)"
          : "no Starlight MDX dir configured";
        logger.info(
          `lexicon-integration: [${options.localeId}] fingerprint unchanged — ` +
            `skipped JSON-LD compile; ${mdxNote}; ` +
            `${manifest.alpha.entryCount} entries → ${options.outputDir}`,
        );
      } else {
        logger.info(
          `lexicon-integration: [${options.localeId}] compiled ` +
            `${manifest.alpha.entryCount} entries → ` +
            `${manifest.alpha.pageCount} alpha + ` +
            `${manifest.byField.pageCount} by-field chunk pages → ` +
            `${options.outputDir}`,
        );
      }
    }
  };

  return {
    name: "lexicon-integration",
    hooks: {
      "astro:config:setup": ({ config }) => {
        astroRoot = fileURLToPath(config.root);
      },
      /**
       * Emit Starlight MDX and JSON chunks **before** Astro’s content sync runs.
       * `astro:build:start` is too late: in production, `syncInternal` (which
       * indexes Starlight docs) already ran during `setup()` before `build()`.
       * `astro:config:done` runs before both dev and build content sync.
       */
      "astro:config:done": async ({ config, logger }) => {
        astroRoot = fileURLToPath(config.root);
        await run(logger);
      },
      /**
       * Do not use `astro:route:setup` for lexicon work: Astro invokes it once
       * per route while building the dev module graph, which would re-run
       * generation hundreds of times and block startup.
       */
      "astro:server:setup": async ({ server, logger }) => {
        const scheduleShardRegen = () => {
          if (shardRegenTimer !== undefined) {
            clearTimeout(shardRegenTimer);
          }
          shardRegenTimer = setTimeout(() => {
            shardRegenTimer = undefined;
            void run(logger);
          }, 200);
        };

        const regen = (pathname: string) => {
          if (!isLexiconShardPath(pathname)) return;
          scheduleShardRegen();
        };

        server.watcher.on("add", regen);
        server.watcher.on("change", regen);
        server.watcher.on("unlink", regen);
      },
    },
  };
}
