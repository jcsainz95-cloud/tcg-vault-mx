import { BuylistService } from '../src/modules/buylist/buylist.service';
import { revisionReasonText } from '../src/modules/buylist/buylist-flujo-dto';
import { sellItemVersionHigherTemplate, sellItemRevisionTemplate } from '../src/modules/buylist/buylist-flujo-mail.templates';
import { scaleByPct } from '../src/common/card-version';

/**
 * §BUYLIST-ES F3 (API_CONTRACT_BUYLIST_ES §4.3, §4.4, §9.2, §9.3) — piezas puras: desglose de lo recibido, DTO de cliente recortado (BES-4),
 * tope duro de staff (BES-6), versiones del congelado y plantillas de los correos de versión.
 */
const S = BuylistService as unknown as Record<string, (...a: any[]) => any>;

describe('§4.3 receivedBreakdownOf — desglose de lo recibido (P congelado, un solo redondeo)', () => {
  it('ES: mercado + castigo = ajustado exacto y curveBp informativo; EN: sin castigo', () => {
    for (const market of [100_000, 100_100, 12_345, 7_777]) {
      const b = S.receivedBreakdownOf({ market, penaltyPct: 15, language: 'es', finalCents: 1000 });
      expect(b.source).toBe('received');
      expect(b.marketMxnCents + b.languagePenalty.cents).toBe(b.adjustedMarketCents);
      expect(b.languagePenalty.cents).toBe(-scaleByPct(market, 15));
      expect(b.cap).toBeNull();
      expect(b.finalOfferCents).toBe(1000);
    }
    const en = S.receivedBreakdownOf({ market: 50_000, penaltyPct: 15, language: 'en', finalCents: 25_000 });
    expect(en.languagePenalty).toBeNull();
    expect(en.adjustedMarketCents).toBe(50_000);
  });
  it('sin mercado: monto sí, mercado/ajustado/curva null (nunca un 0 inventado)', () => {
    const b = S.receivedBreakdownOf({ market: null, penaltyPct: 15, language: 'es', finalCents: 300 });
    expect([b.marketMxnCents, b.adjustedMarketCents, b.curveBp, b.finalOfferCents]).toEqual([null, null, null, 300]);
  });
});

describe('§9.2 BES-4 — el DTO del cliente no publica el piso ni la curva sin tope', () => {
  const base = { marketMxnCents: 100_000, languagePenalty: { pct: 15, cents: -15_000 }, adjustedMarketCents: 85_000, source: 'curve', finalOfferCents: 30_000 };
  it('piso ⇒ sin curveOfferCents, sin cap.cents y curveBp null; admin intacto', () => {
    const raw = { ...base, curveBp: 3500, curveOfferCents: 29_750, cap: { reason: 'floor', cents: 30_000 } } as never;
    const c = S.breakdownFor(raw, 'client');
    expect(c).not.toHaveProperty('curveOfferCents');
    expect(c.cap).toEqual({ reason: 'floor' });
    expect(c.curveBp).toBeNull();
    expect(S.breakdownFor(raw, 'admin')).toEqual(raw);
  });
  it('en_offer ⇒ el monto del tope es su propia oferta (finalOfferCents), sin cap.cents; curveBp se conserva', () => {
    const c = S.breakdownFor({ ...base, curveBp: 5000, curveOfferCents: 42_500, cap: { reason: 'en_offer', cents: 30_000 } } as never, 'client');
    expect(c.cap).toEqual({ reason: 'en_offer' });
    expect(c.finalOfferCents).toBe(30_000);
    expect(c.curveBp).toBe(5000);
    expect(JSON.stringify(c)).not.toContain('curveOfferCents');
  });
  it('sin tope ⇒ cap null; null ⇒ null', () => {
    expect(S.breakdownFor({ ...base, curveBp: 5000, curveOfferCents: 30_000, cap: null } as never, 'client').cap).toBeNull();
    expect(S.breakdownFor(null, 'client')).toBeNull();
  });
});

describe('§9.3 BES-6 — tope duro de staff en línea ES / liga', () => {
  const d = (en: number | null, ref: number | null, stamp: unknown = null) => ({ offers: { en }, referenceMxnCents: ref, stamp });
  it('ES: min(EN viva, referencia); un centavo más ⇒ 422 ES_OVER_CAP con capCents', () => {
    const cap = S.esCapOf({ language: 'es' }, d(50_000, 40_000));
    expect(cap).toEqual({ applies: true, capCents: 40_000 });
    expect(() => S.assertEsCap(cap, 40_000, 'i')).not.toThrow();
    expect(() => S.assertEsCap(cap, 40_001, 'i')).toThrow(expect.objectContaining({ code: 'ES_OVER_CAP' }));
  });
  it('EN normal: no aplica; EN de liga: solo ≤ referencia; ES sin datos: falla cerrado', () => {
    expect(S.esCapOf({ language: 'en' }, d(50_000, 100_000))).toEqual({ applies: false, capCents: null });
    expect(S.esCapOf({ language: 'en' }, d(50_000, 100_000, { productId: 1 }))).toEqual({ applies: true, capCents: 100_000 });
    expect(() => S.assertEsCap(S.esCapOf({ language: 'es' }, d(null, null)), 1, 'i')).toThrow(expect.objectContaining({ code: 'ES_OVER_CAP' }));
  });
});

