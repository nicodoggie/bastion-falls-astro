import {
  LocationSchema as LegacyLocationSchema,
  type Location as LegacyLocation,
} from '@bastion-falls/types/legacy';
import { LocationSchema, type Location } from '@bastion-falls/types';
import type { MigrateMapFunction } from '@/types/MigrateMapFunction';
import {
  BuildingLocationTypeSchema,
  LocationTypeSchema,
  PoliticalLocationTypeSchema,
  NaturalLocationTypeSchema
} from '@bastion-falls/types/Location';
import type {
  BuildingLocationDetails,
  LocationDetails,
  LocationType,
  NaturalLocationDetails,
  PoliticalLocationDetails,
  PoliticalLocationType
} from '@bastion-falls/types/Location';
import { z } from 'zod';

// Helper function to infer location type from title and tags with high confidence
function inferLocationTypeFromTitleAndTags(title: string, tags: string[]): { type: string | undefined; shouldAddTag: boolean } {
  // Get all valid location types from the schema
  const validTypes = LocationTypeSchema.options.values().reduce((acc, value) => {
    acc = acc.concat(value.options);
    return acc;
  }, [] as string[]);

  const lowerTitle = title.toLowerCase();
  const lowerTags = tags.map(tag => tag.toLowerCase().trim());

  // Check if any specific type tags already exist
  const hasExistingTypeTag = lowerTags.some(tag =>
    validTypes.includes(tag) ||
    tag === 'mountain range' ||
    tag === 'port city' ||
    tag === 'port town' ||
    tag === 'fishing port' ||
    tag === 'trading port' ||
    tag === 'confederation' ||
    tag === 'township'
  );

  // Special mappings for compound tags or variations
  const tagMappings: { [key: string]: string } = {
    'port city': 'port',
    'port town': 'port',
    'fishing port': 'port',
    'trading port': 'port',
    'apgarian confederacy': 'confederacy',
    'confederation': 'confederacy',
    'confederation of apgarian states': 'confederacy',
    'township': 'town',
    'marches': 'march',
    'principate': 'principality',
  };

  // Check for direct matches in existing tags first
  for (const tag of lowerTags) {
    // Check special mappings
    if (tagMappings[tag]) {
      return { type: tagMappings[tag], shouldAddTag: false };
    }

    // Check direct enum matches
    if (validTypes.includes(tag as any)) {
      return { type: tag, shouldAddTag: false };
    }
  }

  // If we have existing type tags, don't add a new one
  if (hasExistingTypeTag) {
    return { type: undefined, shouldAddTag: false };
  }

  // High-confidence inference patterns based on title
  const highConfidencePatterns: { pattern: RegExp; type: string; tag: string }[] = [
    // Mountain patterns - improved detection
    { pattern: /\bmountains?\b/i, type: 'mountain', tag: 'mountain range' },
    { pattern: /\bmount\b/i, type: 'mountain', tag: 'mountain' },
    { pattern: /\bpeak\b/i, type: 'mountain', tag: 'mountain' },
    { pattern: /\brange\b/i, type: 'mountain', tag: 'mountain range' },

    // Water features
    { pattern: /\brivers?\b/i, type: 'river', tag: 'river' },
    { pattern: /\bseas?\b/i, type: 'sea', tag: 'sea' },
    { pattern: /\bstraits?\b/i, type: 'strait', tag: 'strait' },
    { pattern: /\bgulfs?\b/i, type: 'gulf', tag: 'gulf' },
    { pattern: /\bbays?\b/i, type: 'bay', tag: 'bay' },
    { pattern: /\bwaterfalls?\b/i, type: 'waterfall', tag: 'waterfall' },
    { pattern: /\bfalls\b/i, type: 'waterfall', tag: 'waterfall' },
    { pattern: /\bchannels?\b/i, type: 'channel', tag: 'channel' },
    { pattern: /\bsounds?\b/i, type: 'sound', tag: 'sound' },
    { pattern: /\breach\b/i, type: 'reach', tag: 'reach' },
    { pattern: /\batolls?\b/i, type: 'atoll', tag: 'atoll' },
    { pattern: /\bgeysers?\b/i, type: 'geyser', tag: 'geyser' },
    { pattern: /\bgorges?\b/i, type: 'gorge', tag: 'gorge' },
    { pattern: /\bcanyons?\b/i, type: 'canyon', tag: 'canyon' },
    { pattern: /\bpass(es)?\b/i, type: 'pass', tag: 'pass' },
    { pattern: /\bbasins?\b/i, type: 'basin', tag: 'basin' },
    { pattern: /\bplains?\b/i, type: 'plains', tag: 'plains' },
    { pattern: /\bfields?\b/i, type: 'field', tag: 'field' },

    // Geographic regions
    { pattern: /\bislands?\b/i, type: 'island', tag: 'island' },
    { pattern: /\bpeninsulas?\b/i, type: 'peninsula', tag: 'peninsula' },
    { pattern: /\barchipelag(o|os)\b/i, type: 'archipelago', tag: 'archipelago' },
    { pattern: /\bforests?\b/i, type: 'forest', tag: 'forest' },
    { pattern: /\bmarches?\b/i, type: 'march', tag: 'march' },

    // Political entities
    { pattern: /\bconfederacy\b/i, type: 'confederacy', tag: 'confederacy' },
    { pattern: /\bconfederation\b/i, type: 'confederacy', tag: 'confederacy' },
    { pattern: /\bkingdoms?\b/i, type: 'kingdom', tag: 'kingdom' },
    { pattern: /\bempires?\b/i, type: 'empire', tag: 'empire' },
    { pattern: /\bprincipality\b/i, type: 'principality', tag: 'principality' },
    { pattern: /\bduchies\b/i, type: 'duchy', tag: 'duchy' },
    { pattern: /\bduchy\b/i, type: 'duchy', tag: 'duchy' },
    { pattern: /\bdiocese\b/i, type: 'diocese', tag: 'diocese' },
    { pattern: /\bprotectorates?\b/i, type: 'protectorate', tag: 'protectorate' },
    { pattern: /\bterritories\b/i, type: 'territory', tag: 'territory' },
    { pattern: /\bterritory\b/i, type: 'territory', tag: 'territory' },

    // Settlements
    { pattern: /\bports?\b/i, type: 'port', tag: 'port' },
    { pattern: /\bfortress(es)?\b/i, type: 'fortress', tag: 'fortress' },
    { pattern: /\bforts?\b/i, type: 'fortress', tag: 'fortress' },

    // Buildings/Structures  
    { pattern: /\binns?\b/i, type: 'inn', tag: 'inn' },
    { pattern: /\bacadem(y|ies)\b/i, type: 'academy', tag: 'academy' },
    { pattern: /\bcathedrals?\b/i, type: 'cathedral', tag: 'cathedral' },
    { pattern: /\bchurch(es)?\b/i, type: 'church', tag: 'church' },
    { pattern: /\btemples?\b/i, type: 'temple', tag: 'temple' },
    { pattern: /\bcourts?\b/i, type: 'court', tag: 'court' },
    { pattern: /\bpalaces?\b/i, type: 'palace', tag: 'palace' },
    { pattern: /\bmanors?\b/i, type: 'manor', tag: 'manor' },
    { pattern: /\bmansions?\b/i, type: 'mansion', tag: 'mansion' },
    { pattern: /\bhomesteads?\b/i, type: 'homestead', tag: 'homestead' },
    { pattern: /\bfarms?\b/i, type: 'farm', tag: 'farm' },
    { pattern: /\bmines?\b/i, type: 'mine', tag: 'mine' },
    { pattern: /\bcaves?\b/i, type: 'feature', tag: 'cave' },
  ];

  // Check title against high-confidence patterns
  for (const { pattern, type, tag } of highConfidencePatterns) {
    if (pattern.test(lowerTitle)) {
      return { type, shouldAddTag: true };
    }
  }

  // Additional context checks for ambiguous cases

  // Check for confederation context in tags
  if (lowerTags.some(tag => tag.includes('apgarian')) &&
    lowerTitle.includes('confederation')) {
    return { type: 'confederacy', shouldAddTag: true };
  }

  // No high-confidence match found
  return { type: undefined, shouldAddTag: false };
}

