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
