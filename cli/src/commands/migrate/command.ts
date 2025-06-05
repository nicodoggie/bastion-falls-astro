import type { LocalContext } from '@/context';
import type { MigrateMapFunction, MigrateMapOutput } from '@/types/MigrateMapFunction';
import { buildCommand, type FlagParametersForType } from '@stricli/core';

import fs from 'fs/promises';
import { parse, replace } from '@/lib/frontmatter';
import { glob } from "glob";
import { resolve } from 'node:path';

export interface MigrateCommandFlags {
  force?: boolean;
  target?: string;
  dryRun?: boolean;
}

const mapping: Record<string, MigrateMapFunction<any, any, any>> = {
  character: (await import('./functions/character.js')).default,
  family: (await import('./functions/family.js')).default,
  location: (await import('./functions/location.js')).default,
  organization: (await import('./functions/organization.js')).default,
  species: (await import('./functions/species.js')).default,
}

export const migrateCommand = buildCommand({
  async func(this: LocalContext, flags: MigrateCommandFlags, type: string, source: string) {

    const fileNames = await glob(source, {
      nodir: true,
      cwd: this.currentPath,
    });

    const migrateMapFunction = await mapping[type];
    if(!migrateMapFunction) {
      throw new Error(`No migration function found for ${type}`);
    }
    const errors: string[] = [];
    for(const fileName of fileNames) {
      console.log(`Migrating ${fileName}`);
      // parse the frontmatter
      try {
        const frontmatter = await parse(resolve(this.currentPath, fileName));
        const migratedFrontmatter = await migrateMapFunction(frontmatter);
        const migratedFile = await replace(resolve(this.currentPath, fileName), migratedFrontmatter);

        // check if target is a directory, if false, overwrite the file
        // if true, create the file into the defined target directory

        if(flags.dryRun) {
          console.log(migratedFile);
        } else {
          const targetPath = flags.target 
            ? resolve(this.currentPath, flags.target, fileName) 
            : resolve(this.currentPath, fileName);
          console.log(targetPath, migratedFile);
          await fs.writeFile(targetPath, migratedFile, 'utf8');
        }
      } catch(e) {
        console.error(`Error: ${e}`);
      }
    }
  },
  parameters: {
    flags: {
      force: {
        kind: "boolean",
        brief: "Force the migration",
        optional: true,
      },
      dryRun: {
        kind: "boolean",
        brief: "Dry run the migration",
        optional: true,
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "type",
          parse: (value: string) => value,
          brief: "Article type to migrate",
        },
        {
          placeholder: "target",
          parse: (value: string) => value,
          brief: "Target file/directory",
        }
      ],
    },
  },
  docs: {
    brief: "Migrate a legacy format to the new format",
  },  
});