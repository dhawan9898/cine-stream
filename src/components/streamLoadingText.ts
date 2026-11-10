// streamLoadingText.ts - The status line on the loading screen, by how long the lookup has run.

export function loadingMessage(elapsedMs: number): string {
  if (elapsedMs < 2500) return 'Starting…';
  if (elapsedMs < 6000) return 'Finding the best server…';
  if (elapsedMs < 11000) return 'Still looking - trying other servers…';
  return 'This one is taking longer than usual…';
}
