import type { RouteMiddleware } from '@astrojs/starlight/route-data';

/**
 * Route middleware that flattens single-index groups in the sidebar.
 *
 * Recursively processes sidebar items and replaces groups that contain
 * only a single link (pointing to the group's index) with the link itself.
 */
export const onRequest: RouteMiddleware;

