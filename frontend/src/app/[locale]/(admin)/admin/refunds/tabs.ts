/**
 * Cubetas de `/admin/refunds` (`DESIGN_SYSTEM §37.20 b`): `?tab=spei|operadores`.
 *
 * ⚠️ Sin `'use client'` a propósito (misma lección que `m4/tabs.ts`): `page.tsx` es componente de SERVIDOR
 * y llama a `parseRefundsTab`; una función exportada desde un módulo cliente no se puede invocar desde el
 * servidor en el build de producción.
 */
export const REFUNDS_TABS = ['spei', 'operadores'] as const;
export type RefundsTab = (typeof REFUNDS_TABS)[number];

function isRefundsTab(v: string | undefined): v is RefundsTab {
  return v !== undefined && (REFUNDS_TABS as readonly string[]).includes(v);
}

/** Cualquier valor fuera de `REFUNDS_TABS` (o ninguno) cae en «Transferencias SPEI», la cubeta por defecto. */
export function parseRefundsTab(raw: string | string[] | undefined): RefundsTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return isRefundsTab(v) ? v : REFUNDS_TABS[0];
}
