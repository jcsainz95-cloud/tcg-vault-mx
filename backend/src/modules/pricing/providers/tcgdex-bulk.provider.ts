import { Injectable, Logger } from '@nestjs/common';
import { Finish } from '@prisma/client';
import { usdToMxnCents } from '../../../common/money';
import { TcgdexHttpClient } from './tcgdex-http.client';
import { parseCardPricing, TcgdexShapeError, FinishStr } from './tcgdex-shape';
import { TcgdexBulkPriceProvider, TcgdexFetchInput, TcgdexPriceRow } from './tcgdex.provider.interface';
import { matchTcgdexSet, extractTcgdexSets, TcgdexRemoteSet } from './tcgdex-set-mapper';

/**
 * tcgdex-bulk.provider.ts — v1.91⟨precios⟩ (M-75, §PRE.A / ARCHITECTURE §4.PRE (e)) — provider REAL de
 * TCGdex: cliente HTTP + parser + horneado FX ⇒ filas `PriceReference` por variante. 💰 DINERO.
 *
 * Flujo de `fetchSetPrices`:
 *  1. `GET /v2/en/sets/{tcgdexSetId}` (breve) ⇒ lista de cartas `{ localId, id }` (⚠️ SIN pricing).
 *  2. Por carta (concurrencia acotada): `GET /v2/en/cards/{id}` ⇒ `parseCardPricing` (3 variantes
 *     tcgplayer USD + cardmarket plano EUR).
 *  3. Join por NÚMERO (localId ↔ nuestro `Card.number`, criterio 884 — NUNCA por nombre).
 *  4. Hornea FX: `tcgdex` (USD) con `fxUsd`, `cardmarket` (EUR) con `fxEur`. `fxEur=null` ⇒ cardmarket
 *     NO vota este barrido (no hay serie EUR todavía; devops la cablea en `fx-refresh`).
 *
 * Tolerancia money-safe: una carta que falla (red/forma) NO tumba el set — se omite y se loguea (esa
 * carta queda sin fuente TCGdex, cae a lo que haya; NUNCA hereda precio). El candado de forma
 * (`TcgdexShapeError`) de UNA carta se trata como fallo de esa carta, no del set.
 */
@Injectable()
export class TcgdexBulkProvider implements TcgdexBulkPriceProvider {
  private readonly logger = new Logger(TcgdexBulkProvider.name);
  /** Concurrencia de llamadas por-carta: el set no trae pricing ⇒ 1 llamada/carta. Acotada para no
   * ahogar el barrido ni a TCGdex (sin rate-limit publicado; medido ~0.18 s/carta el 2026-10-11). */
  private readonly CONCURRENCY = 6;

  /** Caché en memoria de la lista de sets de TCGdex (UNA carga por instancia/corrida, como PptSetMapper). */
  private remoteSets: TcgdexRemoteSet[] | null = null;

  constructor(private readonly http: TcgdexHttpClient) {}

  /**
   * Resuelve el `tcgdexSetId` de NUESTRO `CardSet` por nombre + nº de cartas oficiales (criterio 885,
   * sin puente frágil). `null` ⇒ TCGdex no cubre el set (sus cartas caen a lo que haya; NO heredan).
   * La lista `/sets` se carga UNA vez y se cachea; un fallo de red ⇒ `null` (no tumba el barrido).
   */
  async resolveTcgdexSetId(local: { name: string; printedTotal: number | null }): Promise<string | null> {
    try {
      if (this.remoteSets == null) {
        this.remoteSets = extractTcgdexSets(await this.http.listSets());
      }
      return matchTcgdexSet(local, this.remoteSets);
    } catch (e) {
      this.logger.warn(`tcgdex: no se pudo resolver el set "${local.name}" (${(e as Error).message}); sin fuente TCGdex.`);
      return null;
    }
  }

