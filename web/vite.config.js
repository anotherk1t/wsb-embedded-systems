import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: '/static/',
  build: {
    outDir: path.resolve(__dirname, '../server/static'),
    emptyOutDir: true,
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1500,
  },
  server: {
    proxy: {
      '/api': 'http://164.92.227.240',
      '/ws': {
        target: 'ws://164.92.227.240',
        ws: true,
      },
    },
  },
});
