import { resolveStream } from './services/streamResolver.ts';

resolveStream({ id: 550, type: 'movie' }).then(res => {
  console.log('SUCCESS! Resolved Direct Stream URL:', res.url);
  console.log('Format:', res.format);
}).catch(err => {
  console.error('FAILED:', err);
});
