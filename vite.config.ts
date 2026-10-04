import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Local development only: forward /ws to the game server so the page stays same-origin.
  const env = loadEnv(mode, process.cwd(), '');
  const proxy = {
    '/ws': { target: `ws://127.0.0.1:${env.WRECKYARD_SERVER_PORT || '8787'}`, ws: true },
  };
  return {
    base: './',
    build: { target: 'es2022', chunkSizeWarningLimit: 650 },
    server: { proxy },
  };
});
