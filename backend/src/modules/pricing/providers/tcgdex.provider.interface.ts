/**
 * tcgdex.provider.interface.ts — v1.91⟨precios⟩ (M-75, §PRE.A / ARCHITECTURE §4.PRE (e)) — CONTRATO del
 * provider de TCGdex, DIFERIDO.
 *
 * ⛔ IMPLEMENTACIÓN DIFERIDA (BACKEND_NOTES §91): la FORMA exacta de la API de TCGdex (`holo` vs
 * `holofoil`, dónde vive `marketPrice`, el EUR de Cardmarket) está SIN CONFIRMAR y este contenedor NO
 * alcanza `api.tcgdex.net`. El orquestador está pidiendo al dueño abrir el dominio para medir la forma.
 *
 * Esta interfaz es lo que el RESTO del código (árbitro de mediana + candado) espera que el provider
 * ESCRIBA, para poder construir el árbitro YA y probarlo con FIXTURES (ver `common/robust-market.spec.ts`
 * y `price-review.service.spec.ts`). Cuando el dominio se abra y se confirme la forma, el provider real
 * se construye contra ESTA interfaz sin tocar el árbitro.
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
  /** Entero MXN FX-horneado (ya convertido por Banxico). */
  priceMxnCents: number;
  /** 'YYYY-MM-DD' del volcado. */
  capturedDate: string;
  /** El productType es `raw` para singles (el árbitro arbitra mercado raw/sealed). */
  productType: 'raw' | 'sealed';
  gradeKey: string;
  cardProductId?: string | null;
}

/**
 * El provider (DIFERIDO) implementará esto: dado un set, trae sus cotizaciones por variante de ambos
 * sub-feeds. El llamador (barrido `price-ingest`) persiste cada fila como `PriceReference` y deja que
 * `resolveRobustMarket()` arbitre.
 */
export interface TcgdexBulkPriceProvider {
  /** Precios por variante de un set (ambos sub-feeds). `[]` si TCGdex no cubre el set. */
  fetchSetPrices(tcgdexSetId: string): Promise<TcgdexPriceRow[]>;
}
