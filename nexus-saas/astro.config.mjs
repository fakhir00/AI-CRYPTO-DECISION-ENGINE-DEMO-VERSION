import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://nexus-crypto.example.com',
  trailingSlash: 'always',
  integrations: [
    tailwind(),
    sitemap()
  ]
});
