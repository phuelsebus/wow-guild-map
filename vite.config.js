import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER = `http://localhost:${process.env.GUILDMAP_PORT || 3001}`;

export default defineConfig({
  root: 'web',
  envDir: '..', // .env-Dateien im Projektordner
  base: process.env.VITE_BASE || '/', // GitHub Pages: /<repo-name>/
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': SERVER,
      '/ws': { target: SERVER.replace('http', 'ws'), ws: true },
    },
  },
});
