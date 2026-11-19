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

/**
 * The language file matching the preferred audio, or the stream as resolved.
 *
 * A file of the same provider is always fine (another language of the same release). Another
 * provider's file is taken only when `allowOtherSource` - the viewer chose the audio language in
 * Settings: just because a title is Telugu, the elected stream (best print and resolution, see
 * streamElection.ts) must not be swapped for a worse copy from elsewhere; it stays a choice under Audio.
 */
export function pickAudio(
  stream: ExtractedStream,
  preferredLang: string,
  options: { allowOtherSource?: boolean } = {}
): { url: string; qualities: ExtractedStream['qualities']; headers?: Record<string, string> } {
  const { allowOtherSource = true } = options;
  const code = (preferredLang || '').toLowerCase().trim();
  const wanted = code ? (LANGUAGE_NAMES[code]?.toLowerCase() || code) : undefined;
  if (!wanted) return { url: stream.url, qualities: stream.qualities };

  // Already playing it (one language, or a multi-audio file that has it among its tracks).
  if (stream.languages?.some(l => l.toLowerCase() === wanted)) return { url: stream.url, qualities: stream.qualities };

  // "Hindi + Telugu" (a multi-audio file) matches either language.
  const matches = (a: { label?: string; language?: string }) => {
    const names = `${a.language || ''} + ${a.label || ''}`.toLowerCase().split(/\s*[+/,&]\s*/).map(n => n.trim());
    return names.some(n => n === wanted || n === code || n.startsWith(`${wanted} `) || n.startsWith(`${wanted}(`));
  };

  // 1. Same-source matching audio variant
  const sameSourceAudio = stream.audios?.find(a => !a.otherSource && matches(a));
  if (sameSourceAudio) {
    return { url: sameSourceAudio.url, qualities: sameSourceAudio.qualities, headers: sameSourceAudio.headers };
  }

  // 2. Another provider's release in that language (only when the viewer asked for the language)
  const anySourceAudio = allowOtherSource ? stream.audios?.find(matches) : undefined;
  if (anySourceAudio) {
    return { url: anySourceAudio.url, qualities: anySourceAudio.qualities, headers: anySourceAudio.headers };
  }

  return { url: stream.url, qualities: stream.qualities };
}

/** The rendition matching the "Default Quality" preference, when the stream offers it. */
export function applyPreferredQuality(
  picked: { url: string; qualities: ExtractedStream['qualities']; headers?: Record<string, string> },
  defaultQuality: string
): { url: string; qualities: ExtractedStream['qualities']; headers?: Record<string, string> } {
  if (!defaultQuality || defaultQuality === 'Auto') return picked;
  const match = picked.qualities?.find(q => q.quality === defaultQuality);
  return match && match.url !== picked.url ? { ...picked, url: match.url } : picked;
}
