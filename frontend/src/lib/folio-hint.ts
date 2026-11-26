/**
 * Dueño 2026-11-26: escribió un FOLIO («INV-001306») en un buscador de CARTA y «no encontró nada». Los buscadores de
 * carta no entienden folios; lo que sí los entiende es «Buscar por folio» de Inventario (M1, `GET /admin/inventory?q=`).
 * Este módulo solo RECONOCE la forma del folio (la búsqueda sigue siendo del servidor) y arma el enlace.
 */
export function looksLikeFolio(q: string | null | undefined): boolean {
  return /^\s*INV[-\s]?\d{3,}\s*$/i.test(q ?? '');
}

/** `inv 1306` ⇒ `INV-1306`; se manda tal cual lo escribió (mayúsculas, con guion): el servidor compara sin distinguir mayúsculas. */
export function folioOf(q: string): string {
  const m = /^\s*INV[-\s]?(\d+)\s*$/i.exec(q);
  return m ? `INV-${m[1]}` : q.trim();
}

export function folioInventoryHref(q: string): string {
  return `/admin/m1?folio=${encodeURIComponent(folioOf(q))}`;
}
