import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

import { isAllowedLocalUpgrade } from './vite/localOrigin.ts';
import { redirectUpstreamTransport } from './vite/redirectUpstreamTransport.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPort = process.env['DIWAN_SERVER_PORT'] ?? '3200';

export default defineConfig({
  plugins: [
    react(),
    redirectUpstreamTransport(
      path.resolve(here, '../webview-ui/src/transport/index.ts'),
      path.resolve(here, 'src/transport/index.ts'),
    ),
  ],
  base: './',
  build: { outDir: path.resolve(here, '../dist/webview-3d'), emptyOutDir: true },
  server: {
    fs: { allow: [path.resolve(here, '..')] },
    proxy: {
      // Live mode in dev: forward to the running `diwan` server.
      // Check: the dev server does no Host/Origin check of its own, so without this any
      // website could open a socket through us to the local server. bypass:false answers 404
      // unless the Host is loopback and any Origin matches it (same-origin only).
      // Strip: the server's /ws gate rejects cross-origin browser handshakes but accepts a
      // missing Origin (server/src/httpServer.ts isAllowedWebSocketOrigin), and the Origin we
      // saw is our own port, not the server's, so drop it on the allowed hop.
      '/ws': {
        target: `ws://127.0.0.1:${serverPort}`,
        ws: true,
        bypass: (req) =>
          isAllowedLocalUpgrade(req.headers.origin, req.headers.host) ? undefined : false,
        configure: (proxy) => {
          proxy.on('proxyReqWs', (proxyReq) => proxyReq.removeHeader('origin'));
        },
      },
    },
  },
});
