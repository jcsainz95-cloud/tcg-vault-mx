import { describe, it, expect } from 'vitest';
import {
  getCatalog,
  getCatalogFacets,
  getPortfolioHistory,
  getBuylistQuote,
  loginWithGoogle,
  presignUpload,
} from './api';
import { getToken, setToken } from './api-client';

// Estas pruebas ejercitan la RAMA MOCK del cliente (config.useMocks = true por defecto
// en test, ya que NEXT_PUBLIC_USE_MOCKS !== 'false'). Verifican que las llamadas nuevas
// de v1.1 devuelven shapes del contrato sin backend (para Vercel).

describe('api (rama mock, v1.1)', () => {
  it('getCatalog filtra por rareza cruda (multi) sobre inventario publicado', async () => {
    const res = await getCatalog({ rarity: ['Illustration Rare'] });
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data.every((l) => l.card.rarity === 'Illustration Rare')).toBe(true);
  });

  it('getCatalog nunca devuelve items "precio pendiente" (Compra = solo con precio)', async () => {
    const res = await getCatalog({});
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data.every((l) => l.sellable && l.salePriceCents != null)).toBe(true);
  });

  it('getCatalog filtra por rango de precio (centavos)', async () => {
    const res = await getCatalog({ maxPriceCents: 50000 });
    expect(res.data.every((l) => (l.salePriceCents ?? 0) <= 50000)).toBe(true);
  });

  it('getCatalogFacets devuelve rarezas, sets con año (desc) y rango de precio', async () => {
    const f = await getCatalogFacets();
    expect(f.rarities.length).toBeGreaterThan(0);
    expect(f.sets.length).toBeGreaterThan(0);
    // sets ordenados por año descendente
    const years = f.sets.map((s) => s.year ?? 0);
    expect([...years].sort((a, b) => b - a)).toEqual(years);
    expect(f.price.currency).toBe('MXN');
  });

  it('getCatalogFacets expone las facetas de acabado (v1.6-finish)', async () => {
    const f = await getCatalogFacets();
    expect(f.finishes.length).toBeGreaterThan(0);
    // Todos los acabados de la faceta pertenecen al enum Finish.
    const valid = new Set(['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil']);
    expect(f.finishes.every((x) => valid.has(x))).toBe(true);
  });

  it('getCatalog filtra por acabado (v1.6-finish): solo listings de ese finish', async () => {
    const res = await getCatalog({ finish: 'reverse_holo' });
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data.every((l) => l.finish === 'reverse_holo')).toBe(true);
  });

  it('getPortfolioHistory devuelve serie ordenada + change con dirección', async () => {
    const h = await getPortfolioHistory('1m');
    expect(h.range).toBe('1m');
    expect(h.points.length).toBeGreaterThan(1);
    expect(['up', 'down', 'flat']).toContain(h.change.direction);
    // fechas ascendentes
    const dates = h.points.map((p) => p.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('buylist: rareza sin regla explícita (Ultra Rare) usa el fallback pct (40% de la referencia)', async () => {
    const q = await getBuylistQuote({ cardId: 'c-milotic-fa', productType: 'raw', rawCondition: 'NM' });
    expect(q.rarity).toBe('Ultra Rare');
    expect(q.appliedRule).toEqual({ mode: 'pct', value: 40, source: 'fallback' });
    expect(q.quote.status).toBe('cotizada');
    expect(q.quote.quotedPriceCents).toBe(Math.round(210000 * 0.4));
  });

  it('buylist: rareza con regla fija (Common) cotiza el monto fijo sin depender de la referencia', async () => {
    const q = await getBuylistQuote({ cardId: 'c-pikachu', productType: 'raw', rawCondition: 'NM' });
    expect(q.rarity).toBe('Common');
    expect(q.appliedRule).toEqual({ mode: 'fixed', value: 50, source: 'rule' });
    expect(q.quote.quotedPriceCents).toBe(50);
  });

  it('buylist: carta sin market price (Zapdos) escala a precio pendiente (adquisición)', async () => {
    const q = await getBuylistQuote({ cardId: 'c-zapdos', productType: 'raw', rawCondition: 'NM' });
    expect(q.quote.status).toBe('precio_pendiente');
    expect(q.quote.quotedPriceCents).toBeNull();
  });

  it('buylist (v1.6-finish): el acabado selecciona la regla — Common + reverse_holo = "Reverse Holo" fijo $1.50', async () => {
    const q = await getBuylistQuote({
      cardId: 'c-pikachu',
      productType: 'raw',
      rawCondition: 'NM',
      finish: 'reverse_holo',
    });
    // El backend deriva la regla del acabado (no de la rareza base): Reverse Holo fijo 150.
    expect(q.finish).toBe('reverse_holo');
    expect(q.appliedRule).toEqual({ mode: 'fixed', value: 150, source: 'rule' });
    expect(q.quote.quotedPriceCents).toBe(150);
  });

  it('buylist (v1.6-finish): sin finish la respuesta ecoa el default normal', async () => {
    const q = await getBuylistQuote({ cardId: 'c-pikachu', productType: 'raw', rawCondition: 'NM' });
    expect(q.finish).toBe('normal');
    expect(q.appliedRule).toEqual({ mode: 'fixed', value: 50, source: 'rule' });
  });

  it('presignUpload (mock) devuelve maxBytes como tope de tamaño del presign', async () => {
    const p = await presignUpload({ purpose: 'kyc_ine', contentType: 'image/jpeg', contentLength: 1234 });
    expect(p.uploadKey).toMatch(/^kyc_ine\//);
    expect(p.method).toBe('PUT');
    // El presign trae el límite de tamaño (fuente única de verdad en cliente).
    expect(typeof p.maxBytes).toBe('number');
    expect(p.maxBytes).toBeGreaterThan(0);
  });

  it('loginWithGoogle (mock) deja sesión y marca authProvider=google', async () => {
    setToken(null);
    const res = await loginWithGoogle('mock-id-token');
    expect(res.user.authProvider).toBe('google');
    expect(getToken()).toBe('mock.session.token');
  });
});
