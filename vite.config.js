import { defineConfig } from 'vite';

// INLINE_MODEL=1 intègre le modèle 3D (1,7 Mo) dans le bundle JS en data URL.
const inlineModel = process.env.INLINE_MODEL === '1';

export default defineConfig({
  base: './',
  assetsInclude: ['**/*.glb'],
  build: {
    outDir: 'dist',
    assetsInlineLimit: inlineModel ? 8 * 1024 * 1024 : 4096,
    chunkSizeWarningLimit: 4000,
  },
});
