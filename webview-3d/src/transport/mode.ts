// webview-3d/src/transport/mode.ts
export type TransportMode = 'demo' | 'live';

export function resolveMode(search: string, envDemo: string | undefined): TransportMode {
  const params = new URLSearchParams(search);
  if (params.has('demo')) return params.get('demo') === '0' ? 'live' : 'demo';
  return envDemo === '1' ? 'demo' : 'live';
}

export function resolveDemoSpeed(search: string): number {
  const raw = Number(new URLSearchParams(search).get('demoSpeed'));
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(raw, 20);
}

/** Director mode: on by default in demo, off in live; `?director=1|0` overrides. */
export function resolveDirector(search: string, mode: TransportMode): boolean {
  const v = new URLSearchParams(search).get('director');
  if (v === '1') return true;
  if (v === '0') return false;
  return mode === 'demo';
}
