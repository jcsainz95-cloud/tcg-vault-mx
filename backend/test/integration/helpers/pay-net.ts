import type { E2EHarness } from './e2e-app';

/**
 * §BUYLIST-FLUJO M-3: `pay-spei` exige `expectedNetCents` (= `payout.netCents` que la pantalla muestra). Las pruebas que pagan
 * lo leen igual que el front: del detalle admin. Sin `payout` (estado no pagable) devuelve 0: la prueba espera un 4xx por
 * otra causa y el monto no se evalua.
 */
export async function payoutNet(h: E2EHarness, adminToken: string, srId: string): Promise<number> {
  const r = await h.api('GET', `/admin/buylist/${srId}`, { token: adminToken });
  return (r.body as { payout?: { netCents?: number } | null })?.payout?.netCents ?? 0;
}
