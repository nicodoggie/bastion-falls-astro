import type { Ai, ExecutionContext, RateLimit } from '@cloudflare/workers-types';
import { verifyDiscordRequest, json, formatResults } from './discord';
import { config as loadEnv } from "dotenv";

loadEnv();

type Env = {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_BOT_TOKEN: string;
  AI_SEARCH_INDEX: string;
  RATE_LIMITER: RateLimit; // Bound via [[ratelimits]] in wrangler.toml
  AI: Ai; // Bound via [ai] binding in wrangler.toml
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (!env.RATE_LIMITER.limit({ key: url.pathname })) {
      return new Response(`Rate limit exceeded for ${url.pathname}`, { status: 429 });
    }

    if (url.pathname === '/health') {
      return json({ ok: true });
    }

    if (url.pathname === '/interactions' && request.method === 'POST') {

      const ok = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);
      if (!ok) return new Response('Bad signature', { status: 401 });

      const body = await request.json();

      // PING
      if (body?.type === 1) {
        return json({ type: 1 });
      }

      // APPLICATION_COMMAND
      if (body?.type === 2) {
        const commandName = body?.data?.name;
        if (commandName === 'search') {
          const query = body?.data?.options?.find((o: any) => o.name === 'q')?.value ?? '';

          // Defer the response immediately (shows "thinking..." to user)
          // This gives us more time to process the AI search
          const deferResponse = json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE

          // Send the follow-up response asynchronously
          const interactionToken = body?.token;
          const appId = env.DISCORD_APPLICATION_ID;

          // Respond immediately with deferred message
          ctx.waitUntil(
            (async () => {
              try {
                console.log('Searching with query:', query);
                const results = await env.AI.autorag(env.AI_SEARCH_INDEX).search({
                  query,
                  rewrite_query: true,
                });
                console.log('Search results:', JSON.stringify(results));
                const content = formatResults(results);
                console.log('Formatted content:', content);

                // Send follow-up message
                await fetch(
                  `https://discord.com/api/v10/webhooks/${appId}/${interactionToken}`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content }),
                  }
                );
              } catch (e: unknown) {
                const error = e as Error;
                console.error('Search failed:', error);

                // Send error as follow-up
                await fetch(
                  `https://discord.com/api/v10/webhooks/${appId}/${interactionToken}`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: `Search failed. ${error.message}` }),
                  }
                );
              }
            })()
          );

          return deferResponse;
        }
        if (commandName === 'zarifa') {
          const query = body?.data?.options?.find((o: any) => o.name === 'q')?.value;
          if (query && typeof query === 'string') {
            // Defer the response immediately
            const deferResponse = json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE

            const interactionToken = body?.token;
            const appId = env.DISCORD_APPLICATION_ID;
            const rag = env.AI.autorag(env.AI_SEARCH_INDEX);

            // Process asynchronously
            ctx.waitUntil(
              (async () => {
                try {
                  console.log('Zarifa searching with query:', query);
                  const results = await rag.aiSearch({
                    query,
                    max_num_results: 2,
                  });
                  console.log('Zarifa results:', JSON.stringify(results));
                  const formatted = formatResults(results);
                  console.log('Zarifa formatted:', formatted);
                  const content = `Zarifa search for: ${query}\n\n${formatted}`;

                  // Send follow-up message
                  await fetch(
                    `https://discord.com/api/v10/webhooks/${appId}/${interactionToken}`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ content }),
                    }
                  );
                } catch (_e) {
                  const error = _e as Error;
                  console.error('Zarifa search failed:', error);

                  // Send error as follow-up
                  await fetch(
                    `https://discord.com/api/v10/webhooks/${appId}/${interactionToken}`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ content: `Zarifa search failed. ${error.message}` }),
                    }
                  );
                }
              })()
            );

            return deferResponse;
          }
          return json({ type: 4, data: { content: 'Zarifa online. Use /zarifa q:<query> to search.', flags: 64 } });
        }
        return json({ type: 4, data: { content: 'Unknown command.', flags: 64 } });
      }

      return new Response('Unsupported', { status: 400 });
    }

    return new Response('Not Found', { status: 404 });
  },
};


