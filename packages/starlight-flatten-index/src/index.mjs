/**
 * Starlight plugin: Flatten single-index groups in the sidebar.
 * Registers a post-route middleware that rewrites locals.starlightRoute.sidebar.
 */

/** @typedef {import('@astrojs/starlight/types').StarlightPlugin} StarlightPlugin */

/**
 * @returns {StarlightPlugin}
 */
export default function starlightFlattenIndex() {
  return {
    name: 'starlight-flatten-index',
    hooks: {
      'config:setup': ({ addRouteMiddleware, command }) => {
        if (command !== 'dev' && command !== 'build') return;
        addRouteMiddleware({
          entrypoint: '@bastion-falls/starlight-flatten-index/middleware',
          order: 'post',
        });
      },
    },
  };
}
