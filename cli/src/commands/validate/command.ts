import { buildCommand } from '@stricli/core';
import type { LocalContext } from "@/context.js";
import { glob } from "tinyglobby";
import { remark } from 'remark';
import remarkMdx from "remark-mdx";
import remarkFrontmatter from "remark-frontmatter";
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { visit } from 'unist-util-visit';
import type { Root } from 'mdast';
import yaml from 'js-yaml';
import { z } from 'zod';

// Import the schemas from the types package
import {
  CharacterSchema,
  EventSchema,
  FamilySchema,
  LocationSchema,
  OrganizationSchema,
  SpeciesSchema
} from '@bastion-falls/types';

// Define the collection schemas based on content.config.ts
const collectionSchemas = {
  character: CharacterSchema,
  family: FamilySchema,
  location: LocationSchema.omit({ name: true }), // Location schema omits name in content config
  organization: OrganizationSchema,
  species: SpeciesSchema,
  event: EventSchema,
};

// Blog schema (defined locally in Astro)
const blogSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  date: z.string(),
  image: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

// Docs schema (extends starlight schema with optional character, event, location, organization)
const docsSchema = z.object({
  character: CharacterSchema.partial().optional(),
  event: EventSchema.partial().optional(),
  location: LocationSchema.partial().optional(),
  organization: OrganizationSchema.partial().optional(),
});

interface ValidationResult {
  file: string;
  collection: string;
  errors: string[];
  warnings: string[];
}

function extractFrontmatter(tree: Root): Record<string, any> {
  let frontmatter: Record<string, any> = {};

  visit(tree, (node) => {
    if (node.type === 'yaml') {
      frontmatter = yaml.load(node.value) as Record<string, any>;
    }
  });

  return frontmatter;
}

function getRequiredFields(schema: z.ZodSchema): string[] {
  const requiredFields: string[] = [];

  function traverseSchema(schema: z.ZodSchema, path: string = ''): void {
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape;
      for (const [key, value] of Object.entries(shape)) {
        const currentPath = path ? `${path}.${key}` : key;

        if (value instanceof z.ZodOptional || value instanceof z.ZodDefault) {
          // Optional field, skip
          continue;
        } else if (value instanceof z.ZodObject) {
          traverseSchema(value, currentPath);
        } else {
          requiredFields.push(currentPath);
        }
      }
    } else if (schema instanceof z.ZodDiscriminatedUnion) {
      // For discriminated unions, we need to check each option
      for (const option of schema.options) {
        traverseSchema(option, path);
      }
    } else if (schema instanceof z.ZodUnion) {
      // For unions, check all options
      for (const option of schema.options) {
        traverseSchema(option, path);
      }
    }
  }

  traverseSchema(schema);
  return requiredFields;
}

function checkMissingFields(frontmatter: Record<string, any>, requiredFields: string[]): string[] {
  const missing: string[] = [];

  for (const field of requiredFields) {
    const value = getNestedValue(frontmatter, field);
    if (value === undefined || value === null || value === '') {
      missing.push(field);
    }
  }

  return missing;
}

function getNestedValue(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : undefined;
  }, obj);
}

function determineCollection(filePath: string): string {
  if (filePath.includes('/characters/')) return 'character';
  if (filePath.includes('/families/')) return 'family';
  if (filePath.includes('/locations/')) return 'location';
  if (filePath.includes('/organizations/')) return 'organization';
  if (filePath.includes('/species/')) return 'species';
  if (filePath.includes('/events/')) return 'event';
  if (filePath.includes('/blog/')) return 'blog';
  return 'docs';
}

