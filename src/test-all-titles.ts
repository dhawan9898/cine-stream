import { resolveStream } from './services/streamResolver.ts';

async function testTitle(name: string, params: { id: number; type: 'movie' | 'tv'; season?: number; episode?: number }) {
  try {
    const res = await resolveStream(params);
    console.log(`[PASS] ${name}:`);
    console.log(`  -> URL: ${res.url}`);
    console.log(`  -> Format: ${res.format}, isFallbackEmbed: ${res.isFallbackEmbed ?? false}`);
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err instanceof Error ? err.message : String(err));
  }
}

async function run() {
  console.log('=== Verifying Multi-Title Stream Resolution ===');
  await testTitle('Fight Club (Movie 550)', { id: 550, type: 'movie' });
  await testTitle('Avengers: Infinity War (Movie 299536)', { id: 299536, type: 'movie' });
  await testTitle('Interstellar (Movie 157336)', { id: 157336, type: 'movie' });
  await testTitle('Game of Thrones S1E1 (TV 1399)', { id: 1399, type: 'tv', season: 1, episode: 1 });
  await testTitle('Stranger Things S1E1 (TV 66732)', { id: 66732, type: 'tv', season: 1, episode: 1 });
  await testTitle('Arcane S1E1 (TV 94605)', { id: 94605, type: 'tv', season: 1, episode: 1 });
}

run();
