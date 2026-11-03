// Offline checks for the registry's remembered-provider shortcut and the retired defaults.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); }
};
const { ExtractorRegistry } = await import('../src/extractors/extractorRegistry.ts');

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`); if (!ok) failed++; };

const calls: string[] = [];
const mk = (id: string, url: string | null, delay = 0) => ({
  id, name: id, mainUrl: '',
  extract: async () => { calls.push(id); await new Promise(r => setTimeout(r, delay)); return url ? { url, format: 'hls' as const } : null; }
});

const reg = new ExtractorRegistry(false);
reg.register(mk('a', null));
reg.register(mk('b', 'https://x/b.m3u8', 20));
reg.register(mk('c', 'https://x/c.m3u8', 20));
const params = { id: 1, type: 'movie' as const, directOnly: true, allowSniff: false };

await reg.resolveAllStreams(params);
check('first lookup queries every provider', calls.length === 3);

calls.length = 0;
const again = await reg.resolveAllStreams(params);
check('second lookup tries only the remembered provider', calls.length === 1 && again.length === 1);

calls.length = 0;
await reg.resolveAllStreams({ ...params, fresh: true });
check('fresh retry skips the shortcut', calls.length === 3);

const defaults = new ExtractorRegistry().getAllExtractors().map(e => e.id);
check('retired providers are not registered', !['rive', 'embedsu', 'smashy', 'insertunit'].some(id => defaults.includes(id)));
console.log(failed ? `\n${failed} failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
