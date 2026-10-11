import * as fs from 'fs';
import * as path from 'path';
import { TcgdexBulkProvider, normalizeNumber, isoDay, extractSetCards } from './tcgdex-bulk.provider';
import { TcgdexHttpClient } from './tcgdex-http.client';

const FIX = path.join(__dirname, '../../../../test/fixtures/tcgdex');
const load = (f: string) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));

/** Cliente HTTP falso que sirve las fixtures REALES por ruta (sin red). */
class FakeHttp extends TcgdexHttpClient {
  calls: string[] = [];
  async getSetBrief(id: string): Promise<unknown> {
    this.calls.push(`set:${id}`);
    return load('set-sv08.5-brief.json');
  }
  async getCard(id: string): Promise<unknown> {
    this.calls.push(`card:${id}`);
    const n = id.split('-').pop();
    return load(`card-sv08.5-${n}.json`);
  }
}

describe('TcgdexBulkProvider — fetch + parse + horneado FX (M-75 §PRE, DINERO, fixtures REALES)', () => {
  const fxUsd = { rate: 18, bufferPct: 0 }; // 1 USD = 18 MXN, sin colchón ⇒ fácil de comprobar
  const fxEur = { rate: 20, bufferPct: 0 }; // 1 EUR = 20 MXN

  it('hornea tcgplayer USD y cardmarket EUR a MXN, por variante, con el número como join', async () => {
    const http = new FakeHttp();
    const provider = new TcgdexBulkProvider(http);
    const rows = await provider.fetchSetPrices({
      tcgdexSetId: 'sv08.5',
      // brief trae cartas 001..005; pedimos las que tenemos (001)
      cards: [{ cardId: 'our-exeggcute', number: '1' }],
      fxUsd,
      fxEur,
    });
    // Exeggcute (001): tcgplayer normal 5¢ + reverse 16¢; cardmarket base 4¢ + holo 7¢.
    const tpNormal = rows.find((r) => r.source === 'tcgdex' && r.finish === 'normal');
    expect(tpNormal).toMatchObject({ cardId: 'our-exeggcute', marketCents: 5, currency: 'USD', priceMxnCents: 90 }); // 5×18
    const tpReverse = rows.find((r) => r.source === 'tcgdex' && r.finish === 'reverse_holo');
    expect(tpReverse).toMatchObject({ marketCents: 16, priceMxnCents: 288 }); // 16×18
    const cmHolo = rows.find((r) => r.source === 'cardmarket' && r.finish === 'holofoil');
    expect(cmHolo).toMatchObject({ currency: 'EUR', marketCents: 7, priceMxnCents: 140 }); // 7×20
    // Todas raw:NM, cardProductId null
    for (const r of rows) {
      expect(r).toMatchObject({ productType: 'raw', gradeKey: 'raw:NM', cardProductId: null });
    }
  });

  it('fxEur=null ⇒ cardmarket NO vota (solo filas tcgdex)', async () => {
    const provider = new TcgdexBulkProvider(new FakeHttp());
    const rows = await provider.fetchSetPrices({
      tcgdexSetId: 'sv08.5',
      cards: [{ cardId: 'our-exeggcute', number: '001' }],
      fxUsd,
      fxEur: null,
    });
    expect(rows.every((r) => r.source === 'tcgdex')).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('solo pide y mapea las cartas que TENEMOS en catálogo (join por número)', async () => {
    const http = new FakeHttp();
    const provider = new TcgdexBulkProvider(http);
    await provider.fetchSetPrices({
      tcgdexSetId: 'sv08.5',
      cards: [{ cardId: 'x', number: '999' }], // no existe en el brief
      fxUsd,
      fxEur,
    });
    // pidió el set, pero NINGUNA carta (999 no está en el brief)
    expect(http.calls.filter((c) => c.startsWith('card:'))).toHaveLength(0);
  });

  it('una carta que falla NO tumba el set (money-safe: queda sin fuente TCGdex)', async () => {
    class FlakyHttp extends FakeHttp {
      async getCard(id: string): Promise<unknown> {
        if (id.endsWith('001')) throw new Error('boom');
        return super.getCard(id);
      }
    }
    const http = new FlakyHttp();
    const provider = new TcgdexBulkProvider(http);
    const rows = await provider.fetchSetPrices({
      tcgdexSetId: 'sv08.5',
      cards: [
        { cardId: 'a', number: '1' },
        { cardId: 'b', number: '2' },
      ],
      fxUsd,
      fxEur,
    });
    // 001 falló; 002 (Exeggutor) no está en nuestras fixtures de carta → también fallará su load.
    // Lo que importa: NO lanza; devuelve lo que pudo.
    expect(Array.isArray(rows)).toBe(true);
  });
});

describe('helpers del provider', () => {
  it('normalizeNumber quita ceros a la izquierda ("070"↔"70")', () => {
    expect(normalizeNumber('070')).toBe('70');
    expect(normalizeNumber('70')).toBe('70');
    expect(normalizeNumber('001')).toBe('1');
    expect(normalizeNumber('TG12')).toBe('tg12');
  });
  it('isoDay extrae el día; fallback si no parsea', () => {
    expect(isoDay('2026-10-10T22:55:16.000Z', '2026-01-01')).toBe('2026-10-10');
    expect(isoDay('basura', '2026-01-01')).toBe('2026-01-01');
  });
  it('extractSetCards tolera forma inesperada', () => {
    expect(extractSetCards({ cards: [{ localId: '1', id: 'x-1' }] })).toHaveLength(1);
    expect(extractSetCards({})).toHaveLength(0);
    expect(extractSetCards(null)).toHaveLength(0);
  });
});
