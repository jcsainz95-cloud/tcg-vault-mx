import { describe, expect, it, vi, beforeEach } from 'vitest';

const getMerchantFeed = vi.fn();
vi.mock('@/lib/api/merchant-feed', () => ({ getMerchantFeed: (...a: unknown[]) => getMerchantFeed(...a) }));

import { GET } from './route';
import { resetSnapshotCache } from '@/lib/snapshot-cache';
import type { MerchantFeedItem } from '@/lib/api/merchant-feed';
import { buildMerchantFeedXml, escapeXml, stripXmlInvalid } from '@/lib/merchant-feed-xml';

const item = (o: Partial<MerchantFeedItem> = {}): MerchantFeedItem => ({
  id: 'card:a', kind: 'card', path: '/catalog/a', shippingCents: 10000, title: 'Pikachu & "Raichu" <ex>', description: 'Línea 1\n<b>x</b> \u0001ok',
  imageUrl: 'https://images.pokemontcg.io/a.png', priceCents: 10500, condition: 'used', brand: 'Pokémon', gtin: null, ...o,
});

beforeEach(() => {
  resetSnapshotCache();
  vi.useRealTimers();
  getMerchantFeed.mockReset();
});

describe('§GSHOP ruta /feeds/google-merchant.xml', () => {
  it('200: XML, cabeceras, precio «105.00 MXN», enlaces absolutos https, escapes', async () => {
    getMerchantFeed.mockResolvedValue({ items: [item(), item({ id: 'x', priceCents: 0 })], generatedAt: 'x' });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/xml; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=60');
    expect(res.headers.get('Cache-Control')).not.toContain('stale-while-revalidate');
    // Sin caché de datos de Next hacia el backend (con `revalidate: 900` la copia llegó a 55 min).
    expect(getMerchantFeed).toHaveBeenCalledWith({ cache: 'no-store' });
    expect(res.headers.get('X-Feed-Items')).toBe('1');
    expect(res.headers.get('X-Feed-Skipped')).toBe('1');
    const xml = await res.text();
    expect(xml).toContain('<g:price>105.00 MXN</g:price>');
    expect(xml).toContain('<g:link>https://tcghunt.mx/es/catalog/a</g:link>');
    expect(xml).toContain('Pikachu &amp; &quot;Raichu&quot; &lt;ex&gt;');
    expect(xml).toContain('<g:shipping>');
    expect(xml).toContain('<g:price>100.00 MXN</g:price>');
    expect(xml).toContain('<g:identifier_exists>no</g:identifier_exists>');
    expect(xml).not.toContain('\u0001');
    expect(xml).not.toMatch(/<g:description>[^<]*<b>/);
  });

  it('503 si el backend responde 503 / falla', async () => {
    getMerchantFeed.mockRejectedValue(Object.assign(new Error('x'), { status: 503 }));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('503 con 0 ítems (nunca un 200 vacío) y si todos se omiten', async () => {
    getMerchantFeed.mockResolvedValue({ items: [], generatedAt: 'x' });
    expect((await GET()).status).toBe(503);
    getMerchantFeed.mockResolvedValue({ items: [item({ imageUrl: null })], generatedAt: 'x' });
    expect((await GET()).status).toBe(503);
  });

  it('sin shippingCents se omite <g:shipping> (no se inventa importe)', async () => {
    getMerchantFeed.mockResolvedValue({ items: [item({ shippingCents: undefined })], generatedAt: 'x' });
    expect(await (await GET()).text()).not.toContain('<g:shipping>');
  });
});

describe('§GSHOP memoria de 60 s del feed', () => {
  it('dentro de 60 s no vuelve a pegarle al backend; pasado el tope, regenera; con backend caído ⇒ 503', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T12:00:00Z'));
    getMerchantFeed.mockResolvedValue({ items: [item()], generatedAt: 'x' });
    expect((await GET()).status).toBe(200);
    vi.advanceTimersByTime(59_000);
    expect((await GET()).status).toBe(200);
    expect(getMerchantFeed).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    getMerchantFeed.mockRejectedValue(new Error('x'));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(getMerchantFeed).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('merchant-feed-xml', () => {
  it("escapa nombres con < > & comillas en título y descripción (Farfetch'd & <Mr. \"Mime\">)", () => {
    const n = `Farfetch'd & <Mr. "Mime">`;
    const { xml } = buildMerchantFeedXml([item({ title: n, description: n })]);
    const esc = 'Farfetch&apos;d &amp; &lt;Mr. &quot;Mime&quot;&gt;';
    expect(xml).toContain(`<g:title>${esc}</g:title>`);
    expect(xml).toContain(`<g:description>${esc}</g:description>`);
  });
  it('availability sale del DTO; desconocido ⇒ in_stock', () => {
    expect(buildMerchantFeedXml([item({ availability: 'out_of_stock' })]).xml).toContain('<g:availability>out_of_stock<');
    expect(buildMerchantFeedXml([item()]).xml).toContain('<g:availability>in_stock<');
  });
  it('escapeXml y caracteres de control', () => {
    expect(escapeXml(`a&b<c>"d"'e'`)).toBe('a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;');
    expect(stripXmlInvalid('a\u0000b\u0008c\ud800d')).toBe('abcd');
  });
  it('envío gratis desde el umbral; imagen http o ausente se omite; título ≤150', () => {
    const r = buildMerchantFeedXml(
      [item({ priceCents: 400000, shippingCents: 0 }), item({ imageUrl: 'http://x/a.png' }), item({ title: 'T'.repeat(300) })],
    );
    expect(r.items).toBe(2);
    expect(r.skipped).toBe(1);
    expect(r.xml).toContain('<g:price>0.00 MXN</g:price>');
    expect(r.xml).toContain(`<g:title>${'T'.repeat(150)}</g:title>`);
  });
  it('XML bien formado (DOMParser)', () => {
    const { xml } = buildMerchantFeedXml([item()]);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.getElementsByTagName('parsererror').length).toBe(0);
    expect(doc.getElementsByTagName('item').length).toBe(1);
  });
});
