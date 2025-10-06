#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { slug as slugger } from 'github-slugger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Config
const ROOT = path.resolve(__dirname, '..');
const CHAR_DIR = path.resolve(ROOT, 'src/content/docs/world/characters');

const DEFAULT_YAML = path.resolve(
  ROOT,
  'src/content/docs/world/families/savoy/family.yaml',
);

const inputPath = process.argv[2]
  ? path.resolve(__dirname, process.argv[2])
  : DEFAULT_YAML;

function readYaml(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return yaml.load(raw);
}

function ensureArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function unique(arr) {
  return Array.from(new Set(arr));
}

function normalizePersonKey(key) {
  return String(key).trim();
}

function slugName(name) {
  const primary = slugger(name);
  const deburred = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '');
  const fallback = slugger(deburred);
  const romanMatch = deburred.match(/^(\w+)\s+(\w+)\s+(I|II|III|IV|V|VI|VII|VIII|IX|X)$/i);
  const alt = romanMatch ? slugger(`${romanMatch[1]} ${romanMatch[3]} ${romanMatch[2]}`) : null;
  // Also try first+last only, ignoring middle names
  const parts = deburred.trim().split(/\s+/);
  const firstLast = parts.length >= 2 ? slugger(`${parts[0]} ${parts[parts.length - 1]}`) : null;
  return { primary, fallback, alt, firstLast };
}

function addRelative(relativesMap, a, b, type) {
  if (!relativesMap.has(a)) relativesMap.set(a, []);
  relativesMap.get(a).push({ name: b, type });
}

function computeRelationships(doc) {
  const people = doc.people || {};
  const families = doc.families || [];

  const personKeyToFullname = new Map();
  for (const [
    key,
    val,
  ] of Object.entries(people)) {
    const name = val?.fullname || key;
    personKeyToFullname.set(normalizePersonKey(key), name);
  }

  // Map of person fullname -> families they belong to
  const personToFamilies = new Map();
  // Map of person fullname -> relatives entries { name, type }
  const personToRelatives = new Map();

  function addFamilyMembership(personKey, familyName) {
    const fullname = personKeyToFullname.get(personKey) || personKey;
    if (!personToFamilies.has(fullname)) personToFamilies.set(fullname, []);
    personToFamilies.get(fullname).push(familyName);
  }

  function addRelativeBothWays(aKey, bKey, typeAtoB, typeBtoA) {
    const aFull = personKeyToFullname.get(aKey) || aKey;
    const bFull = personKeyToFullname.get(bKey) || bKey;
    addRelative(personToRelatives, aFull, bFull, typeAtoB);
    addRelative(personToRelatives, bFull, aFull, typeBtoA);
  }

  function processFamilyNode(node, currentHouse) {
    // node may have: house, parents, parents2, children, children2, families (nested)
    let houseName = currentHouse;
    if (node.house) houseName = String(node.house).trim();

    // Parents arrays imply those two adults are partners/spouses and are members of house
    const parentSets = [];
    if (node.parents) parentSets.push(ensureArray(node.parents));
    if (node.parents2) parentSets.push(ensureArray(node.parents2));

    const childrenSets = [];
    if (node.children) childrenSets.push(ensureArray(node.children));
    if (node.children2) childrenSets.push(ensureArray(node.children2));

    for (const parents of parentSets) {
      if (parents.length === 2) {
        const [
          p1,
          p2,
        ] = parents.map(normalizePersonKey);
        if (houseName) {
          addFamilyMembership(p1, houseName);
          addFamilyMembership(p2, houseName);
        }
        // Treat as partners
        addRelativeBothWays(p1, p2, 'partner', 'partner');
      } else {
        // Single parent still belongs to house
        const p = parents.map(normalizePersonKey);
        for (const one of p) {
          if (houseName) addFamilyMembership(one, houseName);
        }
      }
    }

    // Assign children to house and connect to parents and siblings
    const allChildren = unique(childrenSets.flat().map(normalizePersonKey));
    for (const child of allChildren) {
      if (houseName) addFamilyMembership(child, houseName);
      // parents -> child and child -> parent
      for (const parents of parentSets) {
        const normParents = parents.map(normalizePersonKey);
        for (const p of normParents) {
          addRelativeBothWays(child, p, 'parent', 'child');
        }
      }
    }

    // Sibling relationships within combined children of this node
    for (let i = 0; i < allChildren.length; i++) {
      for (let j = i + 1; j < allChildren.length; j++) {
        addRelativeBothWays(
          allChildren[i],
          allChildren[j],
          'sibling',
          'sibling',
        );
      }
    }

    // Recurse into nested families
    if (Array.isArray(node.families)) {
      for (const sub of node.families) processFamilyNode(sub, houseName);
    }
  }

  for (const fam of families) {
    processFamilyNode(fam, fam.house || null);
  }

  // Normalize unique and sort
  const out = new Map();
  for (const [
    fullname,
    fams,
  ] of personToFamilies.entries()) {
    const familiesUnique = unique(fams).map((name) => ({ name }));
    out.set(fullname, { families: familiesUnique, relatives: [] });
  }
  for (const [
    fullname,
    relatives,
  ] of personToRelatives.entries()) {
    const dedup = new Map();
    for (const r of relatives) {
      const key = `${r.type}::${r.name}`;
      if (!dedup.has(key)) dedup.set(key, r);
    }
    const arr = Array.from(dedup.values());
    if (!out.has(fullname)) out.set(fullname, { families: [], relatives: arr });
    else out.get(fullname).relatives = arr;
  }

  return out; // Map fullname -> { families: [{name}], relatives: [{name,type}] }
}

