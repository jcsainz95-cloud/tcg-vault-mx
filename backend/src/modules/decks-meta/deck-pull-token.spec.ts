import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PiiCryptoService } from '../../common/crypto/pii-crypto.service';
import { MANUAL_REFUND_REVEAL_DOMAIN } from '../payments/refunds/manual-refund.service';
import {
  DECK_PULL_DOMAIN,
  DECK_PULL_TTL_SECONDS,
  signPullToken,
  verifyPullToken,
} from './deck-pull-token';

/**
 * AC-B31 (`API_CONTRACT §AC.8` «pullToken») — `base64url(JSON{v:1, slug, listId, ids (ordenados), iat})` + "." +
 * `domainHmac('deck-pull:v1:', <parte 1>)`; comparación en tiempo constante; vigencia 30 días desde `iat`.
 * Quitar o agregar un id, cambiar `slug` o `listId`, vencido, o un token firmado en OTRO dominio (`mr-reveal`) ⇒ rechazado.
 * Mutación del contrato: «comparar sin el `domain`» ⇒ esta suite se pone roja.
 */
const KEY_A = 'a'.repeat(48);
const KEY_B = 'b'.repeat(48);
const signer = new PiiCryptoService(new ConfigService({ PII_HMAC_KEY: KEY_A }));
const otherKey = new PiiCryptoService(new ConfigService({ PII_HMAC_KEY: KEY_B }));

const NOW = 1_790_000_000; // segundos
const base = { slug: 'dragapult-ex', listId: 'list-1', ids: ['inv-c', 'inv-a', 'inv-b'], iat: NOW };

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');
/** Re-firma una parte 1 arbitraria con la llave A y el dominio dado (lo que haría un atacante CON la llave). */
const forge = (part1: string, domain = DECK_PULL_DOMAIN) => `${part1}.${signer.domainHmac(domain, part1)}`;
/** Sustituye la parte 1 conservando la firma original (lo que puede hacer un atacante SIN la llave). */
const tamper = (token: string, mutate: (p: Record<string, unknown>) => void) => {
  const [p1, sig] = token.split('.');
  const obj = JSON.parse(unb64(p1));
  mutate(obj);
  return `${b64(JSON.stringify(obj))}.${sig}`;
};

