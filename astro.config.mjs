import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://test-fas.ru',
  compressHTML: true,
  build: {
    inlineStylesheets: 'auto',
    // Avoid the default `/_astro/` path — an easy fingerprint for recon scanners.
    assets: 'assets',
  },
});
