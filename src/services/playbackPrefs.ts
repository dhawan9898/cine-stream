// playbackPrefs.ts - Applies the viewer's audio / subtitle language and
// data-saver preferences to a resolved stream before it reaches the player.
import type { PlayerSubtitle } from '../plugins/exoPlayerPlugin.ts';
import type { ExtractedStream, ExtractorSubtitle } from '../providers/extractors/types.ts';
import { LANGUAGE_NAMES } from '../providers/extractors/variantDiscovery.ts';

export function subtitlesForPlayer(subs: ExtractorSubtitle[] | undefined, preferredLang: string): PlayerSubtitle[] {
  const list = subs ?? [];
  const wanted = preferredLang ? LANGUAGE_NAMES[preferredLang.toLowerCase()]?.toLowerCase() : undefined;
  const matchIdx = wanted
    ? list.findIndex(t => (t.label || '').toLowerCase().startsWith(wanted) || (t.lang || '').toLowerCase() === wanted)
    : -1;
  return list.map((t, i) => ({
    src: t.url,
    label: t.label || t.lang || 'Subtitle',
    // Preferred language on; otherwise only subtitles the stream itself carries.
    default: matchIdx >= 0 ? i === matchIdx : i === 0 && !t.mimeType
  }));
}

/** The language file matching the preferred audio, or the stream as resolved. */
export function pickAudio(stream: ExtractedStream, preferredLang: string): { url: string; qualities: ExtractedStream['qualities'] } {
  const wanted = preferredLang ? LANGUAGE_NAMES[preferredLang.toLowerCase()] : undefined;
  const audio = wanted ? stream.audios?.find(a => a.label === wanted || a.language === wanted) : undefined;
  return audio
    ? { url: audio.url, qualities: audio.qualities }
    : { url: stream.url, qualities: stream.qualities };
}

/** The rendition matching the "Default Quality" preference, when the stream offers it. */
export function applyPreferredQuality(
  picked: { url: string; qualities: ExtractedStream['qualities'] },
  defaultQuality: string
): { url: string; qualities: ExtractedStream['qualities'] } {
  if (!defaultQuality || defaultQuality === 'Auto') return picked;
  const match = picked.qualities?.find(q => q.quality === defaultQuality);
  return match && match.url !== picked.url ? { ...picked, url: match.url } : picked;
}
