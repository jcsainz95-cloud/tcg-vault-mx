/**
 * Tráfico propio (docs/specs/MKT_PANEL_V2.md §4, D5). Copia en el navegador de
 * `backend/src/modules/marketing/internal-traffic.ts` (el patrón es el mismo, ver `internal.test.ts`).
 *
 * Una visita es PROPIA si `utm_source` (nunca `utm_medium`) cumple `INTERNAL_RE` (nuestras herramientas se nombran
 * `diag-*`, `qa-*`, `e2e-*`…) o si la URL trae `?tcg_int=1`. Entonces el navegador guarda `localStorage.tcg_int`
 * (señal LOCAL, 90 días; nada sale al servidor; `?tcg_int=0` la quita) y corta en origen: ni GA4, ni Meta, ni banner,
 * ni contador de banner, ni cookie de primer UTM.
 */

export const INTERNAL_RE = /^(diag|qa|e2e|smoke|test|probe|internal)-.+/i;
export const INTERNAL_KEY = 'tcg_int';
const INTERNAL_UNTIL_KEY = 'tcg_int_until';
export const INTERNAL_DAYS = 90;

/** ¿Este `utm_source` es de una herramienta nuestra? */
export function isInternalUtm(value: string | null | undefined): boolean {
  return typeof value === 'string' && INTERNAL_RE.test(value.trim());
}

/** Lo que dice la URL: `'on'` (marcar), `'off'` (`?tcg_int=0`) o `null` (nada). */
export function internalFromSearch(search: string): 'on' | 'off' | null {
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(search);
  } catch {
    return null;
  }
  const flag = p.get(INTERNAL_KEY);
  if (flag === '0') return 'off';
  if (flag === '1') return 'on';
  if (isInternalUtm(p.get('utm_source'))) return 'on';
  return null;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** ¿Este navegador está marcado como propio (y la marca no venció)? Solo lee. Nunca lanza. */
export function isInternalTraffic(now: number = Date.now()): boolean {
  const s = storage();
  if (!s) return false;
  try {
    if (s.getItem(INTERNAL_KEY) !== '1') return false;
    const until = Number(s.getItem(INTERNAL_UNTIL_KEY));
    if (Number.isFinite(until) && until > 0 && until < now) {
      s.removeItem(INTERNAL_KEY);
      s.removeItem(INTERNAL_UNTIL_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Aplica lo que diga la URL actual (marca o quita) y devuelve si el navegador es propio. Se llama ANTES de leer la
 * cookie de consentimiento. Una URL sin etiqueta no toca nada. Nunca lanza.
 */
export function syncInternalFlag(search?: string, now: number = Date.now()): boolean {
  const s = storage();
  if (!s) return false;
  try {
    const q = search ?? window.location.search;
    const verdict = internalFromSearch(q);
    if (verdict === 'on') {
      s.setItem(INTERNAL_KEY, '1');
      s.setItem(INTERNAL_UNTIL_KEY, String(now + INTERNAL_DAYS * 86_400_000));
    } else if (verdict === 'off') {
      s.removeItem(INTERNAL_KEY);
      s.removeItem(INTERNAL_UNTIL_KEY);
    }
  } catch {
    /* sin storage: se queda lo que haya */
  }
  return isInternalTraffic(now);
}
