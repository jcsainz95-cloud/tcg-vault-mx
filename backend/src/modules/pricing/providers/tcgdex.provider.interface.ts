/**
 * tcgdex.provider.interface.ts — v1.91⟨precios⟩ (M-75, §PRE.A / ARCHITECTURE §4.PRE (e)) — CONTRATO del
 * provider de TCGdex.
 *
 * ✅ IMPLEMENTADO (2026-10-11, egress abierto; forma CONFIRMADA contra `api.tcgdex.net`, fixtures en
 * `test/fixtures/tcgdex/`). El provider real vive en `tcgdex-bulk.provider.ts` (cliente HTTP
 * `tcgdex-http.client.ts` + parser `tcgdex-shape.ts` + mapper `tcgdex-set-mapper.ts`).
 *
 * Esta interfaz es lo que el RESTO del código (árbitro de mediana + candado) espera que el provider
 * ESCRIBA. El árbitro se probó con FIXTURES con esta forma (ver `common/robust-market.spec.ts` y
 * `tcgdex-bulk.provider.spec.ts`).
 *
 * Lo que el provider debe garantizar al escribir filas `PriceReference`:
 *  - `source` ∈ {`tcgdex`, `cardmarket`} — las dos ÚNICAS fuentes nuevas que votan el árbitro.
 *      · `tcgdex`     = sub-feed TCGplayer de TCGdex (USD→MXN Banxico). Familia `tcgplayer` (ECO de
 *                       `tcgcsv_singles`: cuenta como UNA familia, no redundancia — §PRE (e)).
 *      · `cardmarket` = sub-feed Cardmarket de TCGdex (EUR→MXN Banxico). Familia `cardmarket`
 *                       (INDEPENDIENTE — el voto que da consenso al candado).
 *  - `finish` = la variante EXACTA (mapeo por set+número+acabado, NUNCA por nombre — criterio 884).
 *  - `priceMxnCents` = entero FX-HORNEADO (el árbitro solo mira MXN; la conversión EUR/USD→MXN la hace
 *                      el provider con la serie de Banxico, igual que `tcgcsv_singles`).
 *  - `capturedDate` = el día del volcado (la frescura la mide el árbitro contra `priceArbiterFreshnessDays`).
 *  - `refKind = 'market'` (NUNCA `graded_estimate`).
 *
 * El join carta↔TCGdex es por `(CardSet ↔ tcgdexSetId, número, Finish)`. ⛔ NO MEDIDO por backend (sin
 * egress): `tcgdexSetId` de Prismatic Evolutions (≈ `sv08.5`), cobertura por variante, y si
 * `pricing.tcgplayer` de TCGdex es EL MISMO número que `tcgcsv` (correlación — el diseño la neutraliza
 * contando FAMILIAS, no filas). Devops abre `api.tcgdex.net` y confirma la serie EUR/MXN en `fx-refresh`.
 */
import { Finish } from '@prisma/client';

/** Una fila de precio por variante tal como el provider de TCGdex la escribirá en `PriceReference`. */
export interface TcgdexPriceRow {
  /** `tcgdex` (sub-feed TCGplayer, USD) o `cardmarket` (sub-feed Cardmarket, EUR). */
  source: 'tcgdex' | 'cardmarket';
  cardId: string;
  finish: Finish;
  /** Importe en la moneda del sub-feed, CENTAVOS enteros (USD¢ para tcgdex, EUR¢ para cardmarket). */
  marketCents: number;
  /** 'USD' (tcgdex) o 'EUR' (cardmarket). Define cómo hornea FX el escritor (USD recomputa vivo; EUR congela). */
  currency: 'USD' | 'EUR';
  /** Entero MXN FX-horneado (ya convertido por Banxico con la tasa de su moneda). */
  priceMxnCents: number;
  /** 'YYYY-MM-DD' del volcado = el `updated` del sub-feed (tcgplayer ~horario, cardmarket ~diario). */
  capturedDate: string;
  /** El productType es `raw` para singles (el árbitro arbitra mercado raw/sealed). */
  productType: 'raw' | 'sealed';
  gradeKey: string;
  cardProductId?: string | null;
}

/** Lo que el provider necesita del llamador para un set: su id TCGdex, nuestras cartas y las tasas FX. */
export interface TcgdexFetchInput {
  tcgdexSetId: string;
  /** Nuestras cartas del set, por número (el join es por set+número+acabado, criterio 884). */
  cards: { cardId: string; number: string }[];
  /** Tasa USD→MXN con colchón (para el sub-feed tcgplayer). */
  fxUsd: { rate: number; bufferPct: number };
  /** Tasa EUR→MXN con colchón (para el sub-feed cardmarket); `null` ⇒ cardmarket NO vota este barrido. */
  fxEur: { rate: number; bufferPct: number } | null;
}

/**
 * El provider: dado un set (su id TCGdex, nuestras cartas y las tasas FX), trae las cotizaciones por
 * variante de ambos sub-feeds. El llamador (barrido `price-ingest`) persiste cada fila como
 * `PriceReference` (vía `persistArbiterReference`) y deja que `resolveRobustMarket()` arbitre.
 */
export interface TcgdexBulkPriceProvider {
  /** Precios por variante de un set (ambos sub-feeds). `[]` si TCGdex no cubre el set. */
  fetchSetPrices(input: TcgdexFetchInput): Promise<TcgdexPriceRow[]>;
}
