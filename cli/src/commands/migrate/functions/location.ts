import {
  LocationSchema as LegacyLocationSchema,
  type Location as LegacyLocation,
} from '@bastion-falls/types/legacy';
import { LocationSchema, type Location } from '@bastion-falls/types';
import type { MigrateMapFunction } from '@/types/MigrateMapFunction';

// Helper function to infer location type from tags
function inferLocationTypeFromTags(tags: string[]): string {
  // Define valid location types from the schema
  const validTypes = LocationSchema.shape.type.options;

  // Special mappings for compound tags or variations
  const tagMappings: { [key: string]: string } = {
    'port city': 'port',
    'port town': 'port',
    'fishing port': 'port',
    'trading port': 'port',
    'mountain range': 'mountain',
  };

  // Check for direct matches first
  for (const tag of tags) {
    const lowerTag = tag.toLowerCase().trim();

    // Check special mappings
    if (tagMappings[lowerTag]) {
      return tagMappings[lowerTag];
    }

    // Check direct enum matches
    if (validTypes.includes(lowerTag as any)) {
      return lowerTag;
    }
  }

  // Default fallback
  return 'city';
}

const migrateLocation: MigrateMapFunction<
  'location',
  LegacyLocation,
  Location
> = async (input) => {
  const legacy = LegacyLocationSchema.parse(input);
  const { title, tags, extraMetadata } = legacy;
  const { location } = extraMetadata ?? {};
  const { details } = location ?? {};

  // Infer type from tags
  const type = inferLocationTypeFromTags(tags || []);

  return {
    title,
    tags,
    location: {
      name: title,
      type,
      details: {
        population: details?.population,
        area: details?.area,
      },
      // The legacy schema had a 'notable' field that doesn't exist in the new schema
      // It could potentially be mapped to a section or description
    },
  };
};

export default migrateLocation; 