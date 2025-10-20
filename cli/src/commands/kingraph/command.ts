import { buildRouteMap, buildCommand } from '@stricli/core';

export const kingraphCommandRoutes = buildRouteMap({
  routes: {
    'from-characters': buildCommand({
      loader: async () => await import('./impl.js'),
      parameters: {
        flags: {
          scaffoldMdx: {
            kind: 'boolean',
            brief: 'Also scaffold missing family index.mdx files',
            optional: true,
          },
          verbose: {
            kind: 'boolean',
            brief: 'Print scanned characters and updated family files',
            optional: true,
          },
        },
        positional: {
          kind: 'tuple',
          parameters: [
            {
              parse: String,
              brief: 'Glob for character MDX files (default: astro/src/content/docs/world/characters/**/*.mdx)',
              optional: true,
            },
          ],
        },
      },
      docs: {
        brief: 'Generate kingraph family.yaml files from character articles',
      },
    }),
  },
  docs: {
    brief: 'Kingraph utilities',
  },
});


