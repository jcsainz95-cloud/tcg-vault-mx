/**
 * Pestañas de `/admin/m4` (`DESIGN_SYSTEM §37.2`): `?tab=preparar|reponer|envios|salida`
 * (⭐ `salida` = «Salida de hoy», §43.9, al final y sin badge).
 *
 * ⚠️ Sin `'use client'` a propósito (misma lección que `vaults/[userId]/tabs.ts`): `page.tsx` es componente
 * de SERVIDOR y llama a `parseM4Tab`; una función exportada desde un módulo cliente no se puede invocar
 * desde el servidor en el build de producción.
 */
export const M4_TABS = ['preparar', 'reponer', 'envios', 'salida'] as const;
export type M4Tab = (typeof M4_TABS)[number];

function isM4Tab(v: string | undefined): v is M4Tab {
  return v !== undefined && (M4_TABS as readonly string[]).includes(v);
}

/** Cualquier valor fuera de `M4_TABS` cae en «Preparar» (la pestaña de pie, por defecto). */
export function parseM4Tab(raw: string | string[] | undefined): M4Tab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return isM4Tab(v) ? v : M4_TABS[0];
}

/**
 * 🔒 v1.80.12.10 (§19.30.8 S-GAS-2): `?folio=ENV-000045` — el enlace de un aviso de gasto de un retiro (sin pedido) abre
 * «Envíos» filtrado por ese folio. Fuera de formato ⇒ se ignora (el servidor respondería `400`).
 */
export function parseFolio(v: string | string[] | undefined): string | null {
  const one = Array.isArray(v) ? v[0] : v;
  return one && /^ENV-\d{6,}$/.test(one) ? one : null;
}

/**
 * v1.80.12.16 (`DESIGN_SYSTEM §43.22.4`, FS-65): `?alert=true` — el enlace de «Alertas de envíos» del tablero abre
 * «Envíos» filtrado por la unión de las dos alertas. Solo el literal `'true'` activa (el dominio del servidor es `true`;
 * `false` sería `400`): cualquier otro valor o ausente ⇒ sin filtro.
 */
export function parseAlert(v: string | string[] | undefined): boolean {
  const one = Array.isArray(v) ? v[0] : v;
  return one === 'true';
}
