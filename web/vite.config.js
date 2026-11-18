import { defineConfig } from 'vite';

export default defineConfig({
  server: { proxy: { '/api': process.env.API_URL || 'http://localhost:3001' }, port: 5173, strictPort: true, watch: { usePolling: !!process.env.CHOKIDAR_USEPOLLING } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
