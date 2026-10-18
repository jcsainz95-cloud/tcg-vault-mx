/**
 * card-show-ip.util.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW.4, ARCHITECTURE §4.CARDSHOW.c).
 *
 * La CLAVE del throttle de la landing es `req.ip` con `TRUST_PROXY_HOPS=1` (Express `trust proxy`
 * fijado a 1 en `trust-proxy.ts`): Express toma la IP del ÚNICO salto de confianza (el borde de
 * Railway) e IGNORA las cabeceras que mande el CLIENTE (`X-Forwarded-For` extra, `X-Real-IP`,
 * `CF-Connecting-IP`, `True-Client-IP`, `Forwarded`) ⇒ caen en el mismo cubo que sin cabecera.
 *
 * Este helper hace SOLO la última pieza: agrupar IPv6 por prefijo /64 (un atacante con un /64 no tiene
 * millones de cubos). ⛔ No lee ninguna cabecera: recibe `req.ip` ya resuelto por Express.
 */

/** ¿Parece una IPv4 (a.b.c.d)? */
function isIpv4(ip: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);
}

/**
 * Normaliza `req.ip` a la clave de cubo del throttle:
 *  - IPv4 ⇒ tal cual.
 *  - IPv4 mapeada en IPv6 (`::ffff:a.b.c.d`) ⇒ la IPv4.
 *  - IPv6 ⇒ los primeros 4 hextets (prefijo /64), en minúsculas.
 *  - vacío/ausente ⇒ `'unknown'` (un solo cubo; ⛔ no deja pasar sin contar).
 */
export function ipThrottleKey(ip: string | undefined | null): string {
  if (!ip || ip.trim() === '') return 'unknown';
  const raw = ip.trim().toLowerCase();

  // IPv4 mapeada: `::ffff:192.0.2.1`.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  if (mapped) return mapped[1];

  if (isIpv4(raw)) return raw;

  // IPv6: /64 = primeros 4 grupos. Se expande `::` lo justo para contar 8 grupos.
  if (raw.includes(':')) {
    const groups = expandIpv6(raw);
    if (groups) return `${groups.slice(0, 4).join(':')}::/64`;
    // No parseable como IPv6 canónica: devolver tal cual (un cubo propio, nunca `unknown` compartido).
    return raw;
  }

  return raw;
}

/** Expande un IPv6 (con un posible `::`) a sus 8 hextets. `null` si es inválido. */
function expandIpv6(ip: string): string[] | null {
  // Descarta zona (`%eth0`) si viene.
  const clean = ip.split('%')[0];
  const doubleColon = clean.split('::');
  if (doubleColon.length > 2) return null;

  const head = doubleColon[0] ? doubleColon[0].split(':') : [];
  const tail = doubleColon.length === 2 && doubleColon[1] ? doubleColon[1].split(':') : [];

  let groups: string[];
  if (doubleColon.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  // Normaliza cada hextet (quita ceros a la izquierda; cadena vacía ⇒ '0').
  return groups.map((g) => {
    if (!/^[0-9a-f]{0,4}$/.test(g)) return 'x';
    return (g.replace(/^0+/, '') || '0');
  });
}
