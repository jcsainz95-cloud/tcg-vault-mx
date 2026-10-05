import { M4View } from './M4View';
import { parseAlert, parseFolio, parseM4Tab } from './tabs';

/**
 * `/admin/m4` — «Pedidos por preparar» (`DESIGN_SYSTEM §37.2`): tres pestañas de página,
 * `?tab=preparar|reponer|envios`. El parseo vive en `tabs.ts` (módulo sin `'use client'`).
 */
export default async function M4Page({ searchParams }: { searchParams: Promise<{ tab?: string | string[]; folio?: string | string[]; alert?: string | string[] }> }) {
  const { tab, folio, alert } = await searchParams;
  return <M4View initialTab={parseM4Tab(tab)} initialFolio={parseFolio(folio)} initialAlert={parseAlert(alert)} />;
}
