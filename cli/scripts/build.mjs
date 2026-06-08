import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { watch as watchFiles } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

const rootDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const distDir = join(rootDir, "dist");
const templateSourceDir = join(rootDir, "templates");
const templateOutputDir = join(distDir, "templates");
const watchMode = process.argv.includes("--watch");

const dependencyNames = [
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.peerDependencies ?? {}),
  ...Object.keys(packageJson.optionalDependencies ?? {}),
];

const external = dependencyNames.flatMap((name) => [name, `${name}/*`]);

async function copyTemplates() {
  const entries = await readdir(templateSourceDir, { withFileTypes: true });

  await rm(templateOutputDir, { recursive: true, force: true });
  await mkdir(templateOutputDir, { recursive: true });

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ejs"))
      .map((entry) =>
        cp(join(templateSourceDir, entry.name), join(templateOutputDir, entry.name)),
      ),
  );
}

const copyTemplatesPlugin = {
  name: "copy-cli-templates",
  setup(esbuild) {
    esbuild.onEnd(async (result) => {
      if (result.errors.length > 0) {
        return;
      }

      await copyTemplates();
    });
  },
};

const buildOptions = {
  entryPoints: ["src/bin/cli.ts", "src/bin/bash-complete.ts"],
  bundle: true,
  chunkNames: "chunks/[name]-[hash]",
  entryNames: "[name]",
  external,
  format: "esm",
  logLevel: "info",
  minify: false,
  outdir: "dist",
  platform: "node",
  plugins: [copyTemplatesPlugin],
  splitting: true,
  target: "esnext",
  tsconfig: "src/tsconfig.json",
};

await rm(distDir, { recursive: true, force: true });

if (watchMode) {
  const buildContext = await context(buildOptions);
  await buildContext.watch();

  watchFiles(templateSourceDir, { persistent: true }, async () => {
    try {
      await copyTemplates();
    } catch (error) {
      console.error(error);
    }
  });

  console.log("Watching CLI sources and templates...");
} else {
  await build(buildOptions);
}
