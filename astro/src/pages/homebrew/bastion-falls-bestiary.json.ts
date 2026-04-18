/**
 * Static API endpoint — Bastion Falls homebrew bestiary for 5e.tools.
 *
 * Globs every *.creature.json file in src/content/ at build time, validates
 * each against CreatureDataSchema, and returns a single JSON file in the
 * 5e.tools homebrew format.
 *
 * Served at:  /homebrew/bastion-falls-bestiary.json
 * Load on 5e.tools via: Tools → Homebrew Manager → Import from URL
 */
import type { APIRoute } from 'astro'
import { CreatureDataSchema } from '@bastion-falls/5e-schema-zod'

// Vite resolves this glob relative to this file at build time.
// Each module's `.default` is the parsed JSON object.
const creatureModules = import.meta.glob<{ default: unknown }>(
  '../../content/**/*.creature.json',
  { eager: true },
)

export const GET: APIRoute = () => {
  const monsters = []
  const errors: string[] = []

  for (const [filePath, mod] of Object.entries(creatureModules)) {
    const result = CreatureDataSchema.safeParse(mod.default)
    if (result.success) {
      monsters.push(result.data)
    } else {
      errors.push(`${filePath}: ${result.error.message}`)
    }
  }

  if (errors.length) {
    console.warn(
      `[bestiary] Skipped ${errors.length} invalid creature file(s):\n${errors.join('\n')}`,
    )
  }

  const now = Math.floor(Date.now() / 1000)

  const homebrew = {
    _meta: {
      sources: [
        {
          json: 'BastionFalls',
          abbreviation: 'BF',
          full: 'Bastion Falls',
          url: 'https://bastion-falls.thekennel.info',
          authors: ['nicodoggie'],
          convertedBy: [],
        },
      ],
      dateAdded: now,
      dateLastModified: now,
    },
    monster: monsters,
  }

  return new Response(JSON.stringify(homebrew, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  })
}
