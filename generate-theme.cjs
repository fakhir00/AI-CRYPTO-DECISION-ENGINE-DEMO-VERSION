const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dir = path.join(__dirname, 'nexus-saas');

if (!fs.existsSync(dir)){
    fs.mkdirSync(dir, { recursive: true });
}

// Helper to write files
function write(filePath, content) {
    const fullPath = path.join(dir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content.trim() + '\n');
}

// 1. package.json
write('package.json', `
{
  "name": "nexus-saas",
  "type": "module",
  "version": "0.0.1",
  "scripts": {
    "dev": "astro dev",
    "start": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "astro": "astro"
  },
  "dependencies": {
    "@astrojs/sitemap": "^3.1.2",
    "@astrojs/tailwind": "^5.1.0",
    "@tailwindcss/vite": "^4.0.0",
    "astro": "^4.5.0",
    "tailwindcss": "^4.0.0"
  }
}
`);

// 2. astro.config.mjs
write('astro.config.mjs', `
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
`);

// 3. tailwind.config.mjs
write('tailwind.config.mjs', `
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        primary: '#6C5CE7',
        dark: '#07090F',
        panel: '#0E1320',
        green: '#00E676',
        red: '#FF5252'
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      }
    },
  },
  plugins: [],
}
`);

// 4. src/styles/global.css
write('src/styles/global.css', `
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    @apply bg-dark text-white font-sans antialiased;
  }
}
`);

// 5. src/i18n/config.ts
write('src/i18n/config.ts', `
export const locales = ['en', 'hi', 'es', 'ru', 'fr', 'de', 'it', 'pt', 'bn', 'ja', 'ko', 'ms', 'pl', 'id', 'ar', 'bg', 'tr', 'sv'];
export const defaultLocale = 'en';

export const translations = {
  en: {
    'nav.home': 'Home',
    'nav.about': 'About Us',
    'nav.contact': 'Contact',
    'nav.blog': 'Blog',
    'hero.title': 'AI Crypto Decision Engine',
    'hero.subtitle': 'Smarter, faster, more profitable trades driven by quantitative AI and on-chain analytics.',
    'hero.cta': 'Get Started',
    'footer.rights': 'All rights reserved.',
  },
  es: {
    'nav.home': 'Inicio',
    'nav.about': 'Sobre Nosotros',
    'nav.contact': 'Contacto',
    'nav.blog': 'Blog',
    'hero.title': 'Motor de Decisiones Cripto con IA',
    'hero.subtitle': 'Operaciones más inteligentes y rápidas impulsadas por IA cuantitativa.',
    'hero.cta': 'Empezar',
    'footer.rights': 'Todos los derechos reservados.',
  }
  // Fallback to English for others in this demo
};

export function getLangFromUrl(url) {
  const [, lang] = url.pathname.split('/');
  if (locales.includes(lang)) return lang;
  return defaultLocale;
}

export function useTranslations(lang) {
  return function t(key) {
    return translations[lang]?.[key] || translations[defaultLocale][key];
  }
}
`);

// 6. src/layouts/BaseLayout.astro
write('src/layouts/BaseLayout.astro', `
---
import '../styles/global.css';
import Header from '../components/Header.astro';
import Footer from '../components/Footer.astro';
import { getLangFromUrl } from '../i18n/config';

const { title, description } = Astro.props;
const lang = getLangFromUrl(Astro.url);
const dir = lang === 'ar' ? 'rtl' : 'ltr';
---
<html lang={lang} dir={dir}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>{title} | NEXUS</title>
    <meta name="description" content={description} />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <script src="https://unpkg.com/feather-icons"></script>
  </head>
  <body class="min-h-screen flex flex-col">
    <Header />
    <main class="flex-grow container mx-auto px-4 py-8">
      <slot />
    </main>
    <Footer />
    <script>
      feather.replace();
    </script>
  </body>
</html>
`);

