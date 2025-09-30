import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

/**
 * Determine if a group is effectively a single-index group:
 * - It has exactly one entry
 * - That entry is a link whose href points to the group's index (same path)
 * We conservatively treat any single child link as flattenable, which matches
 * the UX goal (no dropdown for single child).
 */
function slugifyLabel(label) {
  return String(label)
    .trim()
    .toLowerCase()
    .replace(/['"’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function lastPathSegment(href) {
  try {
    const path = (href || '').split('?')[0].split('#')[0];
    const segs = path.split('/').filter(Boolean);
    return segs[segs.length - 1] || '';
  } catch {
    return '';
  }
}

function canFlattenGroup(group) {
  if (!group || group.type !== 'group') return false;
  const entries = group.entries || [];
  if (entries.length !== 1) return false;
  const only = entries[0];
  if (!only || only.type !== 'link') return false;
  // Only flatten if the single link looks like the directory index for this group:
  // compare the last segment of the href with the slugified group label.
  const groupSlug = slugifyLabel(group.label ?? '');
  const linkSegment = lastPathSegment(only.href ?? '');
  return groupSlug && linkSegment && linkSegment === groupSlug;
}

function flattenGroups(items) {
  const result = [];
  for (const item of items) {
    if (!item) continue;
    if (item.type === 'group') {
      // Recurse first
      const flattenedEntries = flattenGroups(item.entries || []);
      const group = { ...item, entries: flattenedEntries };
      if (canFlattenGroup(group)) {
        const link = group.entries[0];
        // Preserve the link's own label (derived from page title/frontmatter)
        result.push({ ...link, label: link.label });
      } else {
        result.push(group);
      }
    } else {
      result.push(item);
    }
  }
  return result;
}

export const onRequest = defineRouteMiddleware(async ({ locals }) => {
  const { starlightRoute } = locals;
  if (!starlightRoute?.sidebar) return;
  starlightRoute.sidebar = flattenGroups(starlightRoute.sidebar);
});
