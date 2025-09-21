import { z } from 'zod';

const LocationDistrictSchema = z.object({
  name: z.string(),
  area: z.string().optional(),
  population: z.string().optional(),
});

export const LocationDetailsSchema = z.object({
  // Basic information
  population: z.string().nullable().optional(),
  area: z.string().nullable().optional(),
  notable: z.string().nullable().optional(),
  total_population: z.string().nullable().optional(),
  total_area: z.string().nullable().optional(),
  elevation: z.string().nullable().optional(),
  climate: z.string().nullable().optional(),

  // Political information
  motto: z.string().nullable().optional(),
  anthem: z.string().nullable().optional(),
  capital: z.string().nullable().optional(),
  government: z.string().nullable().optional(),
  government_structure: z.record(z.string(), z.string()).nullable().optional(),
  currency: z.string().nullable().optional(),

  // References to other content
  religions: z.array(z.string()).nullable().optional(),
  states: z.array(z.string()).nullable().optional(),
  languages: z.array(z.string()).nullable().optional(),
  ethnicities: z.array(z.string()).nullable().optional(),

  // Districts and subdivisions
  districts: z.array(LocationDistrictSchema).nullable().optional(),

  // Special fields for specific locations
  keelswood_area: z.string().nullable().optional(),
  prison_complex_area: z.string().nullable().optional(),
  naval_command_area: z.string().nullable().optional(),
  residential_area: z.string().nullable().optional(),
  infrastructure_area: z.string().nullable().optional(),
}).transform((data) => {
  // Convert null values to undefined
  const cleaned: any = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== null) {
      cleaned[key] = value;
    }
  }
  return cleaned;
});

const LocationFlagSchema = z.object({
  url: z.string().optional(),
});

const LocationMapSchema = z.object({
  url: z.string().optional(),
});

export const LocationMetadataSchema = z.object({
  details: LocationDetailsSchema.optional(),
  flag: LocationFlagSchema.optional(),
  map: LocationMapSchema.optional(),
});

export const LocationSchema = z.object({
  title: z.string(),
  tags: z.array(z.string()).optional(),
  extraMetadata: z.object({
    location: LocationMetadataSchema.optional(),
  }).optional(),
});

export type Location = z.infer<typeof LocationSchema>;
