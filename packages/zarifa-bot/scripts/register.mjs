import 'node:process';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(import.meta.dirname, '../.env') });

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const APP_ID = process.env.DISCORD_APPLICATION_ID;

console.log('DISCORD_TOKEN', DISCORD_TOKEN);
console.log('APP_ID', APP_ID);

if (!DISCORD_TOKEN || !APP_ID) {
  console.error('Missing DISCORD_TOKEN or DISCORD_APPLICATION_ID envs');
  process.exit(1);
}

const commands = [
  {
    name: 'zarifa',
    description: 'Query Zarifa AI search',
    type: 1,
    options: [
      {
        name: 'q',
        description: 'Query text',
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: 'search',
    description: 'Search index',
    type: 1,
    options: [
      {
        name: 'q',
        description: 'Query text',
        type: 3,
        required: true,
      },
    ],
  },
];

async function upsertGlobalCommands() {
  const url = `https://discord.com/api/v10/applications/${APP_ID}/commands`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${DISCORD_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('Failed to register commands:', res.status, text);
    process.exit(1);
  }
  console.log('Registered commands:', await res.json());
}

upsertGlobalCommands().catch((e) => {
  console.error(e);
  process.exit(1);
});
