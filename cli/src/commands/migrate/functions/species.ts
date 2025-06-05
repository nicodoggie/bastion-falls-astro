import { 
  SpeciesSchema as LegacySpeciesSchema, 
  type Species as LegacySpecies } 
from '@bastion-falls/types/legacy';
import { SpeciesSchema, type Species } from '@bastion-falls/types';
import type { MigrateMapFunction } from '@/types/MigrateMapFunction';
import type { MigrateMapOutput } from '../../../types/MigrateMapFunction';

const migrateSpecies: MigrateMapFunction<
  'species',
  LegacySpecies,
  Species
> = async (input) => {
  const legacy = LegacySpeciesSchema.parse(input);
  const { title, tags, extraMetadata } = legacy;
  const { species } = extraMetadata ?? {};

  const { type, origin, lifespan, traits } = species ?? {};

  return {
    title,
    tags: tags ?? [],
    species: {
      name: title,
      type,
      origin,
      lifespan,
      traits,
      image: {
        url: undefined,
        attribution: undefined,
        attributionUrl: undefined,
      },
    }
  }
}

export default migrateSpecies;