import { flat } from 'eslint-plugin-mdx';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default [
  {
    ...flat,
    files: ['src/content/**/*.{md,mdx}'],
    languageOptions: {
      ...flat.languageOptions,
      parserOptions: {
        ...flat.languageOptions?.parserOptions,
        remarkConfigPath: resolve(__dirname, '.remarkrc.yaml'),
      },
    },
    rules: {
      ...flat.rules,
      'mdx/remark': 'warn',
    },
  },
];