// 7. src/components/Header.astro
write('src/components/Header.astro', `
---
import { getLangFromUrl, useTranslations } from '../i18n/config';
const lang = getLangFromUrl(Astro.url);
const t = useTranslations(lang);
const prefix = lang === 'en' ? '' : \`/\${lang}\`;
---
<header class="bg-panel border-b border-gray-800 p-4">
  <div class="container mx-auto flex justify-between items-center">
    <a href={\`\${prefix}/\`} class="text-xl font-bold text-primary flex items-center gap-2">
      <i data-feather="hexagon"></i> NEXUS
    </a>
    <nav class="hidden md:flex gap-6">
      <a href={\`\${prefix}/\`} class="hover:text-primary">{t('nav.home')}</a>
      <a href={\`\${prefix}/about-us\`} class="hover:text-primary">{t('nav.about')}</a>
      <a href={\`\${prefix}/blog\`} class="hover:text-primary">{t('nav.blog')}</a>
      <a href={\`\${prefix}/contact-us\`} class="hover:text-primary">{t('nav.contact')}</a>
    </nav>
  </div>
</header>
`);

// 8. src/components/Footer.astro
write('src/components/Footer.astro', `
---
import { getLangFromUrl, useTranslations } from '../i18n/config';
const lang = getLangFromUrl(Astro.url);
const t = useTranslations(lang);
const year = new Date().getFullYear();
const prefix = lang === 'en' ? '' : \`/\${lang}\`;
---
<footer class="bg-panel border-t border-gray-800 p-8 mt-12">
  <div class="container mx-auto grid grid-cols-1 md:grid-cols-4 gap-8">
    <div>
      <h3 class="text-xl font-bold text-primary mb-4">NEXUS</h3>
      <p class="text-gray-400">Advanced quantitative crypto trading intelligence.</p>
    </div>
    <div>
      <h4 class="font-bold mb-4">Links</h4>
      <ul class="space-y-2 text-gray-400">
        <li><a href={\`\${prefix}/about-us\`} class="hover:text-white">{t('nav.about')}</a></li>
        <li><a href={\`\${prefix}/contact-us\`} class="hover:text-white">{t('nav.contact')}</a></li>
        <li><a href={\`\${prefix}/terms\`} class="hover:text-white">Terms</a></li>
        <li><a href={\`\${prefix}/privacy\`} class="hover:text-white">Privacy</a></li>
      </ul>
    </div>
  </div>
  <div class="container mx-auto mt-8 pt-8 border-t border-gray-800 text-center text-gray-500">
    &copy; {year} NEXUS. {t('footer.rights')}
  </div>
</footer>
`);

// 9. src/pages/index.astro
write('src/pages/index.astro', `
---
import BaseLayout from '../layouts/BaseLayout.astro';
import { getLangFromUrl, useTranslations } from '../i18n/config';

const lang = getLangFromUrl(Astro.url);
const t = useTranslations(lang);
---
<BaseLayout title="Home" description="NEXUS AI Crypto Engine">
  <section class="text-center py-20">
    <h1 class="text-5xl font-extrabold mb-6 text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-400">
      {t('hero.title')}
    </h1>
    <p class="text-xl text-gray-400 mb-8 max-w-2xl mx-auto">
      {t('hero.subtitle')}
    </p>
    <a href="/dashboard" class="bg-primary hover:bg-opacity-80 text-white font-bold py-3 px-8 rounded-lg inline-block">
      {t('hero.cta')}
    </a>
  </section>

  <section class="py-12">
    <h2 class="text-3xl font-bold mb-8 text-center">How NEXUS Works</h2>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
      <div class="bg-panel p-6 rounded-xl border border-gray-800">
        <i data-feather="database" class="text-primary mb-4 w-8 h-8"></i>
        <h3 class="text-xl font-bold mb-2">1. Data Ingestion</h3>
        <p class="text-gray-400">We analyze millions of on-chain transactions and social data points per second.</p>
      </div>
      <div class="bg-panel p-6 rounded-xl border border-gray-800">
        <i data-feather="cpu" class="text-primary mb-4 w-8 h-8"></i>
        <h3 class="text-xl font-bold mb-2">2. AI Processing</h3>
        <p class="text-gray-400">Our quantitative models score assets based on momentum, sentiment, and whale activity.</p>
      </div>
      <div class="bg-panel p-6 rounded-xl border border-gray-800">
        <i data-feather="bell" class="text-primary mb-4 w-8 h-8"></i>
        <h3 class="text-xl font-bold mb-2">3. Real-time Alerts</h3>
        <p class="text-gray-400">Get instant notifications via Telegram when high-probability setups occur.</p>
      </div>
    </div>
  </section>
</BaseLayout>
`);

