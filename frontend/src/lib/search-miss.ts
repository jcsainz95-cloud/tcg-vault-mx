/**
 * §MKT-V2 §7 (c6; vive fuera de lib/measurement a propósito: no es medición, no hay identificador) — `POST /marketing/search-miss`: la tienda anota que una búsqueda interna terminó SIN resultados.
 *
 * - Va SIEMPRE, con o sin consentimiento: el servidor no guarda IP, cookie ni usuario, solo `término + día + cuenta`
 *   (filtra datos personales y el contador es agregado). Se apaga con el flag del servidor (responde `204` igual).
 * - Una vez por término y pestaña (dedup en `sessionStorage`, solo RAM de la pestaña).
 * - ⛔ El término NUNCA va a GA4/Meta (`search` solo lleva `results_count`, §MKT.H.4).
 * - Tráfico propio (`isInternalTraffic`) y modo mocks: no se manda. Best-effort: no espera ni avisa.
 */
import { config } from '@/lib/config';
import { isInternalTraffic, syncInternalFlag } from './measurement/internal';

export type SearchMissKind = 'card' | 'sealed';

const KEY = 'tcg_sm';
const MAX_TERM = 80;
const MAX_REMEMBERED = 50;

/** Pura: lo que sale al servidor (trim, minúsculas, ≤ 80), o `null` si no hay nada que mandar. */
export function searchMissTerm(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, MAX_TERM);
  return t.length >= 2 ? t : null;
}

function seen(term: string, kind: SearchMissKind): boolean {
  try {
    const list: string[] = JSON.parse(window.sessionStorage.getItem(KEY) ?? '[]');
    const id = `${kind}:${term}`;
    if (list.includes(id)) return true;
    window.sessionStorage.setItem(KEY, JSON.stringify([...list, id].slice(-MAX_REMEMBERED)));
    return false;
  } catch {
    return false; // sin sessionStorage: mejor repetir que perder
  }
}

/**
 * §DEMANDA F2: `cardId` SOLO cuando la pantalla muestra una carta única agotada (ficha con `listings: []`); el
 * servidor lo verifica (existe y 0 stock) y, si no, cae al camino de texto. Con `cardId` válido el servidor no guarda el texto.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sendSearchMiss(raw: string, kind: SearchMissKind, cardId?: string): void {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return;
  try {
    // Tráfico propio: se lee la marca directo (y la URL de llegada), aunque la medición esté apagada y el proveedor no sincronice.
    if (config.useMocks || syncInternalFlag() || isInternalTraffic()) return;
    const term = searchMissTerm(raw);
    if (!term) return;
    const id = kind === 'card' && cardId && UUID.test(cardId) ? cardId : undefined;
    if (seen(id ? `#${id}` : term, kind)) return;
    void fetch(`${config.apiBaseUrl.replace(/\/+$/, '')}/marketing/search-miss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(id ? { term, kind, cardId: id } : { term, kind }),
      keepalive: true,
      credentials: 'omit',
    }).catch(() => undefined);
  } catch {
    /* best-effort */
  }
}
