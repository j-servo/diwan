// webview-3d/vite/redirectUpstreamTransport.ts
import type { Plugin } from 'vite';

export function shouldRedirect(
  resolvedId: string | null | undefined,
  upstreamTransportPath: string,
): boolean {
  if (!resolvedId) return false;
  return resolvedId.split('?')[0] === upstreamTransportPath;
}

/**
 * Upstream modules (useExtensionMessages, App) import a singleton `transport` from
 * webview-ui/src/transport/index.ts. Point every such import at ours, so live/demo
 * selection and world filtering apply without editing upstream files.
 */
export function redirectUpstreamTransport(
  upstreamTransportPath: string,
  ourTransportPath: string,
): Plugin {
  return {
    name: 'diwan-redirect-upstream-transport',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !source.includes('transport/index')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return shouldRedirect(resolved?.id, upstreamTransportPath) ? ourTransportPath : null;
    },
  };
}
