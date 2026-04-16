/**
 * Code generator: reads 5etools JSON Schema files from node_modules and emits
 * Zod 4 TypeScript files into src/generated/.
 *
 * Run with:  tsx scripts/generate.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  type JsonSchema,
  type ConversionContext,
  convertNode,
  convertDef,
  defToVarName,
} from './converter.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(__dirname, '..')
const OUT_DIR = resolve(PKG_ROOT, 'src/generated')

const req = createRequire(import.meta.url)

// ─── Schema loading ───────────────────────────────────────────────────────────

function resolveSchemaPath(relPath: string): string {
  return req.resolve(`5etools-utils/schema/${relPath}`)
}

function loadSchema(relPath: string): JsonSchema {
  const fullPath = resolveSchemaPath(relPath)
  return JSON.parse(readFileSync(fullPath, 'utf-8')) as JsonSchema
}

// ─── Target definitions ───────────────────────────────────────────────────────

/**
 * Each target describes one output file.
 * `defs` lists which $def keys to include (empty = all $defs in the file).
 */
const TARGETS = [
  {
    schemaPath: 'brew/util.json',
    module: 'shared',
    defs: [
      'size',
      'alignment',
      'creatureType',
      'dataDamageType',
      'speed',
      '_speedVal',
      'abilityScoreAbbreviation',
      'source',
      '_sourceString',
      'sourceJson',
      'page',
      'damageImmunityArray',
      'damageResistArray',
      'damageVulnerabilityArray',
      'conditionImmunityArray',
      'alias',
      'group',
      'cr',
      'rarity',
      'srd',
      'skillProficiencies',
      'languageProficiencies',
      'savingThrowProficiencies',
      'sensesArray',
    ],
  },
  {
    schemaPath: 'brew/entry.json',
    module: 'entry',
    defs: [
      'entry',
      'entrySection',
      'entryEntries',
      'entryList',
      'entryTable',
      'entryTableRow',
      'entryTableCell',
      'entryDice',
      'entryBonus',
      'entryAbilityDc',
      'entryAbilityAttackMod',
      'entryLink',
      'mediaHref',
      'mediaHrefInternal',
      'mediaHrefExternal',
    ],
  },
  {
    schemaPath: 'brew/bestiary/bestiary.json',
    module: 'creature',
    defs: [
      'align',
      'acItem',
      'abilityScore',
      '_legendaryActions',
      'creatureData',
      'creature',
    ],
  },
  {
    schemaPath: 'brew/spells/spells.json',
    module: 'spell',
    defs: ['scalingLevelDiceItem', 'spellData', 'spell'],
  },
  {
    schemaPath: 'brew/items.json',
    module: 'item',
    defs: ['itemData', 'itemGroup', 'item'],
  },
  {
    schemaPath: 'brew/races.json',
    module: 'race',
    defs: [
      'sharedData',
      'subraceData',
      'raceData',
      'traitTag',
      'heightAndWeight',
      'lineage',
      'age',
      'race',
      'subrace',
    ],
  },
  {
    schemaPath: 'brew/vehicles.json',
    module: 'vehicle',
    defs: [
      'vehicleTerrain',
      'vehicleShipData',
      'vehicleSpelljammerData',
      'vehicleElementalAirshipData',
      'vehicleInfernalWarMachineData',
      'vehicleCreatureData',
      'vehicleObjectData',
    ],
  },
] as const

// ─── Topological sort ────────────────────────────────────────────────────────

/**
 * Walk a schema value and collect all same-file $ref def names
 * (i.e. refs of the form "#/$defs/<name>").
 */
function collectSameFileRefs(schema: unknown): Set<string> {
  const refs = new Set<string>()
  if (Array.isArray(schema)) {
    for (const item of schema) {
      for (const r of collectSameFileRefs(item)) refs.add(r)
    }
    return refs
  }
  if (typeof schema !== 'object' || schema === null) return refs
  const obj = schema as Record<string, unknown>
  if (typeof obj['$ref'] === 'string' && obj['$ref'].startsWith('#/$defs/')) {
    refs.add((obj['$ref'] as string).slice('#/$defs/'.length))
  }
  for (const value of Object.values(obj)) {
    for (const r of collectSameFileRefs(value)) refs.add(r)
  }
  return refs
}

/**
 * Topologically sort def names so that each def appears after its same-file
 * dependencies. Cycles are detected and appended at the end (the converter
 * handles them at runtime via the `inProgress` set / z.lazy()).
 */
