// test-streams.ts - CLI stream verification runner (supports dynamic title argument or default suite)
import { extractorRegistry } from '../src/extractors/extractorRegistry.ts';

const TMDB_KEY = '90b2cae8d7161e8ba0f3836240d7d352';
const TMDB_BASE = 'https://api.themoviedb.org/3';

interface TmdbResult {
  id: number;
  media_type?: 'movie' | 'tv';
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  original_language?: string;
}

export const DEFAULT_TEST_TITLES = [
  { name: 'Fight Club', id: 550, type: 'movie' as const },
  { name: 'Interstellar', id: 157336, type: 'movie' as const },
  { name: 'Avengers: Infinity War', id: 299536, type: 'movie' as const },
  { name: 'Pushpa 2: The Rule', id: 845781, type: 'movie' as const, language: 'te' },
  { name: 'Most Eligible Bachelor', id: 622416, type: 'movie' as const, language: 'te' },
  { name: 'Thella Kaagitham', id: 1456196, type: 'movie' as const, language: 'te' },
  { name: 'Stranger Things S1E1', id: 66732, type: 'tv' as const, season: 1, episode: 1 },
  { name: 'Game of Thrones S1E1', id: 1399, type: 'tv' as const, season: 1, episode: 1 }
];

function parseQuery(rawQuery: string): { cleanTitle: string; season: number; episode: number } {
  let season = 1;
  let episode = 1;
  let cleanTitle = rawQuery.trim();

  const sEpMatch =
    cleanTitle.match(/\bS(\d+)\s*E(\d+)\b/i) ||
    cleanTitle.match(/\b(\d+)x(\d+)\b/i) ||
    cleanTitle.match(/\bSeason\s*(\d+)\s*Episode\s*(\d+)\b/i);

  if (sEpMatch) {
    season = parseInt(sEpMatch[1], 10);
    episode = parseInt(sEpMatch[2], 10);
    cleanTitle = cleanTitle.replace(sEpMatch[0], '').trim();
  }

  return { cleanTitle: cleanTitle || rawQuery.trim(), season, episode };
}

