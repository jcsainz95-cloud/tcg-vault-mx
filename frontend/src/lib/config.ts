/** Configuración pública del cliente. NEXT_PUBLIC_* del .env.example (raíz). */
export const config = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1',
  stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
  /** OAuth client id de Google Identity Services (login con Google, §6.7). */
  googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '',
  defaultLocale: process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? 'es',
  /**
   * MOCK: pendiente de backend. Mientras el backend no esté corriendo se usan
   * fixtures que respetan los shapes del contrato. Poner NEXT_PUBLIC_USE_MOCKS=false
   * (o definir el backend) activa las llamadas reales al API.
   */
  useMocks: process.env.NEXT_PUBLIC_USE_MOCKS !== 'false',
};