describe('AC-B31 pullToken (§AC.8)', () => {
  it('formato: parte 1 = base64url del JSON {v,slug,listId,ids ORDENADOS,iat}; firma = domainHmac(deck-pull:v1:, parte 1)', () => {
    const t = signPullToken(signer, base);
    const parts = t.split('.');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(unb64(parts[0]))).toEqual({
      v: 1,
      slug: 'dragapult-ex',
      listId: 'list-1',
      ids: ['inv-a', 'inv-b', 'inv-c'],
      iat: NOW,
    });
    expect(parts[1]).toBe(signer.domainHmac(DECK_PULL_DOMAIN, parts[0]));
    expect(DECK_PULL_DOMAIN).toBe('deck-pull:v1:');
  });

  it('el orden de entrada de los ids no cambia el token (se firman ordenados)', () => {
    expect(signPullToken(signer, base)).toBe(signPullToken(signer, { ...base, ids: ['inv-b', 'inv-c', 'inv-a'] }));
  });

  it('válido ⇒ ok con la carga firmada', () => {
    const v = verifyPullToken(signer, signPullToken(signer, base), NOW + 10);
    expect(v).toEqual({
      ok: true,
      payload: { v: 1, slug: 'dragapult-ex', listId: 'list-1', ids: ['inv-a', 'inv-b', 'inv-c'], iat: NOW },
    });
  });

  it('ids vacíos también se firman y verifican (pullToken SIEMPRE presente)', () => {
    const v = verifyPullToken(signer, signPullToken(signer, { ...base, ids: [] }), NOW);
    expect(v.ok).toBe(true);
  });

  describe('alteraciones sin la llave ⇒ invalid_token', () => {
    // Perezosas: si el firmador se rompe, cada caso falla por su cuenta (no se cae la suite al declararla).
    const good = () => signPullToken(signer, base);
    const cases: [string, () => string][] = [
      ['quitar un id', () => tamper(good(), (p) => { p.ids = ['inv-a', 'inv-b']; })],
      ['agregar un id', () => tamper(good(), (p) => { p.ids = ['inv-a', 'inv-b', 'inv-c', 'inv-d']; })],
      ['cambiar slug', () => tamper(good(), (p) => { p.slug = 'charizard-ex'; })],
      ['cambiar listId', () => tamper(good(), (p) => { p.listId = 'list-2'; })],
      ['rejuvenecer iat', () => tamper(good(), (p) => { p.iat = NOW + 1000; })],
      ['firma de otra llave', () => signPullToken(otherKey, base)],
      ['firma vacía', () => `${good().split('.')[0]}.`],
      ['sin punto', () => good().replace('.', '')],
      ['tres partes', () => `${good()}.x`],
      ['basura', () => 'no-es-un-token'],
      ['cadena vacía', () => ''],
      ['firma de un caracter cambiada', () => { const g = good(); return g.slice(0, -1) + (g.endsWith('A') ? 'B' : 'A'); }],
    ];
    it.each(cases)('%s', (_name, token) => {
      expect(verifyPullToken(signer, token(), NOW)).toEqual({ ok: false, reason: 'invalid_token', slug: null });
    });
    it('CONTROL: el token sin alterar entra (si no, los rechazos de arriba no prueban nada)', () => {
      expect(verifyPullToken(signer, good(), NOW).ok).toBe(true);
    });
  });

  it('firma de OTRO dominio con la MISMA llave (mr-reveal) ⇒ invalid_token', () => {
    const p1 = signPullToken(signer, base).split('.')[0];
    expect(MANUAL_REFUND_REVEAL_DOMAIN).toBe('mr-reveal:v1:');
    expect(verifyPullToken(signer, forge(p1, MANUAL_REFUND_REVEAL_DOMAIN), NOW).ok).toBe(false);
  });

  it('firma SIN dominio (HMAC crudo con la misma llave, como el índice ciego) ⇒ invalid_token', () => {
    const p1 = signPullToken(signer, base).split('.')[0];
    const rawHmacB64url = createHmac('sha256', Buffer.from(KEY_A, 'base64').length >= 32 ? Buffer.from(KEY_A, 'base64') : Buffer.from(KEY_A))
      .update(p1)
      .digest('base64url');
    expect(signer.domainHmac('', p1)).toBe(rawHmacB64url); // el control: es de verdad el HMAC sin dominio
    expect(verifyPullToken(signer, `${p1}.${rawHmacB64url}`, NOW)).toEqual({ ok: false, reason: 'invalid_token', slug: null });
    // Y su índice ciego en hex tampoco.
    expect(verifyPullToken(signer, `${p1}.${signer.blindIndex(p1)}`, NOW).ok).toBe(false);
  });

  it('vigencia: 30 días exactos ⇒ vale; un segundo después ⇒ expired (con el slug firmado)', () => {
    expect(DECK_PULL_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
    const t = signPullToken(signer, base);
    expect(verifyPullToken(signer, t, NOW + DECK_PULL_TTL_SECONDS).ok).toBe(true);
    expect(verifyPullToken(signer, t, NOW + DECK_PULL_TTL_SECONDS + 1)).toEqual({
      ok: false,
      reason: 'expired',
      slug: 'dragapult-ex',
    });
  });

  it('firma válida pero vencida Y alterada ⇒ invalid_token (la firma se mira primero)', () => {
    const t = tamper(signPullToken(signer, base), (p) => { p.slug = 'x'; });
    expect(verifyPullToken(signer, t, NOW + DECK_PULL_TTL_SECONDS + 1)).toEqual({ ok: false, reason: 'invalid_token', slug: null });
  });

  describe('forma de la carga: aunque la firma sea buena (firmada con la llave), una carga mal formada ⇒ invalid_token', () => {
    const shape = (o: unknown) => forge(b64(JSON.stringify(o)));
    const ok = { v: 1, slug: 's', listId: 'l', ids: ['a', 'b'], iat: NOW };
    const cases: [string, unknown][] = [
      ['v ≠ 1', { ...ok, v: 2 }],
      ['ids no ordenados', { ...ok, ids: ['b', 'a'] }],
      ['ids repetidos', { ...ok, ids: ['a', 'a'] }],
      ['id no cadena', { ...ok, ids: ['a', 3] }],
      ['ids no arreglo', { ...ok, ids: 'a' }],
      ['slug vacío', { ...ok, slug: '' }],
      ['listId ausente', { v: 1, slug: 's', ids: [], iat: NOW }],
      ['iat no entero', { ...ok, iat: NOW + 0.5 }],
      ['iat negativo', { ...ok, iat: -1 }],
      ['iat en el futuro (> 5 min)', { ...ok, iat: NOW + 301 }],
      ['llave extra', { ...ok, extra: 1 }],
      ['no es objeto', [1, 2]],
    ];
    it.each(cases)('%s', (_n, payload) => {
      expect(verifyPullToken(signer, shape(payload), NOW)).toEqual({ ok: false, reason: 'invalid_token', slug: null });
    });
    it('CONTROL: la misma carga bien formada, firmada igual, entra', () => {
      expect(verifyPullToken(signer, shape(ok), NOW).ok).toBe(true);
    });
    it('parte 1 que no es JSON, firmada ⇒ invalid_token (no revienta)', () => {
      expect(verifyPullToken(signer, forge(b64('{no json')), NOW).ok).toBe(false);
    });
  });

  it('token más largo que 4096 ⇒ invalid_token sin calcular nada', () => {
    const spy = jest.spyOn(signer, 'domainHmac');
    expect(verifyPullToken(signer, 'a'.repeat(4097), NOW).ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('no-cadena ⇒ invalid_token', () => {
    expect(verifyPullToken(signer, undefined, NOW).ok).toBe(false);
    expect(verifyPullToken(signer, 42, NOW).ok).toBe(false);
    expect(verifyPullToken(signer, { pullToken: 'x' }, NOW).ok).toBe(false);
  });

  it('la comparación es en tiempo constante: usa constantTimeEquals del servicio', () => {
    const spy = jest.spyOn(signer, 'constantTimeEquals');
    verifyPullToken(signer, signPullToken(signer, base), NOW);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