describe('versiones congeladas', () => {
  it('declaredKeyOf: liga solo si el producto es una versión del congelado; si no, el idioma', () => {
    expect(S.declaredKeyOf({ language: 'es', cardProductId: 77, versionOffers: { en: 1, es: 1, 'es.77': 1 } })).toBe('es.77');
    expect(S.declaredKeyOf({ language: 'en', cardProductId: 55, versionOffers: { en: 1 } })).toBe('en'); // promo/deck_exclusive
    expect(S.declaredKeyOf({ language: 'en', cardProductId: null, versionOffers: null })).toBe('en');
  });
  it('versionRows: en y es de UNA versión, con su mercado; sin castigo ⇒ solo en; sin oferta ⇒ razón', () => {
    const rows = S.versionRows({ productId: 9, type: 'league', label: null }, 100_000, { enOffer: 50_000, es: { offerCents: 42_500 } });
    expect(rows.map((r: any) => [r.key, r.offerCents, r.marketCents, r.reason])).toEqual([
      ['en.9', 50_000, 100_000, null],
      ['es.9', 42_500, 100_000, null],
    ]);
    expect(S.versionRows(null, null, { enOffer: null, es: null }).map((r: any) => [r.key, r.reason, r.marketCents])).toEqual([['en', 'no_reference', null]]);
    expect(S.versionRows(null, 100_000, { enOffer: null, es: null })[0].reason).toBe('precio_pendiente');
  });
  it('OVER_VERSION_CAP: ningún monto supera lo que vale lo recibido', () => {
    expect(() => S.assertWithinReceivedVersion(42_501, 42_500, 'i')).toThrow(expect.objectContaining({ code: 'OVER_VERSION_CAP' }));
    expect(() => S.assertWithinReceivedVersion(42_500, 42_500, 'i')).not.toThrow();
    expect(() => S.assertWithinReceivedVersion(99_999, null, 'i')).not.toThrow();
  });
  it('receivedPayCentsOf: solo con la versión decidida y fuente `received`', () => {
    expect(S.receivedPayCentsOf({ receivedVersionSet: true, receivedBreakdown: { source: 'received', finalOfferCents: 123 } })).toBe(123);
    expect(S.receivedPayCentsOf({ receivedVersionSet: false, receivedBreakdown: { source: 'received', finalOfferCents: 123 } })).toBeNull();
    expect(S.receivedPayCentsOf({ receivedVersionSet: true, receivedBreakdown: null })).toBeNull();
  });
});

describe('§4.4 correos de versión (es/en) y texto de la baja para el vendedor', () => {
  const card = { cardName: 'Charizard', setName: 'Base', cardNumber: '4', finish: 'normal' as const };
  it('baja: «llegó como X y declaraste Y; nueva oferta … (antes …)», sin cifras internas', () => {
    for (const [locale, re] of [['es', /llegó como Español y declaraste Inglés; nueva oferta .*425.* \(antes .*500/], ['en', /arrived as Spanish but you declared English; new offer .*425.* \(was .*500/]] as const) {
      const m = sellItemRevisionTemplate(
        { folio: 'F1', card, offeredCents: 50_000, proposedCents: 42_500, cause: 'version_mismatch', version: locale === 'es' ? { declared: 'Inglés', received: 'Español' } : { declared: 'English', received: 'Spanish' }, expiresAt: new Date('2026-12-05T12:00:00Z'), responseDays: 7, reminder: false },
        'Ana',
        locale,
      );
      expect(m.text).toMatch(re);
      expect(m.text).not.toMatch(/curveOfferCents|piso|floor/i);
    }
  });
  it('alza: «Te pagamos MX$X por tu {carta} ({versión})»', () => {
    const es = sellItemVersionHigherTemplate({ folio: 'F1', card, payCents: 50_000, versionName: 'Inglés' }, 'Ana', 'es');
    expect(es.text).toMatch(/Te pagamos .*500.* por tu .*Charizard.* \(Inglés\)\./);
    const en = sellItemVersionHigherTemplate({ folio: 'F1', card, payCents: 50_000, versionName: 'English' }, 'Ana', 'en');
    expect(en.text).toMatch(/We pay .*500.* for your .*Charizard.* \(English\)\./);
  });
  it('texto de la causa para el vendedor (es/en), nunca el código interno', () => {
    expect(revisionReasonText('version_mismatch', null, 'es')).toMatch(/versión distinta/);
    expect(revisionReasonText('version_mismatch', null, 'en')).toMatch(/different version/);
  });
});