const migrateLocation: MigrateMapFunction<
  'location',
  LegacyLocation,
  Location
> = async (input) => {
  console.log(input);

  const legacy = LegacyLocationSchema.parse(input);
  const { title, tags = [], extraMetadata } = legacy;
  const { location: legacyLocation } = extraMetadata ?? {};
  const { details: legacyDetails } = legacyLocation ?? {};

  // Infer type from title and tags
  const { type, shouldAddTag } = inferLocationTypeFromTitleAndTags(title, tags);

  if (!type) {
    throw new Error(`No location type found for ${title}`);
  }

  const locationType = LocationTypeSchema.parse(type);

  // Add type tag if needed and we're confident
  let updatedTags = [...tags];
  if (shouldAddTag) {
    // Determine what tag to add based on the inferred type
    const tagToAdd = type === 'mountain' && title.toLowerCase().includes('mountains')
      ? 'mountain range'
      : type;

    if (!updatedTags.includes(tagToAdd)) {
      updatedTags.push(tagToAdd);
      console.log(`Adding tag "${tagToAdd}" to ${title}`);
    }
  }

  let locationDetails: any;

  if (locationType in BuildingLocationTypeSchema.Values) {
    locationDetails = {
      type: locationType,
      details: {
        area: legacyDetails?.total_area ?? legacyDetails?.area,
      },
    };
  } else if (locationType in NaturalLocationTypeSchema.Values) {
    locationDetails = {
      type: locationType,
      area: legacyDetails?.total_area ?? legacyDetails?.area,
      elevation: legacyDetails?.elevation,
      climate: legacyDetails?.climate,
    };
  } else if (locationType in PoliticalLocationTypeSchema.Values) {
    locationDetails = {
      type: locationType,
      details: {
        flag: {
          url: extraMetadata?.location?.flag?.url,
          alt: extraMetadata?.location?.flag?.url && `Flag of ${title}`,
        },
        map: {
          url: extraMetadata?.location?.map?.url,
          alt: `Map of ${title}`,
        },
        motto: legacyDetails?.motto,
        anthem: legacyDetails?.anthem,
        capital: legacyDetails?.capital,
        government: {
          type: legacyDetails?.government,
          structure: legacyDetails?.government_structure,
        },
        currency: legacyDetails?.currency,
        religions: legacyDetails?.religions,
        states: legacyDetails?.states,
        languages: legacyDetails?.languages,
        population: legacyDetails?.total_population ?? legacyDetails?.population,
        area: legacyDetails?.total_area ?? legacyDetails?.area,
        elevation: legacyDetails?.elevation,
        climate: legacyDetails?.climate,
        sections: legacyDetails?.districts?.map((district: any) => ({
          name: district.name,
          area: district.area,
          population: district.population,
        })),
      },
    };
  }

  return {
    title,
    tags: updatedTags,
    location: {
      name: title,
      type: locationType,
      details: locationDetails,
    },
  };
};

export default migrateLocation; 