/**
 * LIVE-8 · los SIETE sitios que deben enlazar el aviso de privacidad (API_CONTRACT v1.84.1 §14.14
 * E-9, criterios 503–505; DESIGN_SYSTEM §80.2). Lista del candado LEG-5:
 *
 *  - `npm run check:legal` (criterio 501, puerta de publicación) exige LOS SIETE y, si falta uno,
 *    queda rojo NOMBRANDO el sitio (`publish-ready.test.ts`).
 *  - La suite normal exige los de los lotes ya construidos (`privacy-sites.test.ts`), para que una
 *    regresión no espere a la puerta de publicación.
 *
 * Rutas relativas a `frontend/`. «Usa el componente» = el fichero (sin comentarios) contiene cada
 * patrón de `uses` — el JSX del componente de `components/legal/PrivacyNoticeLink.tsx`.
 */
export interface PrivacyNoticeSite {
  /** Número del sitio en E-9 / §80.2. */
  id: number;
  name: string;
  file: string;
  /** Lote de E-9 en que se construye (1 = `claude/listo-real`; 2 tras F-SKY; 3 tras F-PNL). */
  lote: 1 | 2 | 3;
  uses: RegExp[];
}

export const PRIVACY_NOTICE_SITES: readonly PrivacyNoticeSite[] = [
  {
    id: 1,
    name: 'pie de la tienda',
    file: 'src/app/[locale]/(storefront)/layout.tsx',
    lote: 1,
    uses: [/<PrivacyNoticeLink\s+variant="nav"/],
  },
  {
    id: 2,
    name: 'registro (y «Continuar con Google» desde Entrar, 2b)',
    file: 'src/components/domain/AuthForm.tsx',
    lote: 1,
    uses: [/<PrivacySiteNote\s+site="register"/, /<PrivacySiteNote\s+site="googleSignIn"/],
  },
  {
    id: 3,
    name: 'checkout de invitado (casilla de términos)',
    file: 'src/app/[locale]/(storefront)/checkout/GuestCheckoutForm.tsx',
    lote: 2,
    uses: [/<PrivacyNoticeLink\b|privacyRichTags|<PrivacySiteNote\b/],
  },
  {
    id: 4,
    name: 'checkout con cuenta',
    file: 'src/app/[locale]/(storefront)/checkout/CheckoutView.tsx',
    lote: 1,
    uses: [/<PrivacySiteNote\s+site="checkout"/],
  },
  {
    id: 5,
    name: 'formulario de venta (CLABE / INE)',
    file: 'src/components/domain/BuylistKycForm.tsx',
    lote: 1,
    uses: [/<PrivacySiteNote\s+site="sellForm"/],
  },
  {
    id: 6,
    name: 'INE de «Mi cuenta»',
    file: 'src/components/domain/account/KycSection.tsx',
    lote: 1,
    uses: [/<PrivacySiteNote\s+site="accountIne"/],
  },
  {
    id: 7,
    name: 'pie del seguimiento del invitado',
    file: 'src/app/[locale]/pedido/layout.tsx',
    lote: 3,
    uses: [/<PrivacyNoticeLink\s+variant="nav"/],
  },
];

/** Patrones de `site.uses` que NO aparecen en `source` (ya sin comentarios). Vacío ⇒ el sitio cumple. */
export function missingUses(site: PrivacyNoticeSite, source: string): string[] {
  return site.uses.filter((re) => !re.test(source)).map((re) => re.source);
}
