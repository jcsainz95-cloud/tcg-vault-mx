import { describe, it, expect } from 'vitest';
import { routing, locales } from './routing';

describe('i18n routing · ES por defecto SIEMPRE', () => {
  it('el idioma por defecto es español', () => {
    expect(routing.defaultLocale).toBe('es');
  });

  it('expone es y en', () => {
    expect(locales).toEqual(['es', 'en']);
  });

  it('prefija el locale en todas las rutas (localePrefix "always")', () => {
    // localePrefix se normaliza a un objeto verbose; mode debe ser "always".
    const prefix = routing.localePrefix as { mode?: string } | string;
    const mode = typeof prefix === 'string' ? prefix : prefix.mode;
    expect(mode).toBe('always');
  });

  it('NO detecta el idioma por accept-language ni cookie: la raíz resuelve a /es aunque el navegador esté en inglés', () => {
    // Con localeDetection=false el middleware ignora el header accept-language y la
    // cookie; `/` resuelve al defaultLocale ('es'). El cambio a inglés es explícito
    // (LocaleToggle → /en). Ver frontend/src/i18n/routing.ts.
    expect(routing.localeDetection).toBe(false);
  });
});