// We need an i18n dynamic route for the homepage
write('src/pages/[locale]/index.astro', `
---
import { locales } from '../../i18n/config';
import IndexPage from '../index.astro';

export function getStaticPaths() {
  return locales.filter(l => l !== 'en').map(locale => ({ params: { locale } }));
}
---
<IndexPage />
`);

// 10. src/pages/about-us.astro
write('src/pages/about-us.astro', `
---
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout title="About Us" description="About NEXUS">
  <div class="max-w-3xl mx-auto prose prose-invert">
    <h1 class="text-4xl font-bold mb-6">About NEXUS</h1>
    <p class="text-gray-300 text-lg">NEXUS is built by a team of quantitative analysts and AI researchers dedicated to leveling the playing field in crypto trading.</p>
  </div>
</BaseLayout>
`);

// 11. src/pages/contact-us.astro
write('src/pages/contact-us.astro', `
---
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout title="Contact Us" description="Contact NEXUS">
  <div class="max-w-2xl mx-auto">
    <h1 class="text-4xl font-bold mb-6">Contact Us</h1>
    <form class="space-y-4 bg-panel p-6 rounded-xl border border-gray-800">
      <div>
        <label class="block text-gray-400 mb-2">Name</label>
        <input type="text" class="w-full bg-dark border border-gray-700 rounded p-3 text-white" />
      </div>
      <div>
        <label class="block text-gray-400 mb-2">Email</label>
        <input type="email" class="w-full bg-dark border border-gray-700 rounded p-3 text-white" />
      </div>
      <div>
        <label class="block text-gray-400 mb-2">Message</label>
        <textarea class="w-full bg-dark border border-gray-700 rounded p-3 text-white h-32"></textarea>
      </div>
      <button class="bg-primary text-white font-bold py-3 px-6 rounded hover:bg-opacity-80">Send Message</button>
    </form>
  </div>
</BaseLayout>
`);

// 12. src/pages/terms.astro and privacy.astro
write('src/pages/terms.astro', `<BaseLayout title="Terms"><h1>Terms of Service</h1></BaseLayout>`);
write('src/pages/privacy.astro', `<BaseLayout title="Privacy"><h1>Privacy Policy</h1></BaseLayout>`);

// 13. src/pages/404.astro
write('src/pages/404.astro', `
---
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout title="404" description="Not found">
  <div class="text-center py-20">
    <h1 class="text-6xl font-bold text-primary mb-4">404</h1>
    <p class="text-xl">Page not found.</p>
  </div>
</BaseLayout>
`);

// 14. src/pages/robots.txt.ts
write('src/pages/robots.txt.ts', `
export const GET = ({ site }) => {
  return new Response(
    \`User-agent: *\\nAllow: /\\nSitemap: \${new URL('sitemap-index.xml', site).href}\`
  );
};
`);

// 15. src/pages/llms.txt.ts
write('src/pages/llms.txt.ts', `
export const GET = ({ site }) => {
  return new Response(
    \`Site: NEXUS AI Crypto\\nContact: fakhir@example.com\\nPolicy: AI bots allowed.\\nSitemap: \${new URL('sitemap-index.xml', site).href}\`
  );
};
`);

console.log("Astro SaaS theme scaffolded successfully in ./nexus-saas");
