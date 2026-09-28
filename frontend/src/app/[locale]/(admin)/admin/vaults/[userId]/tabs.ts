/**
 * Pestañas del detalle de bóveda (`?tab=cards|sealed|physical`).
 *
 * ⚠️ Este módulo NO lleva `'use client'` a propósito: `page.tsx` es componente de SERVIDOR y llama a
 * `parseVaultDetailTab`. Una función exportada desde un módulo `'use client'` es, para el servidor,
 * una *referencia de cliente* y no se puede invocar: en build de producción todo render de
 * `/admin/vaults/<userId>` fallaba con «Attempted to call parseVaultDetailTab() from the server»
 * (rechazo de QA sobre db7d1c2). vitest y tsc no lo ven; lo vigila `e2e/m4-vault-placement.spec.ts`.
 */
export const VAULT_DETAIL_TABS = ['cards', 'sealed', 'physical'] as const;
export type VaultDetailTab = (typeof VAULT_DETAIL_TABS)[number];

function isVaultDetailTab(v: string | undefined): v is VaultDetailTab {
  return v !== undefined && (VAULT_DETAIL_TABS as readonly string[]).includes(v);
}

/** Cualquier valor fuera de `VAULT_DETAIL_TABS` cae en la primera pestaña («Cartas»). */
export function parseVaultDetailTab(raw: string | string[] | undefined): VaultDetailTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return isVaultDetailTab(v) ? v : VAULT_DETAIL_TABS[0];
}