function toposortDefs(
  defNames: string[],
  defs: Record<string, JsonSchema>,
): string[] {
  const nameSet = new Set(defNames)

  // direct deps (intra-module only)
  const deps = new Map<string, Set<string>>()
  for (const name of defNames) {
    const schema = defs[name]
    if (schema === undefined) {
      deps.set(name, new Set())
      continue
    }
    const all = collectSameFileRefs(schema)
    deps.set(name, new Set([...all].filter((d) => nameSet.has(d) && d !== name)))
  }

  // Kahn's algorithm
  const inDegree = new Map<string, number>(defNames.map((n) => [n, 0]))
  // reverse map: dep -> set of dependents
  const revGraph = new Map<string, Set<string>>(defNames.map((n) => [n, new Set()]))

  for (const [name, directDeps] of deps) {
    for (const dep of directDeps) {
      revGraph.get(dep)!.add(name)
      inDegree.set(name, (inDegree.get(name) ?? 0) + 1)
    }
  }

  const queue = defNames.filter((n) => (inDegree.get(n) ?? 0) === 0)
  const result: string[] = []

  while (queue.length > 0) {
    const node = queue.shift()!
    result.push(node)
    for (const dependent of revGraph.get(node) ?? []) {
      const newDeg = (inDegree.get(dependent) ?? 1) - 1
      inDegree.set(dependent, newDeg)
      if (newDeg === 0) queue.push(dependent)
    }
  }

  // Anything still with inDegree > 0 is part of a cycle — append as-is
  for (const name of defNames) {
    if (!result.includes(name)) result.push(name)
  }

  return result
}

// ─── Registry build ───────────────────────────────────────────────────────────

type DefRegistry = Map<string, { filePath: string; varName: string; outputModule: string }>

function buildDefRegistry(
  targets: typeof TARGETS,
): { registry: DefRegistry; schemas: Map<string, JsonSchema> } {
  const registry: DefRegistry = new Map()
  const schemas = new Map<string, JsonSchema>()

  for (const target of targets) {
    const filePath = resolveSchemaPath(target.schemaPath)
    const schema = loadSchema(target.schemaPath)
    schemas.set(filePath, schema)

    const defs =
      typeof schema === 'object' && schema !== null
        ? ((schema as Record<string, unknown>)['$defs'] as
            | Record<string, unknown>
            | undefined)
        : undefined

    if (!defs) continue

    const defsToInclude =
      target.defs.length > 0
        ? new Set(target.defs as readonly string[])
        : new Set(Object.keys(defs))

    for (const defName of defsToInclude) {
      if (!(defName in defs)) continue
      const key = `${filePath}#${defName}`
      registry.set(key, {
        filePath,
        varName: defToVarName(defName),
        outputModule: target.module,
      })
    }
  }

  return { registry, schemas }
}

// ─── File generation ──────────────────────────────────────────────────────────

function generateModule(
  target: (typeof TARGETS)[number],
  registry: DefRegistry,
  schemas: Map<string, JsonSchema>,
): string {
  const filePath = resolveSchemaPath(target.schemaPath)
  const schema = schemas.get(filePath)!
  const defs =
    typeof schema === 'object' && schema !== null
      ? ((schema as Record<string, unknown>)['$defs'] as
          | Record<string, JsonSchema>
          | undefined)
      : undefined

  if (!defs) {
    return `import { z } from 'zod'\n\n// No $defs found in ${target.schemaPath}\n`
  }

  const rawDefsToInclude: string[] =
    target.defs.length > 0
      ? (target.defs as readonly string[]).filter((d) => d in defs)
      : Object.keys(defs)

  // Sort defs in dependency order to avoid forward-reference errors
  const defsToInclude = toposortDefs(rawDefsToInclude, defs)

  // Each def gets its own context so imports accumulate per-def, then we
  // merge them all into one set for the file header.
  const fileImports = new Map<string, Set<string>>()
  const blocks: string[] = []

  for (const defName of defsToInclude) {
    const defSchema = defs[defName]
    if (defSchema === undefined) continue

    const ctx: ConversionContext = {
      currentFile: filePath,
      currentModule: target.module,
      defRegistry: registry,
      inProgress: new Set(),
      imports: new Map(),
      hasCircularRef: false,
    }

    const block = convertDef(defName, defSchema, ctx)
    blocks.push(block)

    // Merge imports into file-level map
    for (const [mod, names] of ctx.imports) {
      let set = fileImports.get(mod)
      if (!set) {
        set = new Set()
        fileImports.set(mod, set)
      }
      for (const n of names) set.add(n)
    }
  }

  // Build import statements
  const importLines: string[] = [`import { z } from 'zod'`]
  for (const [mod, names] of fileImports) {
    if (mod === target.module) continue
    const sorted = [...names].sort()
    importLines.push(`import { ${sorted.join(', ')} } from './${mod}.js'`)
  }

  const header = `/**
 * Generated from 5etools-utils/schema/${target.schemaPath}
 * DO NOT EDIT — run \`yarn generate\` to regenerate.
 */`

  return [header, importLines.join('\n'), '', blocks.join('\n\n'), ''].join(
    '\n',
  )
}

// ─── Entry point ──────────────────────────────────────────────────────────────

function main() {
  console.log('Building $def registry…')
  const { registry, schemas } = buildDefRegistry(TARGETS)
  console.log(`  ${registry.size} defs registered across ${TARGETS.length} files`)

  mkdirSync(OUT_DIR, { recursive: true })

  for (const target of TARGETS) {
    console.log(`Generating ${target.module}.ts from ${target.schemaPath}…`)
    const content = generateModule(target, registry, schemas)
    const outPath = resolve(OUT_DIR, `${target.module}.ts`)
    writeFileSync(outPath, content, 'utf-8')
    console.log(`  → wrote ${outPath}`)
  }

  console.log('\nDone.')
}

main()
