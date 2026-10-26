// tvNavigationService.ts - Spatial D-Pad Navigation Listener for Android TV & Keyboard Remotes
import { useEffect } from 'react';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [role="button"], a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

function getActiveScopes(): ParentNode[] {
  // 1. Topmost modal or dialog if open
  const modals = Array.from(document.querySelectorAll<HTMLElement>('[data-modal-root="true"]'));
  if (modals.length > 0) {
    return [modals[modals.length - 1]];
  }

  // 2. Active full-screen video player if open
  const player = document.querySelector<HTMLElement>('.nf-player, .player-state');
  if (player) {
    return [player];
  }

  const scopes: ParentNode[] = [];

  // 3. Topmost active overlay screen (MediaDetailScreen or BrowseScreen)
  const overlays = Array.from(document.querySelectorAll<HTMLElement>('.overlay:not(.leaving)'));
  if (overlays.length > 0) {
    scopes.push(overlays[overlays.length - 1]);
  } else {
    // 4. Otherwise, only the currently active tab pane
    const activeTab = document.querySelector<HTMLElement>('.tab-pane[data-active="true"]');
    if (activeTab) scopes.push(activeTab);
  }

  // Include the floating dock when visible
  const dock = document.querySelector<HTMLElement>('.dock-wrap:not(.hidden)');
  if (dock) scopes.push(dock);

  return scopes.length > 0 ? scopes : [document];
}

function isElementVisible(el: HTMLElement): boolean {
  if (el.offsetWidth <= 0 || el.offsetHeight <= 0) return false;
  if (el.closest('[data-active="false"], [aria-hidden="true"], .leaving')) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.pointerEvents !== 'none';
}

export function useTvNavigation(enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore text inputs
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (!keys.includes(e.code)) return;

      const scopes = getActiveScopes();
      const interactiveEls = scopes
        .flatMap(scope => Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)))
        .filter(isElementVisible);

      if (interactiveEls.length === 0) return;

      const activeEl = document.activeElement as HTMLElement | null;
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
