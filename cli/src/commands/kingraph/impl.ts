import type { LocalContext } from '@/context.js';
import { glob } from 'tinyglobby';
import { resolve, join } from 'node:path';
import type { CharacterMortalityInput } from '@bastion-falls/types/CharacterAge';
import {
  getCurrentDeathDate,
  getOriginalBirthDate,
} from '@bastion-falls/types/CharacterAge';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { remark } from 'remark';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMdx from 'remark-mdx';
import type { Node, Root } from 'mdast';
import yaml from 'js-yaml';
import { slug as slugger } from 'github-slugger';
import type { VFile } from 'vfile';
import { getContentDir, getTargetPath } from '@/config';

type Relative = {
  name: string;
  type:
    | 'parent'
    | 'adoptive parent'
    | 'child'
    | 'adopted child'
    | 'sibling'
    | 'partner'
    | 'spouse'
    | 'friend'
    | 'enemy'
    | 'ally'
    | 'associate'
    | 'other';
};

type CharacterFrontmatter = {
  title?: string;
  character?: {
    name?: string;
    details?: {
      mortality?: CharacterMortalityInput;
    };
    relationships?: {
      relatives?: Relative[];
      families?: { name: string }[];
    }
  };
};

function parseFrontmatter(file: string) {
  return remark()
    .use(remarkFrontmatter)
    .use(remarkMdx)
    .use(() => (tree: Root, fileObj: VFile) => {
      const fmNode = tree.children.find((n: Node) => n.type === 'yaml');
      if (fmNode) {
        if ('value' in fmNode) {
          fileObj.data['frontmatter'] = yaml.load(fmNode.value) as CharacterFrontmatter;
        }
      }
    });
}

export default async function fromCharacters(
  this: LocalContext,
  flags?: { scaffoldMdx?: boolean; verbose?: boolean },
  patternArg?: string,
): Promise<void> {
  const contentDir = getContentDir();
  const characterDir = resolve(contentDir, 'characters');
  const pattern = patternArg || '**/*.mdx';
  console.log(characterDir, pattern);
  const files = await glob(pattern as any, { cwd: characterDir, onlyFiles: true });

  // family name -> { families: Set, people: Map(key->fullname), edges collected }
  const familyToGraph: Map<string, {
    families: any[];
    people: Map<string, { fullname: string; born?: string; died?: string }>;
    relations: { parents?: string[]; parents2?: string[]; children?: string[]; children2?: string[] }[];
  }> = new Map();

  let scanned = 0;

  for (const rel of files) {
    const abs = resolve(characterDir, rel);
    const raw = await readFile(abs, 'utf8');
    if (flags?.verbose) console.log(`Scanning: ${rel}`);
    const processor = parseFrontmatter(raw);
    const vfile = await processor.process(raw as any);
    const fm = (vfile.data as any).frontmatter as CharacterFrontmatter;
    if (!fm?.character) continue;
    scanned++;

    const fullname = fm.character.name || fm.title || '';
    const mortality = fm.character.details?.mortality;
    const born = mortality ? getOriginalBirthDate(mortality) : undefined;
    const died =
      mortality &&
      (mortality.status === 'dead' || mortality.status === 'undead')
        ? getCurrentDeathDate(mortality)
        : undefined;
    const families = fm.character.relationships?.families || [];
    const relatives = fm.character.relationships?.relatives || [];

    if (families.length === 0) continue; // skip unassigned

    for (const fam of families) {
      const famName = fam.name;
      if (!familyToGraph.has(famName)) {
        familyToGraph.set(famName, {
          families: [{ house: famName }],
          people: new Map(),
          relations: [],
        });
      }
      const graph = familyToGraph.get(famName)!;
      graph.people.set(fullname, { fullname, born, died });

      // Partition relations for kingraph: collect parent/child/partner/sibling
      const parents = relatives.filter(r => r.type === 'parent' || r.type === 'adoptive parent').map(r => r.name);
      const children = relatives.filter(r => r.type === 'child' || r.type === 'adopted child').map(r => r.name);
      const partners = relatives.filter(r => r.type === 'partner' || r.type === 'spouse').map(r => r.name);
      const siblings = relatives.filter(r => r.type === 'sibling').map(r => r.name);

      // For each partner pair, record as parents set (no children here; children handled via their files)
      for (const p of partners) {
        graph.relations.push({ parents: [fullname, p] });
      }
      // If we have parents, record them as parents of this fullname
      if (parents.length > 0) {
        graph.relations.push({ parents, children: [fullname] });
      }
      // If we have children, record this fullname as parent
      if (children.length > 0) {
        graph.relations.push({ parents: [fullname], children });
      }
      // Siblings: infer as a sibling cluster; represent as a parents2-less sibling group via children2 under a dummy parents set of none
      if (siblings.length > 0) {
        const cluster = Array.from(new Set([fullname, ...siblings]));
        graph.relations.push({ children2: cluster });
      }
    }
  }

  // Emit per family
  let familiesFound = 0;
  let filesChanged = 0;
  let filesUnchanged = 0;
  for (const [famName, graph] of familyToGraph.entries()) {
    familiesFound++;
    // Build people block
    const people: Record<string, any> = {};
    for (const { fullname, born, died } of graph.people.values()) {
      const name = fullname.split(' ')[0];
      if (!name) continue;
      people[name] = {
        fullname,
        born: born || undefined,
        died: died || undefined,
      };
    }

    const out = {
      families: [
        { house: famName, families: graph.relations },
      ],
      people,
      styles: {
        undead: { color: 'black', penwidth: 1 },
        dead: { color: 'red', penwidth: 0.25 },
        unknown: { color: 'gray', penwidth: 0.25 },
      },
    };

    const famSlug = slugger(famName);
    const targetDir = resolve(getTargetPath('families'), famSlug);
    await mkdir(targetDir, { recursive: true });
    const target = resolve(targetDir, 'family.yaml');

    let before: string | null = null;
    try {
      before = (await readFile(target, 'utf8')).toString();
    } catch { }

    const outYaml = yaml.dump(out);
    await writeFile(target, outYaml, 'utf8');
    const changed = before === null || before !== outYaml;
    if (changed) filesChanged++; else filesUnchanged++;
    if (flags?.verbose) console.log(`Updated: ${target}${changed ? '' : ' (no changes)'}`);

    // Optionally scaffold a family index.mdx if missing
    if (flags?.scaffoldMdx) {
      const indexPath = resolve(targetDir, 'index.mdx');
      try {
        await writeFile(indexPath, '', { flag: 'wx' });
        const mdx = `---\n` +
          `title: ${famName}\n` +
          `tags:\n` +
          `  - families\n` +
          `family:\n` +
          `  name: ${famName}\n` +
          `---\n\n<Stub />\n`;
        await writeFile(indexPath, mdx, 'utf8');
        if (flags?.verbose) console.log(`Created ${indexPath}`);
      } catch {
        // exists; skip
      }
    }
  }

  console.log(`Scanned characters: ${scanned}`);
  console.log(`Families found: ${familiesFound}`);
  console.log(`family.yaml written: ${filesChanged}, unchanged: ${filesUnchanged}`);
}


