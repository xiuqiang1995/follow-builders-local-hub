import { runSync } from '../lib/sync';

async function main() {
  const announce = process.argv.includes('--announce');

  try {
    const result = await runSync({ announce });
    console.log(JSON.stringify({ status: 'ok', ...result }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ status: 'error', message }, null, 2));
    process.exitCode = 1;
  }
}

void main();
