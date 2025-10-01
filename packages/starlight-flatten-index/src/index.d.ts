import type { StarlightPlugin } from '@astrojs/starlight/types';

/**
 * Starlight plugin: Flatten single-index groups in the sidebar.
 * Registers a post-route middleware that rewrites
 * locals.starlightRoute.sidebar.
 *
 * @returns A Starlight plugin configuration object
 */
export default function starlightFlattenIndex(): StarlightPlugin;

