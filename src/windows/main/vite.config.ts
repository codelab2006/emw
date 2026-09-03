import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 15173,
    strictPort: true,
  },
});
