/**
 * Pestañas de `/admin/m4` (`DESIGN_SYSTEM §37.2`): `?tab=preparar|reponer|envios`.
 *
 * ⚠️ Sin `'use client'` a propósito (misma lección que `vaults/[userId]/tabs.ts`): `page.tsx` es componente
 * de SERVIDOR y llama a `parseM4Tab`; una función exportada desde un módulo cliente no se puede invocar
 * desde el servidor en el build de producción.
 */
export const M4_TABS = ['preparar', 'reponer', 'envios'] as const;
export type M4Tab = (typeof M4_TABS)[number];

function isM4Tab(v: string | undefined): v is M4Tab {
  return v !== undefined && (M4_TABS as readonly string[]).includes(v);
}

/** Cualquier valor fuera de `M4_TABS` cae en «Preparar» (la pestaña de pie, por defecto). */
export function parseM4Tab(raw: string | string[] | undefined): M4Tab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return isM4Tab(v) ? v : M4_TABS[0];
}
