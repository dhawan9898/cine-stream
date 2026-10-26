// tvNavigationService.ts - Spatial D-Pad Navigation Listener for Android TV & Keyboard Remotes
import { useEffect } from 'react';

export function useTvNavigation(enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore text inputs
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (!keys.includes(e.code)) return;

      const activeEl = document.activeElement as HTMLElement;
      const interactiveEls = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button, [role="button"], a, input, select, textarea, [tabindex="0"]'
        )
      ).filter(el => el.offsetWidth > 0 && el.offsetHeight > 0);

      if (interactiveEls.length === 0) return;

      if (!activeEl || !interactiveEls.includes(activeEl)) {
        interactiveEls[0].focus();
        e.preventDefault();
        return;
      }

      const activeRect = activeEl.getBoundingClientRect();
      let bestNext: HTMLElement | null = null;
      let minDistance = Infinity;

      interactiveEls.forEach(el => {
        if (el === activeEl) return;
        const rect = el.getBoundingClientRect();

        let isCandidate = false;
        let dist = 0;

        switch (e.code) {
          case 'ArrowUp':
            isCandidate = rect.bottom <= activeRect.top + 10;
            dist = Math.abs(rect.left - activeRect.left) + Math.abs(activeRect.top - rect.bottom);
            break;
          case 'ArrowDown':
            isCandidate = rect.top >= activeRect.bottom - 10;
            dist = Math.abs(rect.left - activeRect.left) + Math.abs(rect.top - activeRect.bottom);
            break;
          case 'ArrowLeft':
            isCandidate = rect.right <= activeRect.left + 10;
            dist = Math.abs(rect.top - activeRect.top) + Math.abs(activeRect.left - rect.right);
            break;
          case 'ArrowRight':
            isCandidate = rect.left >= activeRect.right - 10;
            dist = Math.abs(rect.top - activeRect.top) + Math.abs(rect.left - activeRect.right);
            break;
        }

        if (isCandidate && dist < minDistance) {
          minDistance = dist;
          bestNext = el;
        }
      });

      if (bestNext) {
        (bestNext as HTMLElement).focus();
        (bestNext as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}
