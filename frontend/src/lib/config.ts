/** Configuración pública del cliente. NEXT_PUBLIC_* del .env.example (raíz). */
export const config = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1',
  stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
  /** OAuth client id de Google Identity Services (login con Google, §6.7). */
  googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '',
  defaultLocale: process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? 'es',
  /**
   * Modo MOCK: sirve fixtures locales en vez de llamar al API. Es una herramienta de
   * demo/desarrollo, no un modo de producción.
   *
   * ⚠️ **OPT-IN EXPLÍCITO (fail-safe).** Antes era `!== 'false'`, o sea **encendido por defecto**:
   * un build donde se olvidara `NEXT_PUBLIC_USE_MOCKS=false` servía **fixtures en silencio** —
   * precios de mentira, inventario de mentira, sin un solo error en pantalla. Un default tiene que
   * fallar hacia el lado seguro, y el lado seguro aquí es hablar con el backend: si la API no está,
   * la UI muestra su estado de error honesto (§8.1) en vez de inventar datos.
   *
   * Los caminos que SÍ quieren mocks lo declaran: `playwright.config.ts` (webServer),
   * `vitest.config.ts` (suite unitaria) y quien levante el front en modo demo.
   */
  useMocks: process.env.NEXT_PUBLIC_USE_MOCKS === 'true',
};
