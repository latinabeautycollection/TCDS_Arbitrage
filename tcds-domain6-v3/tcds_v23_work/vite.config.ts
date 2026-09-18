import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import {
  createScanditPrecacheEntries,
  SCANDIT_MAXIMUM_FILE_SIZE_TO_CACHE_BYTES,
} from './config/vite/scanditPwaPrecache';

export default defineConfig({
  plugins: [
    react(),
    // Domain 6.2A: make the certified Scandit runtime available to the PWA.
    VitePWA({
      // src/main.tsx already registers /sw.js itself. Do not inject a second registration.
      injectRegister: null,
      // The new worker waits and activates on the next controlled reload, so a
      // warehouse operator is never interrupted by a forced refresh.
      registerType: 'prompt',
      // The existing public/manifest.webmanifest remains authoritative.
      manifest: false,
      workbox: {
        // 6.2A precaches the Scandit runtime only. Application assets and warehouse
        // data are deliberately excluded; offline transaction behaviour is not 6.2A.
        globPatterns: [],
        additionalManifestEntries: createScanditPrecacheEntries(),
        maximumFileSizeToCacheInBytes: SCANDIT_MAXIMUM_FILE_SIZE_TO_CACHE_BYTES,
      },
    }),
  ],
  server: { port: 5173 },
  preview: { port: 4173 },
});
