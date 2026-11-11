import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://svetlana-cleaning.local',
  compressHTML: true,
  build: {
    inlineStylesheets: 'auto',
  },
});
