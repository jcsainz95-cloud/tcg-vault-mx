import { RefundsView } from './RefundsView';
import { parseRefundsTab } from './tabs';

/**
 * `/admin/refunds` — «Reembolsos» (`DESIGN_SYSTEM §37.20`, HECHOS 2026-10-02 «Menú del panel: se queda como
 * está; … se JUNTAN en UNA sola pestaña con dos cubetas»): `?tab=spei` (por defecto, también sin `tab`) |
 * `?tab=operadores`. Solo súper-admin. El parseo vive en `tabs.ts` (módulo sin `'use client'`).
 */
export default async function RefundsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { tab } = await searchParams;
  return <RefundsView initialTab={parseRefundsTab(tab)} />;
}
