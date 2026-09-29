import { VaultDetailView } from './VaultDetailView';
import { parseVaultDetailTab } from './tabs';

/**
 * `/admin/vaults/[userId]` — detalle de la bóveda de UN cliente, con **URL propia** (H-6 de
 * `DESIGN_SYSTEM §36.13`, sin contrato nuevo: `API_CONTRACT §M4-VAULT.12`). Antes se abría con estado
 * local dentro de la lista, y un enlace directo (p. ej. «Ver qué debe haber en su bóveda» desde la
 * tarjeta de «Pedidos a preparar») no tenía a dónde llevar. `?tab=cards|sealed|physical` elige la
 * pestaña. Guard: el layout de `(admin)`; el backend es la autoridad (`403`/`404`).
 */
export default async function AdminVaultDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { userId } = await params;
  const { tab } = await searchParams;
  return <VaultDetailView userId={userId} initialTab={parseVaultDetailTab(tab)} />;
}
