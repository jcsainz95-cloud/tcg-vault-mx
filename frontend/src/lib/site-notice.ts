/**
 * Aviso emergente de la tienda (HECHOS 2026-11-17: agradecimiento + demoras por alta demanda). UN solo sitio para
 * retirarlo: borra `<SiteNotice>` de `(storefront)/layout.tsx` o pon `enabled: false`; con `endsOn` el aviso se apaga solo.
 * Cambiar `id` lo vuelve a mostrar a quien ya lo cerró (clave de localStorage distinta).
 */
export const SITE_NOTICE = {
  enabled: true,
  id: 'demora-2026-11',
  /** Último día (CDMX, inclusive) en que se muestra; a partir del siguiente ya no sale. */
  endsOn: '2026-12-01',
  /** Pantallas donde NO sale (el pago y su confirmación no se interrumpen). Prefijos SIN locale. */
  excludedPrefixes: ['/checkout', '/compra'],
} as const;

export const SITE_NOTICE_STORAGE_KEY = `tcg.notice.${SITE_NOTICE.id}`;

/** ¿Sigue vigente `hoy`? Compara el día CDMX (`America/Mexico_City`) con `endsOn`. */
export function siteNoticeActive(now: Date = new Date(), cfg: { enabled: boolean; endsOn: string } = SITE_NOTICE): boolean {
  if (!cfg.enabled) return false;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(now);
  return today <= cfg.endsOn;
}

export function siteNoticeExcluded(pathname: string, cfg: { excludedPrefixes: readonly string[] } = SITE_NOTICE): boolean {
  return cfg.excludedPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
