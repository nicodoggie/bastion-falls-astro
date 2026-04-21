import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AstroIntegration } from 'astro';

import { generateTimelineMDX, getTimelineEntries } from '../lib/timeline';

const SOURCE_DIR_SEGMENTS = [
  'src/content/docs/world/events/',
  'src/content/docs/world/characters/',
  'src/content/docs/world/organizations/',
  'src/content/docs/world/locations/',
] as const;

function isTimelineSourcePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return SOURCE_DIR_SEGMENTS.some((segment) => normalized.includes(segment)) && normalized.endsWith('.mdx');
}

export function timelineGenerator(): AstroIntegration {
  let astroRoot = process.cwd();

  const generateTimeline = async (logger: { info: (message: string) => void }) => {
    const outputDir = resolve(astroRoot, 'src/content/docs/world/timeline');
    const outputFile = resolve(outputDir, 'timeline-generated.mdx');

    const entries = await getTimelineEntries();
    const mdx = generateTimelineMDX(entries);

    mkdirSync(outputDir, { recursive: true });

    const existing = existsSync(outputFile) ? readFileSync(outputFile, 'utf-8') : null;
    if (existing === mdx) return;

    writeFileSync(outputFile, mdx);
    logger.info(`Generated timeline file with ${entries.length} entries`);
  };

  return {
    name: 'timeline-generator',
    hooks: {
      'astro:config:setup': ({ config }) => {
        astroRoot = fileURLToPath(config.root);
      },
      'astro:build:start': async ({ logger }) => {
        await generateTimeline(logger);
      },
      'astro:server:setup': async ({ server, logger }) => {
        await generateTimeline(logger);

        server.watcher.on('add', async (path) => {
          if (!isTimelineSourcePath(path)) return;
          await generateTimeline(logger);
        });

        server.watcher.on('change', async (path) => {
          if (!isTimelineSourcePath(path)) return;
          await generateTimeline(logger);
        });

        server.watcher.on('unlink', async (path) => {
          if (!isTimelineSourcePath(path)) return;
          await generateTimeline(logger);
        });
      },
    },
  };
}
