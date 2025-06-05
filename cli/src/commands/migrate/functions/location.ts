import {
  LocationSchema as LegacyLocationSchema,
  type Location as LegacyLocation,
} from '@bastion-falls/types/legacy';
import type { Location } from '@bastion-falls/types';
import type { MigrateMapFunction } from '@/types/MigrateMapFunction';

const migrateLocation: MigrateMapFunction<
  'location',
  LegacyLocation,
  Location
> = async (input) => {
  const legacy = LegacyLocationSchema.parse(input);
  const { title, tags, extraMetadata } = legacy;
  const { location } = extraMetadata ?? {};
  const { details } = location ?? {};

  return {
    title,
    tags,
    location: {
      name: title,
      type: 'city', // Default type, may need to be inferred from tags or content
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