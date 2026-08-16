import { defineRouting } from 'next-intl/routing';

export const locales = ['es', 'en'] as const;
export type AppLocale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: 'es',
  localePrefix: 'always',
  // ES por defecto SIEMPRE: al poner `localeDetection: false` el middleware deja
  // de usar el header `accept-language` Y la cookie para detectar el idioma, así
  // que la ruta raíz `/` resuelve a `/es` aunque el navegador esté en inglés
  // (en-US). El cambio a inglés es explícito: el usuario pica el LocaleToggle,
  // que navega a `/en` (localePrefix:'always' preserva el prefijo al navegar).
  localeDetection: false,
});
