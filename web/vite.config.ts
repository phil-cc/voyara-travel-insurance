import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      // Vite only serves flow/index.html at /flow/, so send /flow there instead of the root fallback page.
      name: 'flow-trailing-slash',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/flow' || req.url?.startsWith('/flow?')) {
            res.writeHead(301, { Location: req.url.replace('/flow', '/flow/') }).end();
            return;
          }
          next();
        });
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      // Used by the /flow walkthrough only. changeOrigin keeps the Host header inside the MCP SDK's allow-list.
      '/mcp': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      input: ['index.html', 'quote/index.html', 'quote/results/index.html', 'checkout/index.html', 'flow/index.html'],
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'jsdom',
  },
});
