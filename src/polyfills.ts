// polyfills.ts - Node globals the Telegram client (GramJS) expects. The
// Android WebView and browsers have no Buffer, which crashed Settings with
// "Buffer is not defined". Must be the first import in main.tsx.
import { Buffer } from 'buffer';

const g = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;
