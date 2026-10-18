/**
 * The viewer's `prefers-reduced-motion` setting, kept current. Decorative motion (the title's
 * breathing glow, the lilies' bobbing) holds still when it is set; the glow itself stays on.
 */
let query: MediaQueryList | null = null;
let current = false;

function init(): void {
  if (query || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  query = window.matchMedia('(prefers-reduced-motion: reduce)');
  current = query.matches;
  query.addEventListener('change', (e) => {
    current = e.matches;
  });
}

export function prefersReducedMotion(): boolean {
  init();
  return current;
}
