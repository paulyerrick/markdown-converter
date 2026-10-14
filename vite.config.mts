import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [tailwindcss()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  build: {
    outDir: 'renderer-ui', emptyOutDir: true, target: 'chrome130',
    lib: { entry: 'frontend/main.tsx', name: 'MarkdownConverter', formats: ['iife'], fileName: () => 'app.js', cssFileName: 'style' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
