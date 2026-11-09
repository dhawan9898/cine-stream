// streamTimings.ts - Where the time goes when a title is resolved.
//
// Every lookup is split into phases, each timed:
//   extract  a provider answering with an embed page or a direct stream
//            (outcome: direct | embed | none | timeout)
//   sniff    turning an embed page into a direct stream (native only)
//            (outcome: sniffed | failed)
//   webview  getting a hidden WebView for the sniff (outcome: pooled | cold)
//   page     that WebView loading the embed page (outcome: ok | none)
//   stream   from loading the page to its first stream request
//   lookup   the whole resolve for a title, from request to a stream the player
//            can use (outcome: ok | fail | cache)
// The last events are kept (and saved) so Settings can show a breakdown.

export type TimingPhase = 'extract' | 'sniff' | 'webview' | 'page' | 'stream' | 'lookup';
export type TimingOutcome = 'direct' | 'embed' | 'none' | 'timeout' | 'sniffed' | 'failed' | 'ok' | 'fail' | 'cache' | 'pooled' | 'cold';

export interface TimingEvent {
  at: number;
  phase: TimingPhase;
  ms: number;
  outcome: TimingOutcome;
  serverId?: string;
  titleId?: number;
  title?: string;
  /** Background prefetch lookups never sniff, so they are reported apart. */
  background?: boolean;
}

const KEY = 'cinestream_stream_timings_v1';
const MAX_EVENTS = 300;
let events: TimingEvent[] | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function load(): TimingEvent[] {
  if (events) return events;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    events = Array.isArray(parsed) ? parsed : [];
  } catch {
    events = [];
  }
  return events!;
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    try { localStorage.setItem(KEY, JSON.stringify(load())); } catch { /* storage unavailable */ }
  }, 2000);
}

export function recordTiming(e: Omit<TimingEvent, 'at'>): void {
  const list = load();
  list.push({ ...e, ms: Math.max(0, Math.round(e.ms)), at: Date.now() });
  if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS);
  scheduleSave();
}

export function getTimings(): TimingEvent[] {
  return load().slice();
}

export function clearTimings(): void {
  events = [];
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

const percentile = (sorted: number[], p: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];

export interface PhaseStats { count: number; median: number; p90: number; max: number }

export function statsOf(values: number[]): PhaseStats {
  const s = values.slice().sort((a, b) => a - b);
  return { count: s.length, median: percentile(s, 0.5), p90: percentile(s, 0.9), max: s.length ? s[s.length - 1] : 0 };
}

export interface ServerSummary {
  serverId: string;
  /** Time for the provider to answer (embed page or direct stream). */
  extract: PhaseStats;
  /** Of those answers: how many were embeds, direct streams, nothing, timeouts. */
  outcomes: Record<string, number>;
  /** Time to turn this provider's embed page into a stream. */
  sniff: PhaseStats;
  sniffed: number;
  sniffFailed: number;
  /** The sniff, split up: getting a WebView, loading the embed page, finding the stream request. */
  webview: PhaseStats;
  pooled: number;
  cold: number;
  page: PhaseStats;
  stream: PhaseStats;
}

export interface TimingSummary {
  servers: ServerSummary[];
  /** Whole lookups the user waited on (foreground), by outcome. */
  lookups: { stats: PhaseStats; ok: number; fail: number; cache: number };
  /** Whole lookups run in the background. */
  background: { stats: PhaseStats; ok: number; fail: number };
  recent: TimingEvent[];
}

export function summarize(list: TimingEvent[] = getTimings()): TimingSummary {
  const ids = Array.from(new Set(list.filter(e => e.serverId).map(e => e.serverId!))).sort();
  const servers = ids.map<ServerSummary>(serverId => {
    const mine = list.filter(e => e.serverId === serverId);
    const extract = mine.filter(e => e.phase === 'extract');
    const sniff = mine.filter(e => e.phase === 'sniff');
    const outcomes: Record<string, number> = {};
    extract.forEach(e => { outcomes[e.outcome] = (outcomes[e.outcome] ?? 0) + 1; });
    return {
      serverId,
      extract: statsOf(extract.map(e => e.ms)),
      outcomes,
      sniff: statsOf(sniff.map(e => e.ms)),
      sniffed: sniff.filter(e => e.outcome === 'sniffed').length,
      sniffFailed: sniff.filter(e => e.outcome === 'failed').length,
      webview: statsOf(mine.filter(e => e.phase === 'webview').map(e => e.ms)),
      pooled: mine.filter(e => e.phase === 'webview' && e.outcome === 'pooled').length,
      cold: mine.filter(e => e.phase === 'webview' && e.outcome === 'cold').length,
      page: statsOf(mine.filter(e => e.phase === 'page' && e.outcome === 'ok').map(e => e.ms)),
      stream: statsOf(mine.filter(e => e.phase === 'stream').map(e => e.ms))
    };
  });
  const lookups = list.filter(e => e.phase === 'lookup');
  const fg = lookups.filter(e => !e.background);
  const bg = lookups.filter(e => e.background);
  return {
    servers,
    lookups: {
      stats: statsOf(fg.filter(e => e.outcome !== 'cache').map(e => e.ms)),
      ok: fg.filter(e => e.outcome === 'ok').length,
      fail: fg.filter(e => e.outcome === 'fail').length,
      cache: fg.filter(e => e.outcome === 'cache').length
    },
    background: {
      stats: statsOf(bg.map(e => e.ms)),
      ok: bg.filter(e => e.outcome === 'ok').length,
      fail: bg.filter(e => e.outcome === 'fail').length
    },
    recent: lookups.slice(-8).reverse()
  };
}

const sec = (ms: number) => (ms / 1000).toFixed(2) + 's';

/** A plain-text report of the summary, for copying into a bug report. */
export function formatTimingReport(summary: TimingSummary = summarize()): string {
  const lines: string[] = ['CineStream stream timing report', ''];
  lines.push('Per provider - time to get an answer (embed page or direct stream):');
  for (const s of summary.servers) {
    const o = Object.entries(s.outcomes).map(([k, v]) => `${k}:${v}`).join(' ') || 'no answers';
    lines.push(`  ${s.serverId}: median ${sec(s.extract.median)}, p90 ${sec(s.extract.p90)}, max ${sec(s.extract.max)} (${s.extract.count}x; ${o})`);
    if (s.sniff.count > 0) {
      lines.push(`    embed -> stream: median ${sec(s.sniff.median)}, p90 ${sec(s.sniff.p90)} (${s.sniffed} ok, ${s.sniffFailed} failed)`);
      lines.push(`      WebView ready ${sec(s.webview.median)} (${s.pooled} reused, ${s.cold} new) + page load ${sec(s.page.median)} + stream request ${sec(s.stream.median)} after page load`);
    }
  }
  const l = summary.lookups;
  lines.push('', `Whole lookup the user waited on: median ${sec(l.stats.median)}, p90 ${sec(l.stats.p90)} (${l.ok} ok, ${l.fail} failed, ${l.cache} served from the saved links)`);
  const b = summary.background;
  lines.push(`Background lookups: median ${sec(b.stats.median)} (${b.ok} ok, ${b.fail} failed)`);
  if (summary.recent.length) {
    lines.push('', 'Latest lookups:');
    summary.recent.forEach(e => lines.push(`  ${e.title ?? e.titleId ?? '?'}: ${sec(e.ms)} ${e.outcome}${e.serverId ? ` via ${e.serverId}` : ''}${e.background ? ' (background)' : ''}`));
  }
  return lines.join('\n');
}
