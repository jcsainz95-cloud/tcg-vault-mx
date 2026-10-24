import { afterEach, beforeEach } from 'vitest';
import { CHECKOUT_DESKTOP_QUERY } from './use-is-desktop';

/**
 * Solo pruebas. El checkout decide `aside` (lg+) o barra fija (<lg) con `matchMedia` (`useIsDesktop`) y jsdom
 * responde `false` siempre (vitest.setup) ⇒ por defecto las pruebas ven la variante MÓVIL. Las que afirman
 * el `aside` (`complementary`) piden escritorio con esto; las de la barra fija, móvil.
 */
export function setCheckoutViewport(kind: 'desktop' | 'mobile'): void {
  let original: typeof window.matchMedia;
  beforeEach(() => {
    original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: kind === 'desktop' && query === CHECKOUT_DESKTOP_QUERY,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = original;
  });
}