function loadCharacterFile(slugOrSlugs) {
  const candidates = Array.isArray(slugOrSlugs) ? slugOrSlugs : [slugOrSlugs];
  for (const s of candidates.filter(Boolean)) {
    const fp = path.join(CHAR_DIR, `${s}.mdx`);
    if (fs.existsSync(fp)) {
      const raw = fs.readFileSync(fp, 'utf8');
      const fm = matter(raw);
      return { fp, fm };
    }
  }
  return null;
}

function writeCharacterFile(fp, fm) {
  const output = matter.stringify(fm.content, fm.data);
  fs.writeFileSync(fp, output, 'utf8');
}

function mergeRelationships(existing, computed) {
  const out = { ...existing };
  const families = ensureArray(existing?.families).map((x) => ({
    name: x.name,
  }));
  const relatives = ensureArray(existing?.relatives).map((x) => ({
    name: x.name,
    type: x.type,
  }));

  const famDedup = new Map();
  for (const f of [
    ...families,
    ...computed.families,
  ])
    famDedup.set(f.name, f);
  const relDedup = new Map();
  for (const r of [
    ...relatives,
    ...computed.relatives,
  ])
    relDedup.set(`${r.type}::${r.name}`, r);

  out.families = Array.from(famDedup.values());
  out.relatives = Array.from(relDedup.values());
  return out;
}

function main() {
  if (!fs.existsSync(inputPath)) {
    console.error(`Input YAML not found: ${inputPath}`);
    process.exit(1);
  }
  const doc = readYaml(inputPath);
  const rels = computeRelationships(doc);

  const missing = [];
  const updated = [];
  const skipped = [];

  for (const [
    fullname,
    data,
  ] of rels.entries()) {
    const { primary, fallback, alt, firstLast } = slugName(fullname);
    const familyCandidates = Array.isArray(data?.families)
      ? data.families.map((f) => f?.name).filter(Boolean)
      : [];
    const combinedCandidates = [];
    const nameParts = fullname.trim().split(/\s+/);
    // Single-word given names: try Given + Family (e.g., "Mark" + "Strandiz")
    if (familyCandidates.length > 0 && nameParts.length === 1) {
      for (const fam of familyCandidates) {
        combinedCandidates.push(slugger(`${fullname} ${fam}`));
      }
    }
    // Multi-word names with maiden names: try First + Family (e.g., "Nicolette" + "Bouillard")
    if (familyCandidates.length > 0 && nameParts.length >= 2) {
      const first = nameParts[0];
      for (const fam of familyCandidates) {
        combinedCandidates.push(slugger(`${first} ${fam}`));
      }
    }
    const loaded = loadCharacterFile([
      primary,
      fallback,
      alt,
      firstLast,
      ...combinedCandidates,
    ]);
    if (!loaded) {
      missing.push({
        fullname,
        slug: primary,
        families: data.families,
        relatives: data.relatives,
      });
      continue;
    }
    const { fp, fm } = loaded;
    const front = fm.data || {};
    front.character = front.character || {};
    front.character.name = front.character.name || fullname;
    front.character.relationships = mergeRelationships(
      front.character.relationships || {},
      data,
    );

    fm.data = front;
    writeCharacterFile(fp, fm);
    updated.push({ slug: primary, path: fp });
  }

  console.log(
    JSON.stringify(
      {
        source: inputPath,
        updatedCount: updated.length,
        updated,
        missingCount: missing.length,
        missing,
        skipped,
      },
      null,
      2,
    ),
  );
}

main();