async function searchTmdb(query: string): Promise<{ result: TmdbResult | null; type: 'movie' | 'tv' }> {
  // Correct common spelling typos before searching TMDB
  const fixedQuery = query
    .replace(/bachilor/gi, 'bachelor')
    .replace(/kagitam|kaagidham/gi, 'kaagitham');

  let url = `${TMDB_BASE}/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(fixedQuery)}&include_adult=false`;
  let res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB Search failed with status ${res.status}`);
  let data = await res.json();
  let results: TmdbResult[] = data.results || [];

  if (results.length === 0 && fixedQuery !== query) {
    url = `${TMDB_BASE}/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(query)}&include_adult=false`;
    res = await fetch(url);
    if (res.ok) {
      data = await res.json();
      results = data.results || [];
    }
  }

  const item = results.find(r => r.media_type === 'movie' || r.media_type === 'tv') ?? results[0] ?? null;
  const type: 'movie' | 'tv' = item?.media_type === 'tv' ? 'tv' : 'movie';
  return { result: item, type };
}

async function testSingleTitle(rawQuery: string) {
  const { cleanTitle, season, episode } = parseQuery(rawQuery);

  console.log('================================================================================');
  console.log(` SEARCHING TMDB FOR: "${cleanTitle}"${season ? ` (Season ${season}, Episode ${episode})` : ''}`);
  console.log('================================================================================');

  const { result, type } = await searchTmdb(cleanTitle);

  if (!result) {
    console.log(`[ERROR]: No TMDB match found for "${cleanTitle}". Please check title spelling.`);
    return;
  }

  const matchedName = result.title || result.name || result.original_title || result.original_name || cleanTitle;
  const releaseYear = (result.release_date || result.first_air_date || '').split('-')[0] || 'Unknown';
  const lang = result.original_language || 'en';

  console.log(`\n[TMDB MATCH FOUND]:`);
  console.log(`  Title: ${matchedName} (${releaseYear})`);
  console.log(`  TMDB ID: ${result.id}`);
  console.log(`  Type: ${type.toUpperCase()}`);
  console.log(`  Original Language: ${lang}`);
  console.log('--------------------------------------------------------------------------------\n');

  console.log(`RESOLVING STREAMS ACROSS ALL EXTRACTORS...\n`);

  const allStreams = await extractorRegistry.resolveAllStreams({
    id: result.id,
    type,
    season,
    episode,
    title: matchedName,
    language: lang
  });

  console.log(`Responses from Providers (${allStreams.length} total):`);
  for (const s of allStreams) {
    const isDirect = !s.isFallbackEmbed;
    const typeLabel = isDirect ? '[DIRECT STREAM DATA (.m3u8/.mp4)]' : '[IFRAME EMBED LINK]';
    console.log(`  * ${s.serverName} (${s.serverId}): ${typeLabel}`);
    console.log(`    URL: ${s.url}`);
  }

  const bestStream = await extractorRegistry.resolveBestStream({
    id: result.id,
    type,
    season,
    episode,
    title: matchedName,
    language: lang
  });

  const isDirectData = Boolean(bestStream && !bestStream.isFallbackEmbed && bestStream.url);

  console.log('\n================================================================================');
  console.log(' FINAL STREAM RESOLUTION RESULT:');
  console.log('================================================================================');

  if (isDirectData && bestStream) {
    console.log(' STATUS: [PASS - DIRECT STREAM DATA EXTRACTED]');
    console.log(`  Selected Server: ${bestStream.serverName} (${bestStream.serverId})`);
    console.log(`  Direct Stream URL: ${bestStream.url}`);
    console.log(`  Format: ${bestStream.format}`);
    console.log(`  Quality: ${bestStream.quality || '1080p'}`);
  } else {
    console.log(' STATUS: [FAIL - RETURNED IFRAME EMBED LINK]');
    console.log(`  Selected Server: ${bestStream?.serverName || 'None'} (${bestStream?.serverId || 'none'})`);
    console.log(`  Embed URL: ${bestStream?.url || 'None'}`);
  }

  console.log('================================================================================\n');
}

async function runDefaultSuite() {
  console.log('================================================================================');
  console.log(' CINESTREAM DIRECT STREAM DATA EXTRACTION VERIFICATION SUITE');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;

  for (const t of DEFAULT_TEST_TITLES) {
    console.log(`>>> Testing Title: "${t.name}" (${t.type.toUpperCase()} TMDB ID: ${t.id})`);

    try {
      const best = await extractorRegistry.resolveBestStream({
        id: t.id,
        type: t.type,
        season: t.season,
        episode: t.episode,
        title: t.name,
        language: t.language
      });

      const isDirectStreamData = Boolean(best && !best.isFallbackEmbed && best.url);

      if (isDirectStreamData && best) {
        passed++;
        console.log(`    [PASS - DIRECT STREAM DATA EXTRACTED]`);
        console.log(`      Server Name: ${best.serverName} (${best.serverId})`);
        console.log(`      Direct Stream URL: ${best.url}`);
        console.log(`      Format: ${best.format}, Quality: ${best.quality || '1080p'}`);
      } else {
        failed++;
        console.log(`    [FAIL - RETURNED IFRAME EMBED LINK]`);
        console.log(`      Server Name: ${best?.serverName || 'None'} (${best?.serverId || 'none'})`);
        console.log(`      Embed URL: ${best?.url || 'None'}`);
      }
    } catch (err: any) {
      failed++;
      console.log(`    [ERROR]: ${err.message}`);
    }

    console.log('--------------------------------------------------------------------------------\n');
  }

  console.log('================================================================================');
  console.log(` SUMMARY: ${passed} / ${DEFAULT_TEST_TITLES.length} titles extracted DIRECT STREAM DATA.`);
  console.log('================================================================================\n');
}

async function main() {
  const rawArgs = process.argv.slice(2).join(' ');
  if (rawArgs) {
    await testSingleTitle(rawArgs);
  } else {
    await runDefaultSuite();
  }
}

main();
