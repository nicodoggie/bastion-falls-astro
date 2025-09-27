import { beforeAll, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VFile } from 'vfile';
import { rehypePagefindMetadata } from '../src/index.js';
import { mdxProcessor } from './helpers/mdxProcessor.js';
import remarkRehype from 'remark-rehype';
import rehypeDocument from 'rehype-document';
import { rehype } from 'rehype';
const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
let hedwigPath = path.join(fixturesDir, 'hedwig-rosenkrantz.mdx');
describe('rehypePagefindMetadata', () => {
    it('should be defined', () => {
        expect(rehypePagefindMetadata).toBeDefined();
    });
    it('should return the tree if there is no frontmatter', () => {
        const plugin = rehypePagefindMetadata();
        const mockTree = { type: 'root', children: [] };
        const tree = plugin(mockTree, new VFile());
        expect(tree).toBe(mockTree);
    });
    it('should process the hedwig file', async () => {
        const hedwig = await mdxProcessor(hedwigPath);
        const test = await rehype()
            .use(remarkRehype)
            .use(rehypeDocument)
            .use(rehypePagefindMetadata)
            .process(hedwig);
        console.log(test);
    });
});
//# sourceMappingURL=index.test.js.map