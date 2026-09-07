import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps asset URLs relative, so the build works at any path (e.g. GitHub Pages /Game/).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    proxy: { '/socket.io': { target: 'http://localhost:3000', ws: true }, '/api': 'http://localhost:3000' },
    fs: { allow: ['.'] },
  },
  build: { outDir: 'dist', sourcemap: false },
});
