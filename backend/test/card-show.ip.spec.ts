import { ipThrottleKey } from '../src/modules/card-show/card-show-ip.util';

/**
 * §CARDSHOW.4 (C7) — la clave del throttle es `req.ip` normalizado: IPv4 tal cual, IPv6 agrupado por
 * /64 (dos direcciones del mismo /64 comparten cubo). ⛔ No lee cabeceras (eso lo resuelve `trust proxy`).
 */
describe('CARDSHOW · clave de throttle por IP (C7)', () => {
  it('IPv4 ⇒ tal cual', () => {
    expect(ipThrottleKey('203.0.113.7')).toBe('203.0.113.7');
  });

  it('IPv4 mapeada en IPv6 ⇒ la IPv4', () => {
    expect(ipThrottleKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('dos IPv6 del mismo /64 ⇒ MISMO cubo; de /64 distinto ⇒ cubos distintos', () => {
    const a = ipThrottleKey('2001:db8:abcd:1234:1::1');
    const b = ipThrottleKey('2001:db8:abcd:1234:ffff:ffff:ffff:ffff');
    const c = ipThrottleKey('2001:db8:abcd:9999::1');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('IPv6 comprimida se expande correctamente', () => {
    expect(ipThrottleKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipThrottleKey('::1')).toBe('0:0:0:0::/64');
  });

  it('IP ausente ⇒ un cubo "unknown" (⛔ nunca deja pasar sin contar)', () => {
    expect(ipThrottleKey(undefined)).toBe('unknown');
    expect(ipThrottleKey('')).toBe('unknown');
  });
});
