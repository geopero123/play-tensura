import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5180, strictPort: true, host: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] }
      }
    }
  }
});
