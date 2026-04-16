import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: resolve(rootDir, 'src/web'),
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(rootDir, 'src/shared'),
    },
  },
  build: {
    outDir: resolve(rootDir, 'dist/web'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