async function validateFile(filePath: string, collection: string): Promise<ValidationResult> {
  const file = await readFile(filePath, 'utf-8');
  const tree = await remark()
    .use(remarkFrontmatter)
    .use(remarkMdx)
    .parse(file);

  const frontmatter = extractFrontmatter(tree);
  const errors: string[] = [];
  const warnings: string[] = [];

  // Get the appropriate schema
  let schema: z.ZodSchema;
  if (collection === 'blog') {
    schema = blogSchema;
  } else if (collection === 'docs') {
    schema = docsSchema;
  } else {
    schema = collectionSchemas[collection as keyof typeof collectionSchemas];
  }

  if (!schema) {
    warnings.push(`No schema defined for collection: ${collection}`);
    return { file: filePath, collection, errors, warnings };
  }

  // Validate the frontmatter against the schema
  try {
    schema.parse(frontmatter);
  } catch (error) {
    if (error instanceof z.ZodError) {
      for (const issue of error.issues) {
        errors.push(`${issue.path.join('.')}: ${issue.message}`);
      }
    } else {
      errors.push(`Validation error: ${error}`);
    }
  }

  // Check for missing required fields
  const requiredFields = getRequiredFields(schema);
  const missingFields = checkMissingFields(frontmatter, requiredFields);

  for (const field of missingFields) {
    errors.push(`Missing required field: ${field}`);
  }

  return { file: filePath, collection, errors, warnings };
}

interface ValidateCommandFlags {
  errorsOnly?: boolean;
}

export const validateCommand = buildCommand({
  async func(this: LocalContext, flags: ValidateCommandFlags, directoryArg?: string) {
    const cwd = this.currentPath;
    const searchPattern = directoryArg || "**/*.mdx";
    const errorsOnly = Boolean(flags.errorsOnly);

    if (!errorsOnly) {
      console.log(`🔍 Scanning for MDX files with pattern: ${searchPattern}`);
    }

    const files = await glob(searchPattern, { cwd });
    const results: ValidationResult[] = [];

    if (!errorsOnly) {
      console.log(`📁 Found ${files.length} files to validate\n`);
    }

    for (const file of files) {
      const filePath = resolve(cwd, file);
      const collection = determineCollection(file);

      try {
        const result = await validateFile(filePath, collection);
        results.push(result);

        if (result.errors.length > 0 || result.warnings.length > 0) {
          if (errorsOnly) {
            console.log(file);
          } else {
            console.log(`❌ ${file} (${collection})`);
            for (const error of result.errors) {
              console.log(`   Error: ${error}`);
            }
            for (const warning of result.warnings) {
              console.log(`   Warning: ${warning}`);
            }
            console.log();
          }
        } else if (!errorsOnly) {
          console.log(`✅ ${file} (${collection})`);
        }
      } catch (error) {
        if (errorsOnly) {
          console.log(file);
        } else {
          console.log(`💥 ${file} - Failed to process: ${error}`);
        }
        results.push({
          file,
          collection,
          errors: [`Processing error: ${error}`],
          warnings: []
        });
      }
    }

    // Summary
    const filesWithErrors = results.filter(r => r.errors.length > 0);
    const filesWithWarnings = results.filter(r => r.warnings.length > 0);
    const validFiles = results.filter(r => r.errors.length === 0 && r.warnings.length === 0);

    if (!errorsOnly) {
      console.log('\n📊 Summary:');
      console.log(`   ✅ Valid files: ${validFiles.length}`);
      console.log(`   ⚠️  Files with warnings: ${filesWithWarnings.length}`);
      console.log(`   ❌ Files with errors: ${filesWithErrors.length}`);
      console.log(`   📁 Total files processed: ${results.length}`);

      if (filesWithErrors.length > 0) {
        console.log('\n❌ Files with errors:');
        for (const result of filesWithErrors) {
          console.log(`   ${result.file} (${result.collection})`);
          for (const error of result.errors) {
            console.log(`     - ${error}`);
          }
        }
      }

      if (filesWithWarnings.length > 0) {
        console.log('\n⚠️  Files with warnings:');
        for (const result of filesWithWarnings) {
          console.log(`   ${result.file} (${result.collection})`);
          for (const warning of result.warnings) {
            console.log(`     - ${warning}`);
          }
        }
      }
    }

    // Exit with error code if there are validation errors
    if (filesWithErrors.length > 0) {
      process.exit(1);
    }
  },
  parameters: {
    flags: {
      errorsOnly: {
        brief: "List only file names with validation errors (useful for scripting)",
        kind: "boolean",
        optional: true,
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          parse: String,
          brief: "Directory or glob pattern to scan (default: **/*.mdx)",
          optional: true,
        },
      ]
    }
  },
  docs: {
    brief: "Validate content collection files against their required frontmatter schemas",
  }
});
