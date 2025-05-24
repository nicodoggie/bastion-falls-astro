import {
  CharacterSchema as LegacyCharacterSchema,
  type Character as LegacyCharacter,
} from '@bastion-falls/types/legacy';
import { CharacterSchema, type Character } from '@bastion-falls/types';
import type { ImageAttribution, ImagePrompt } from '@bastion-falls/types/Image';
import type { CharacterSexOrgan } from '@bastion-falls/types/Character';
import type { MigrateMapFunction } from '@/types/MigrateMapFunction';

const migrateCharacter: MigrateMapFunction<
  'character',
  LegacyCharacter,
  Character
> = async (input) => {
  const legacy = LegacyCharacterSchema.parse(input);
  const { extraMetadata, title, tags } = legacy;
  const {
    ddb,
    image: legacyImage,
    character: legacyCharacter,
    mortality_status,
  } = extraMetadata ?? {};

  // Parse legacy image attribution or prompts
  let image: ImageAttribution | ImagePrompt | undefined = undefined;
  if (legacyImage) {
    if ('attribution_url' in legacyImage) {
      image = {
        url: legacyImage.url ?? undefined,
        attribution: legacyImage.attribution ?? undefined,
        attributionUrl: legacyImage.attribution_url ?? undefined,
      };
    } else if ('prompt' in legacyImage) {
      image = {
        prompt: legacyImage.prompt ?? undefined,
        negativePrompt: legacyImage.negative_prompt ?? undefined,
        generatorUrl: undefined,
        model: undefined,
      };
    }
  }

  let sexOrgans: CharacterSexOrgan[] = [];

  if (legacyCharacter?.penis_length || legacyCharacter?.penis_girth) {
    sexOrgans.push({
      type: 'penis',
      length: Number(legacyCharacter.penis_length),
      girth: Number(legacyCharacter.penis_girth),
      pubicHair: undefined,
    });
  }

  const character: Character = CharacterSchema.parse({
    name: title,
    ddb: ddb && ddb?.trim() !== '' ? ddb : undefined,
    image,
    details: {
      age: Number(legacyCharacter?.age) || undefined,
      dateOfBirth: legacyCharacter?.date_of_birth ?? undefined,
      dateOfDeath: legacyCharacter?.date_of_death ?? undefined,
      sex: legacyCharacter?.sex ?? undefined,
      pronouns: legacyCharacter?.pronouns ?? undefined,
      aliases: legacyCharacter?.aliases ?? undefined,
      height: legacyCharacter?.height ?? undefined,
      weight: legacyCharacter?.weight ?? undefined,
      mortality: mortality_status?.toLowerCase() ?? 'alive',
      species: legacyCharacter?.species ?? 'human',
      sexOrgans,
    },
    relationships: {
      organizations: [],
      relatives: [],
      religions: [],
      families: [],
    },
  });

  return {
    title: title ?? character.name,
    tags: tags ?? undefined,
    character: character as Character,
  };
};

export default migrateCharacter;
