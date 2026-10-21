import { describe, expect, it } from 'vitest';
import {
  CONSENT_MAX_AGE_S,
  FIRST_UTM_MAX_AGE_S,
  clearCookies,
  cookiesToClear,
  parseCookies,
  readConsent,
  readFirstUtm,
  revokedFrom,
  writeConsent,
  writeFirstUtmOnce,
  type CookieJar,
} from './consent';

/** Jarra en memoria que entiende `Max-Age=0` como borrado (lo suficiente para estas pruebas). */
function memoryJar(hostname = 'tcghunt.mx', blockWrites = false): CookieJar & { written: string[] } {
  const store = new Map<string, string>();
  const written: string[] = [];
  return {
    written,
    hostname,
    read: () => [...store.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    write: (c) => {
      written.push(c);
      if (blockWrites) return;
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (/Max-Age=0\b/.test(c)) store.delete(name);
      else store.set(name, value);
    },
  };
}

describe('th_consent (§MKT.H.8 / ARCHITECTURE §14.3)', () => {
  it('se escribe 180 días, Secure, SameSite=Lax, Path=/ y dominio apex en tcghunt.mx', () => {
    const jar = memoryJar('www.tcghunt.mx');
    expect(writeConsent(jar, { analytics: true, ads: false, noticeVersion: 'v1', savedOn: '2026-10-19' })).toBe(true);
    const c = jar.written[0];
    expect(c).toMatch(/^th_consent=/);
    expect(c).toContain(`Max-Age=${CONSENT_MAX_AGE_S}`);
    expect(CONSENT_MAX_AGE_S).toBe(180 * 86400);
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Path=/');
    expect(c).toContain('Domain=tcghunt.mx');
  });

  it('fuera de tcghunt.mx no fija Domain (localhost, previews)', () => {
    const jar = memoryJar('localhost');
    writeConsent(jar, { analytics: false, ads: false, noticeVersion: 'v1', savedOn: '2026-10-19' });
    expect(jar.written[0]).not.toContain('Domain=');
  });

  it('se lee de vuelta; otra versión del aviso ⇒ null (se vuelve a preguntar)', () => {
    const jar = memoryJar();
    writeConsent(jar, { analytics: true, ads: true, noticeVersion: 'v1', savedOn: '2026-10-19' });
    expect(readConsent(jar, 'v1')).toEqual({ analytics: true, ads: true, noticeVersion: 'v1', savedOn: '2026-10-19' });
    expect(readConsent(jar, 'v2')).toBeNull();
  });

  it('cookie rota o manipulada ⇒ null', () => {
    const jar = memoryJar();
    jar.write('th_consent=%7B%22v%22%3A1%2C%22a%22%3A2%7D; Path=/');
    expect(readConsent(jar, 'v1')).toBeNull();
    jar.write('th_consent=basura; Path=/');
    expect(readConsent(jar, 'v1')).toBeNull();
  });

  it('navegador que bloquea la cookie ⇒ writeConsent false (la elección vive en memoria)', () => {
    const jar = memoryJar('tcghunt.mx', true);
    expect(writeConsent(jar, { analytics: true, ads: true, noticeVersion: 'v1', savedOn: '2026-10-19' })).toBe(false);
  });
});

describe('th_first_utm (§B1): 90 días, no se sobrescribe', () => {
  it('escribe una vez y no pisa la primera', () => {
    const jar = memoryJar();
    expect(writeFirstUtmOnce(jar, { source: 'ig', medium: 'story' }, new Date('2026-10-19T10:00:00Z'))).toBe(true);
    expect(jar.written[0]).toContain(`Max-Age=${FIRST_UTM_MAX_AGE_S}`);
    expect(FIRST_UTM_MAX_AGE_S).toBe(90 * 86400);
    expect(writeFirstUtmOnce(jar, { source: 'fb' }, new Date())).toBe(false);
    expect(readFirstUtm(jar)).toMatchObject({ source: 'ig', medium: 'story', landedAt: '2026-10-19T10:00:00.000Z' });
  });
  it('sin utm válidos no escribe nada', () => {
    const jar = memoryJar();
    expect(writeFirstUtmOnce(jar, {}, new Date())).toBe(false);
    expect(jar.written).toEqual([]);
  });
});

describe('revocar (§14.3): se borran las cookies de la finalidad retirada', () => {
  it('analítica fuera ⇒ th_first_utm, _ga, _ga_<id>, _gid; publicidad fuera ⇒ _fbp, _fbc', () => {
    const names = ['th_consent', 'th_first_utm', '_ga', '_ga_ABC123', '_gid', '_fbp', '_fbc', 'NEXT_LOCALE'];
    expect(cookiesToClear(names, { analytics: true, ads: false })).toEqual(['th_first_utm', '_ga', '_ga_ABC123', '_gid']);
    expect(cookiesToClear(names, { analytics: false, ads: true })).toEqual(['_fbp', '_fbc']);
  });
  it('borra con y sin Domain', () => {
    const jar = memoryJar('www.tcghunt.mx');
    jar.write('_ga=GA1.1.1.2; Path=/');
    clearCookies(jar, ['_ga']);
    expect(parseCookies(jar.read()).has('_ga')).toBe(false);
    expect(jar.written.some((c) => c.includes('Domain=tcghunt.mx') && c.includes('Max-Age=0'))).toBe(true);
  });
  it('revokedFrom solo marca lo que ESTABA concedido y se quitó', () => {
    expect(revokedFrom(null, { analytics: false, ads: false })).toEqual({ analytics: false, ads: false });
    expect(revokedFrom({ analytics: true, ads: true }, { analytics: true, ads: false })).toEqual({ analytics: false, ads: true });
  });
});
