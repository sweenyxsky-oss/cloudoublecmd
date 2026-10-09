import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Static SPA for self-hosting on TrueNAS; the hosted Lovable build keeps vite.config.ts.
export default defineConfig({
  root: fileURLToPath(new URL('./nas', import.meta.url)),
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: { 'import.meta.env.VITE_NAS_MODE': JSON.stringify('1') },
  build: { outDir: fileURLToPath(new URL('./services/truenas-access/public', import.meta.url)), emptyOutDir: true, sourcemap: false },
});
