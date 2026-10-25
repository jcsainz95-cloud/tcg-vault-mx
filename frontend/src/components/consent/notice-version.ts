import { MEASUREMENT_DISCLOSURE } from '@/content/legal/measurement-disclosure';

/**
 * Versión del aviso que declara la medición (`th_consent` la guarda; otra versión ⇒ se vuelve a preguntar).
 * Sin `measurementDisclosure` la medición queda inactiva (fail-closed, §14.1), salvo en builds de MOCKS (E2E
 * con `on`): `next.config.mjs` hornea `NEXT_PUBLIC_MEASUREMENT_E2E_NOTICE_VERSION` únicamente si
 * `NEXT_PUBLIC_USE_MOCKS=true`. Un build real sin aviso sigue inactivo (y su `npm run build` no pasa C-D1).
 * La comparten los dos montajes (`MeasurementProvider` y `CardShowMeasurement`).
 */
export function noticeVersionForBuild(): string | null {
  if (MEASUREMENT_DISCLOSURE) return MEASUREMENT_DISCLOSURE.version;
  const e2e = process.env.NEXT_PUBLIC_MEASUREMENT_E2E_NOTICE_VERSION;
  return e2e ? e2e : null;
}
