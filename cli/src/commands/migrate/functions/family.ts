import {
  FamilySchema as LegacyFamilySchema,
  type Family as LegacyFamily,
} from '@bastion-falls/types/legacy';
import { FamilySchema, type Family } from '@bastion-falls/types';
import type { MigrateMapFunction } from '@/types/MigrateMapFunction';

const migrateFamily: MigrateMapFunction<
  'family',
  LegacyFamily,
  Family
> = async (input) => {
  const legacy = LegacyFamilySchema.parse(input);
  const { title, tags, extraMetadata } = legacy;
  const { family } = extraMetadata ?? {};
  const { founded, dissolved, seat, motto, sigil } = family ?? {};
  return {
    title,
    family: {
      name: title,
      founded,
      dissolved,
      seat,
      motto,
      sigil,
    },
    tags,
  };
};

export default migrateFamily;