  async fetchSetPrices(input: TcgdexFetchInput): Promise<TcgdexPriceRow[]> {
    const { tcgdexSetId, cards, fxUsd, fxEur } = input;
    // Índice número normalizado → nuestro cardId (join por número, criterio 884).
    const byNumber = new Map<string, string>();
    for (const c of cards) byNumber.set(normalizeNumber(c.number), c.cardId);

    let brief: unknown;
    try {
      brief = await this.http.getSetBrief(tcgdexSetId);
    } catch (e) {
      this.logger.warn(`tcgdex set ${tcgdexSetId}: no se pudo leer el set (${(e as Error).message}); 0 filas.`);
      return [];
    }
    const cardStubs = extractSetCards(brief);
    if (cardStubs.length === 0) {
      this.logger.warn(`tcgdex set ${tcgdexSetId}: el set no trae cartas (forma inesperada); 0 filas.`);
      return [];
    }

    // Solo pedimos las cartas que TENEMOS en catálogo (join por número); las demás no nos sirven.
    const wanted = cardStubs.filter((s) => byNumber.has(normalizeNumber(s.localId)));
    const capturedDate = new Date().toISOString().slice(0, 10);
    const rows: TcgdexPriceRow[] = [];
    let shapeFailures = 0;
    let fetchFailures = 0;

    for (let i = 0; i < wanted.length; i += this.CONCURRENCY) {
      const batch = wanted.slice(i, i + this.CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (stub) => {
          const cardId = byNumber.get(normalizeNumber(stub.localId));
          if (!cardId) return [];
          try {
            const card = await this.http.getCard(stub.id);
            const pricing = (card as { pricing?: unknown }).pricing;
            const quotes = parseCardPricing(pricing);
            return quotes.flatMap((q): TcgdexPriceRow[] => {
              if (q.feed === 'tcgplayer') {
                return [
                  {
                    source: 'tcgdex',
                    cardId,
                    finish: finishStrToEnum(q.finish),
                    marketCents: q.amountCents,
                    currency: 'USD',
                    priceMxnCents: usdToMxnCents(q.amountCents, fxUsd.rate, fxUsd.bufferPct),
                    capturedDate: isoDay(q.updatedIso, capturedDate),
                    productType: 'raw',
                    gradeKey: 'raw:NM',
                    cardProductId: null,
                  },
                ];
              }
              // cardmarket (EUR): sin serie EUR ⇒ no vota este barrido.
              if (fxEur == null) return [];
              return [
                {
                  source: 'cardmarket',
                  cardId,
                  finish: finishStrToEnum(q.finish),
                  marketCents: q.amountCents,
                  currency: 'EUR',
                  priceMxnCents: usdToMxnCents(q.amountCents, fxEur.rate, fxEur.bufferPct),
                  capturedDate: isoDay(q.updatedIso, capturedDate),
                  productType: 'raw',
                  gradeKey: 'raw:NM',
                  cardProductId: null,
                },
              ];
            });
          } catch (e) {
            if (e instanceof TcgdexShapeError) shapeFailures++;
            else fetchFailures++;
            return [];
          }
        }),
      );
      for (const r of results) rows.push(...r);
    }

    if (shapeFailures > 0 || fetchFailures > 0) {
      this.logger.warn(
        `tcgdex set ${tcgdexSetId}: ${rows.length} fila(s) de ${wanted.length} carta(s); ` +
          `${fetchFailures} fallo(s) de red, ${shapeFailures} de FORMA (candado) — esas cartas sin fuente TCGdex.`,
      );
    } else {
      this.logger.log(`tcgdex set ${tcgdexSetId}: ${rows.length} fila(s) de ${wanted.length} carta(s).`);
    }
    return rows;
  }
}

/** Normaliza un número de carta para el join (sin ceros a la izquierda, sin espacios). `"070"`↔`"70"`. */
export function normalizeNumber(n: string | null | undefined): string {
  const s = (n ?? '').trim();
  const m = /^0*(\d+)$/.exec(s);
  return m ? m[1] : s.toLowerCase();
}

/** Mapea nuestro `FinishStr` al enum `Finish` de Prisma (son los mismos literales). */
export function finishStrToEnum(f: FinishStr): Finish {
  return f as Finish;
}

/** Un día 'YYYY-MM-DD' de un ISO; si el ISO no parsea, cae al `capturedDate` del barrido. */
export function isoDay(iso: string, fallback: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : fallback;
}

/** Extrae `cards:[{localId,id}]` del set breve (defensivo). */
export function extractSetCards(brief: unknown): { localId: string; id: string }[] {
  if (brief && typeof brief === 'object' && Array.isArray((brief as { cards?: unknown }).cards)) {
    return ((brief as { cards: unknown[] }).cards)
      .filter(
        (c): c is { localId: string; id: string } =>
          typeof c === 'object' &&
          c !== null &&
          typeof (c as { localId?: unknown }).localId === 'string' &&
          typeof (c as { id?: unknown }).id === 'string',
      )
      .map((c) => ({ localId: c.localId, id: c.id }));
  }
  return [];
}
