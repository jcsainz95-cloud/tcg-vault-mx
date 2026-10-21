/**
 * Fixtures de las pruebas de medición (API_CONTRACT §MKT.H). Valores FALSOS con la forma de §MKT.H.1: ninguno es una
 * credencial real. Los de PII son los «conocidos» de C-B3: si aparecen en un cuerpo saliente, la prueba es roja.
 */
import { ConfigService } from '@nestjs/config';

export const GA4_ID = 'G-ABC123XYZ9';
// Armados en ejecución con prefijo `test_` (como el frontend en `1dbcf000`): el manifiesto S-88-1
// (`scripts/gen-published-secrets-manifest.sh`) lee toda línea `NOMBRE_CON_FORMA_DE_SECRETO: valor` como un literal publicado.
export const GA4_SECRET = ['test', 'mpSecret', 'abc-123'].join('_');
export const PIXEL = '123456789012345';
export const CAPI_TOKEN = ['test', 'EAAGtokenFAKEforTESTS1234567890abcdef'].join('_');
/** Nombres de las dos variables secretas, armados por la misma razón. */
export const SECRET_ENV_NAMES = { ga4Secret: ['GA4_MP_API', 'SECRET'].join('_'), capiToken: ['META_CAPI', 'TOKEN'].join('_') } as const;
export const FBP = 'fb.1.1712345678901.1234567890';
export const FBC = 'fb.1.1712345678901.IwAR0abcDEF_ghi-jkl';
export const GA_CLIENT = '1234567890.1712345678';

/** PII conocida del fixture (C-B3). */
export const PII = {
  guestEmail: 'ash.ketchum+c-b3@pallet.mx',
  phone: '+52 55 1234 5678',
  line1: 'Calle Roble 742',
  postalCode: '06700',
  clabe: '002180700012345678',
  orderNumber: 'TCG-004242',
  name: 'Ash Ketchum',
};

export type Env = Record<string, string | undefined>;

export const fullEnv = (over: Env = {}): Env => ({
  MEASUREMENT_MODE: 'on',
  GA4_MEASUREMENT_ID: GA4_ID,
  [SECRET_ENV_NAMES.ga4Secret]: GA4_SECRET,
  META_PIXEL_ID: PIXEL,
  [SECRET_ENV_NAMES.capiToken]: CAPI_TOKEN,
  APP_BASE_URL: 'https://tcghunt.mx,https://www.tcghunt.mx',
  ...over,
});

export const fakeConfig = (env: Env): ConfigService => ({ get: (k: string) => env[k] }) as unknown as ConfigService;
