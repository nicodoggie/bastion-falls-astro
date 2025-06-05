import {
  OrganizationSchema as LegacyOrganizationSchema,
  type Organization as LegacyOrganization,
} from '@bastion-falls/types/legacy';
import type { Organization } from '@bastion-falls/types';
import type { MigrateMapFunction } from '@/types/MigrateMapFunction';

const migrateOrganization: MigrateMapFunction<
  'organization',
  LegacyOrganization,
  Organization
> = async (input) => {
  const legacy = LegacyOrganizationSchema.parse(input);
  const { title, tags, extraMetadata } = legacy;
  const { organization } = extraMetadata ?? {};
  const { type, founded, dissolved, headquarters } = organization ?? {};
  return {
    title,
    tags,
    organization: {
      name: title,
      type,

      founded,
      dissolved,
      headquarters,
    },
  };
};

export default migrateOrganization;
