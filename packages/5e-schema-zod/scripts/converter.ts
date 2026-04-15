import { resolve, dirname } from 'node:path'

// ─── Types ────────────────────────────────────────────────────────────────────

export type JsonSchema = Record<string, unknown> | boolean

interface DefInfo {
  /** Absolute path of the file that owns this def */
  filePath: string
  /** The Zod variable name emitted in that file */
  varName: string
  /** The output module name (e.g. "shared", "creature") */
  outputModule: string
}

export interface ConversionContext {
  /** Absolute path of the file currently being converted */
  currentFile: string
  /** Output module of the file currently being converted */
  currentModule: string
  /**
   * Global registry of all $defs across all loaded schema files.
   * Key: "<absoluteFilePath>#<defName>"
   */
  defRegistry: Map<string, DefInfo>
  /**
   * Set of def keys currently mid-conversion; used for cycle detection.
   * Key format same as defRegistry.
   */
  inProgress: Set<string>
  /**
   * Imports to emit at the top of the current output file.
   * Key: module name, Value: set of var names.
   */
  imports: Map<string, Set<string>>
  /**
   * Set to true when a `z.lazy()` is emitted for a self-referential schema.
   * Signals that the generated const needs an explicit `: z.ZodType`
   * annotation to satisfy TypeScript's no-implicit-any rule.
   */
  hasCircularRef: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a $defs key to a PascalCase Zod variable name */
export function defToVarName(key: string): string {
  // Strip leading underscores, then PascalCase
  const stripped = key.replace(/^_+/, '')
  const pascal = stripped
    .replace(/[-_\s]+(.)/g, (_, c: string) => (c as string).toUpperCase())
    .replace(/^(.)/, (_, c: string) => (c as string).toUpperCase())
  return `${pascal}Schema`
}

/** Resolve a $ref string to { filePath, defName } */
function resolveRef(
  ref: string,
  currentFile: string,
): { filePath: string; defName: string | null } {
  if (ref.startsWith('#')) {
    // Same-file: "#/$defs/foo"
    const parts = ref.slice(2).split('/')
    const defName = parts[parts.length - 1] ?? null
    return { filePath: currentFile, defName }
  }

  const [filePart = '', fragPart = ''] = ref.split('#')
  const filePath = resolve(dirname(currentFile), filePart)
  const parts = fragPart ? fragPart.slice(2).split('/') : []
  const defName = parts[parts.length - 1] ?? null
  return { filePath, defName }
}

// ─── Core converter ──────────────────────────────────────────────────────────

/**
 * Convert a single JSON Schema node to a Zod code string.
 * Returns a TypeScript expression like `z.string()` or
 * `z.object({ name: z.string() })`.
 */
export function convertNode(
  schema: JsonSchema,
  ctx: ConversionContext,
): string {
  if (typeof schema === 'boolean') {
    return schema ? 'z.unknown()' : 'z.never()'
  }

  // $ref takes priority
  if (schema['$ref'] !== undefined) {
    return convertRef(schema['$ref'] as string, ctx)
  }

  // const
  if ('const' in schema) {
    return `z.literal(${JSON.stringify(schema['const'])})`
  }

  // enum
  if (Array.isArray(schema['enum'])) {
    return convertEnum(schema['enum'] as unknown[])
  }

  // oneOf / anyOf
  if (Array.isArray(schema['oneOf'])) {
    return convertUnion(schema['oneOf'] as JsonSchema[], ctx)
  }
  if (Array.isArray(schema['anyOf'])) {
    return convertUnion(schema['anyOf'] as JsonSchema[], ctx)
  }

  // allOf — treat as intersection / merge
  if (Array.isArray(schema['allOf'])) {
    return convertAllOf(schema['allOf'] as JsonSchema[], ctx)
  }

  // type array e.g. ["string", "null"]
  if (Array.isArray(schema['type'])) {
    const variants = (schema['type'] as string[]).map((t) =>
      convertPrimitive(t),
    )
    return wrapUnion(variants)
  }

  switch (schema['type']) {
    case 'string':
      return convertString(schema)
    case 'integer':
      return convertInteger(schema)
    case 'number':
      return convertNumber(schema)
    case 'boolean':
      return 'z.boolean()'
    case 'null':
      return 'z.null()'
    case 'array':
      return convertArray(schema, ctx)
    case 'object':
      return convertObject(schema, ctx)
    default:
      // No explicit type — infer from shape
      if (schema['properties'] !== undefined || schema['additionalProperties'] !== undefined) {
        return convertObject(schema, ctx)
      }
      return 'z.unknown()'
  }
}

// ─── $ref ─────────────────────────────────────────────────────────────────────

function convertRef(ref: string, ctx: ConversionContext): string {
  const { filePath, defName } = resolveRef(ref, ctx.currentFile)

  if (!defName) return 'z.unknown()'

  const registryKey = `${filePath}#${defName}`
  const defInfo = ctx.defRegistry.get(registryKey)

  if (!defInfo) {
    // Unknown ref — emit a comment so it's visible in generated output
    return `z.unknown() /* unresolved $ref: ${ref} */`
  }

  // Circular reference — use z.lazy()
  if (ctx.inProgress.has(registryKey)) {
    if (defInfo.outputModule !== ctx.currentModule) {
      recordImport(ctx, defInfo.outputModule, defInfo.varName)
    }
    ctx.hasCircularRef = true
    return `z.lazy(() => ${defInfo.varName})`
  }

  // Cross-file ref — record import
  if (defInfo.outputModule !== ctx.currentModule) {
    recordImport(ctx, defInfo.outputModule, defInfo.varName)
  }

  return defInfo.varName
}

function recordImport(
  ctx: ConversionContext,
  fromModule: string,
  varName: string,
) {
  let set = ctx.imports.get(fromModule)
  if (!set) {
    set = new Set()
    ctx.imports.set(fromModule, set)
  }
  set.add(varName)
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function convertPrimitive(type: string): string {
  switch (type) {
    case 'string':
      return 'z.string()'
    case 'integer':
      return 'z.number().int()'
    case 'number':
      return 'z.number()'
    case 'boolean':
      return 'z.boolean()'
    case 'null':
      return 'z.null()'
    default:
      return 'z.unknown()'
  }
}

function convertString(schema: Record<string, unknown>): string {
  let code = 'z.string()'
  if (typeof schema['minLength'] === 'number')
    code += `.min(${schema['minLength']})`
  if (typeof schema['maxLength'] === 'number')
    code += `.max(${schema['maxLength']})`
  if (typeof schema['pattern'] === 'string') {
    // Escape forward slashes so the pattern is valid inside a JS regex literal
    const escaped = schema['pattern'].replace(/\//g, '\\/')
    code += `.regex(/${escaped}/)`
  }
  if (typeof schema['description'] === 'string')
    code += `.describe(${JSON.stringify(schema['description'])})`
  return code
}

function convertInteger(schema: Record<string, unknown>): string {
  let code = 'z.number().int()'
  if (typeof schema['minimum'] === 'number') code += `.min(${schema['minimum']})`
  if (typeof schema['maximum'] === 'number') code += `.max(${schema['maximum']})`
  return code
}

function convertNumber(schema: Record<string, unknown>): string {
  let code = 'z.number()'
  if (typeof schema['minimum'] === 'number') code += `.min(${schema['minimum']})`
  if (typeof schema['maximum'] === 'number') code += `.max(${schema['maximum']})`
  return code
}

// ─── Enum ─────────────────────────────────────────────────────────────────────

function convertEnum(values: unknown[]): string {
  const allStrings = values.every((v) => typeof v === 'string')
  if (allStrings) {
    const items = (values as string[]).map((v) => JSON.stringify(v)).join(', ')
    return `z.enum([${items}])`
  }
  // Mixed types — union of literals
  const literals = values.map((v) => `z.literal(${JSON.stringify(v)})`)
  return wrapUnion(literals)
}

// ─── Union / allOf ────────────────────────────────────────────────────────────

function convertUnion(schemas: JsonSchema[], ctx: ConversionContext): string {
  const variants = schemas.map((s) => convertNode(s, ctx))
  return wrapUnion(variants)
}

function wrapUnion(variants: string[]): string {
  const unique = [...new Set(variants)]
  if (unique.length === 0) return 'z.never()'
  if (unique.length === 1) return unique[0]!
  return `z.union([${unique.join(', ')}])`
}

function convertAllOf(schemas: JsonSchema[], ctx: ConversionContext): string {
  if (schemas.length === 0) return 'z.unknown()'
  if (schemas.length === 1) return convertNode(schemas[0]!, ctx)

  const [first, ...rest] = schemas as [JsonSchema, ...JsonSchema[]]
  const parts = rest.map((s) => convertNode(s, ctx))
  return `${convertNode(first, ctx)}.and(${parts.join(').and(')})`
}

// ─── Array ────────────────────────────────────────────────────────────────────

function convertArray(
  schema: Record<string, unknown>,
  ctx: ConversionContext,
): string {
  let itemsCode = 'z.unknown()'

  if (schema['items'] !== undefined) {
    if (Array.isArray(schema['items'])) {
      // Tuple-style items array — convert as union of item types
      itemsCode = convertUnion(schema['items'] as JsonSchema[], ctx)
    } else {
      itemsCode = convertNode(schema['items'] as JsonSchema, ctx)
    }
  }

  let code = `z.array(${itemsCode})`
  if (typeof schema['minItems'] === 'number') code += `.min(${schema['minItems']})`
  if (typeof schema['maxItems'] === 'number') code += `.max(${schema['maxItems']})`
  return code
}

// ─── Object ───────────────────────────────────────────────────────────────────

function convertObject(
  schema: Record<string, unknown>,
  ctx: ConversionContext,
): string {
  const properties = schema['properties'] as
    | Record<string, JsonSchema>
    | undefined
  const required = new Set(
    Array.isArray(schema['required'])
      ? (schema['required'] as string[])
      : [],
  )

  if (!properties || Object.keys(properties).length === 0) {
    // No properties defined
    if (schema['additionalProperties'] === false) {
      return 'z.object({})'
    }
    if (
      schema['additionalProperties'] !== undefined &&
      typeof schema['additionalProperties'] !== 'boolean'
    ) {
      const valSchema = convertNode(
        schema['additionalProperties'] as JsonSchema,
        ctx,
      )
      return `z.record(z.string(), ${valSchema})`
    }
    return 'z.record(z.string(), z.unknown())'
  }

  const fields = Object.entries(properties).map(([key, propSchema]) => {
    const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)
      ? key
      : JSON.stringify(key)
    let valueCode = convertNode(propSchema, ctx)
    if (!required.has(key)) valueCode += '.optional()'
    return `  ${safeKey}: ${valueCode}`
  })

  return `z.object({\n${fields.join(',\n')}\n})`
}

// ─── Top-level def converter ──────────────────────────────────────────────────

/**
 * Convert a named $def to a `export const FooSchema = ...` statement.
 * Marks the def as in-progress in `ctx.inProgress` to detect cycles.
 */
export function convertDef(
  defName: string,
  defSchema: JsonSchema,
  ctx: ConversionContext,
): string {
  const varName = defToVarName(defName)
  const registryKey = `${ctx.currentFile}#${defName}`

  ctx.inProgress.add(registryKey)
  const body = convertNode(defSchema, ctx)
  ctx.inProgress.delete(registryKey)

  // Circular schemas need an explicit type annotation so TypeScript doesn't
  // complain about implicit `any` from the self-referential initializer.
  const annotation = ctx.hasCircularRef ? ': z.ZodType' : ''
  ctx.hasCircularRef = false

  const typeName = varName.replace(/Schema$/, '')
  const typeExport = `export type ${typeName} = z.infer<typeof ${varName}>`
  return [
    `export const ${varName}${annotation} = ${body}`,
    typeExport,
  ].join('\n')
}
