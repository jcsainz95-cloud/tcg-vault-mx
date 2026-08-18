/**
 * buylist-cards-order.e2e-spec.ts — Integración/E2E contra Postgres real.
 *
 * TEST OBLIGATORIO de ARCHITECTURE §4.22 («Reparto de trabajo → Tests obligatorios»): el orden
 * natural de `GET /buylist/cards` debe sobrevivir A TRAVÉS de la paginación — un conjunto con
 * números puros y DOS prefijos de promo sale en orden global correcto atravesando varias páginas,
 * sin filas repetidas ni saltadas. Es la regresión directa de ORD-1 (el `orderBy` viejo
 * `[{name},{number}]` ordenaba `"10"` antes que `"2"` porque `Card.number` es String) y del motivo
 * por el que se eligieron COLUMNAS PERSISTIDAS (M-26): ordenar en memoria tras el `skip/take`
 * reordena la PÁGINA, no el conjunto.
 *
 * También ancla en integración la garantía de VARIANTES del mismo endpoint (§4.22c / API_CONTRACT
 * §6): `E2E Reverse Bird` llega con DOS acabados en orden canónico — el bug de tres rondas del PO.
 *
 * Oráculos: `E2E_ORDER_EXPECTED_NUMBERS` / `E2E_SET_EXPECTED_NUMBERS` (prisma/e2e-fixtures.ts) —
 * los mismos datos que siembra `seed-e2e.ts`, declarados a propósito en orden NO natural.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import {
  E2E_CARDS,
  E2E_ORDER_EXPECTED_NUMBERS,
  E2E_ORDER_SET,
  E2E_SET,
  E2E_SET_EXPECTED_NUMBERS,
} from '../../prisma/e2e-fixtures';

interface CardRow {
  id: string;
  number: string;
  numberSort: number;
  numberPrefix: string;
  name: string;
  availableFinishes: string[];
}

describe('E2E — GET /buylist/cards: orden natural PAGINADO (§4.22b) + variantes (§4.22c)', () => {
  let h: E2EHarness;
  let orderSetId: string;
  let baseSetId: string;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    const orderSet = await h.prisma.cardSet.findUnique({ where: { externalId: E2E_ORDER_SET.externalId } });
    const baseSet = await h.prisma.cardSet.findUnique({ where: { externalId: E2E_SET.externalId } });
    orderSetId = orderSet!.id;
    baseSetId = baseSet!.id;
  });

  afterAll(async () => {
    await h?.close();
  });

  /** Recorre TODAS las páginas de un set con el pageSize dado y concatena las filas. */
  async function fetchAllPages(setId: string, pageSize: number): Promise<{ rows: CardRow[]; total: number }> {
    const rows: CardRow[] = [];
    let total = Number.POSITIVE_INFINITY;
    for (let page = 1; (page - 1) * pageSize < total; page++) {
      const res = await h.api<{ data: CardRow[]; total: number; page: number; pageSize: number }>(
        'GET',
        `/buylist/cards?setId=${setId}&page=${page}&pageSize=${pageSize}`,
      );
      expect(res.status).toBe(200);
      total = res.body.total;
      rows.push(...res.body.data);
      if (res.body.data.length === 0) break; // guardia anti-bucle si total mintiera
    }
    return { rows, total };
  }

  it('["2","10","SV107","TG01"] sale en orden natural GLOBAL atravesando dos páginas (pageSize=2)', async () => {
    const { rows, total } = await fetchAllPages(orderSetId, 2);

    expect(total).toBe(E2E_ORDER_EXPECTED_NUMBERS.length); // 4 cartas → 2 páginas de 2
    // Orden GLOBAL: numéricos puros por entero (2 < 10), promos AL FINAL agrupados por prefijo
    // alfabético (SV < TG) — la razón de ser de numberPrefix: SV107 y TG01 no se distinguen solo
    // por numberSort si compartieran prefijo.
    expect(rows.map((c) => c.number)).toEqual([...E2E_ORDER_EXPECTED_NUMBERS]);
    // Sin duplicados ni huecos entre páginas (el {id:'asc'} final hace el orden TOTAL).
    expect(new Set(rows.map((c) => c.id)).size).toBe(rows.length);
    expect(rows).toHaveLength(total);
  });

  it('el mismo orden global se conserva con pageSize=1 (4 páginas) y con pageSize=3 (frontera desalineada)', async () => {
    for (const pageSize of [1, 3]) {
      const { rows, total } = await fetchAllPages(orderSetId, pageSize);
      expect(total).toBe(E2E_ORDER_EXPECTED_NUMBERS.length);
      expect(rows.map((c) => c.number)).toEqual([...E2E_ORDER_EXPECTED_NUMBERS]);
      expect(new Set(rows.map((c) => c.id)).size).toBe(rows.length);
    }
  });

  it('expone numberSort/numberPrefix (columnas M-26) coherentes con el orden servido', async () => {
    const { rows } = await fetchAllPages(orderSetId, 50);
    const byNumber = new Map(rows.map((c) => [c.number, c]));
    expect(byNumber.get('2')).toMatchObject({ numberSort: 2, numberPrefix: '' });
    expect(byNumber.get('10')).toMatchObject({ numberSort: 10, numberPrefix: '' });
    expect(byNumber.get('SV107')).toMatchObject({ numberSort: 1_000_107, numberPrefix: 'SV' });
    expect(byNumber.get('TG01')).toMatchObject({ numberSort: 1_000_001, numberPrefix: 'TG' });
    // SV107 sale ANTES que TG01 pese a numberSort MAYOR: manda numberPrefix (agrupación §4.22b).
    const idxSv = rows.findIndex((c) => c.number === 'SV107');
    const idxTg = rows.findIndex((c) => c.number === 'TG01');
    expect(idxSv).toBeLessThan(idxTg);
  });

  it('E2E Base Set pagina 4,16 / 17,20 / 25,99 con pageSize=2 y Reverse Bird trae DOS acabados en orden canónico', async () => {
    const { rows, total } = await fetchAllPages(baseSetId, 2);

    expect(total).toBe(E2E_SET_EXPECTED_NUMBERS.length); // 6 cartas → 3 páginas de 2
    expect(rows.map((c) => c.number)).toEqual([...E2E_SET_EXPECTED_NUMBERS]);
    expect(new Set(rows.map((c) => c.id)).size).toBe(rows.length);

    // §4.22c — el universo EXACTO de casillas del binder, en orden canónico FINISH_ORDER
    // (normal a la IZQUIERDA, reverse holo a la DERECHA): el requisito del PO de tres rondas.
    const reverseBird = rows.find((c) => c.name === E2E_CARDS.reverse.name)!;
    expect(reverseBird.availableFinishes).toEqual(['normal', 'reverse_holo']);
    // Y ninguna carta llega con el array vacío (mínimo ['normal']).
    for (const c of rows) expect(c.availableFinishes.length).toBeGreaterThanOrEqual(1);
  });
});
