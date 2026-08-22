import { Injectable } from '@nestjs/common';
import { CardProductKind, Finish } from '@prisma/client';
import {
  TcgcsvGroupRef,
  TcgcsvSingleProductRef,
  TcgcsvPriceRow,
  deriveStructuralFinishes,
  tcgcsvSubTypeToFinish,
} from '../pricing.types';
import { TcgcsvHttpClient } from './tcgcsv-http.client';

interface TcgcsvRawGroup {
  groupId?: number;
  name?: string;
  abbreviation?: string | null;
  publishedOn?: string | null;
}

interface TcgcsvRawProduct {
  productId?: number;
  name?: string;
  extendedData?: { name?: string; displayName?: string; value?: unknown }[] | null;
}

interface TcgcsvRawPrice {
  productId?: number;
  subTypeName?: string | null;
  marketPrice?: number | null;
}

/**
 * TcgcsvCatalogClient (v1.26, ARCHITECTURE §4.24a) — cliente TCGCSV para la fuente ESTRUCTURAL
 * autoritativa de las SINGLES (`subTypeName` por carta), HERMANO de `TcgcsvSealedBulkProvider`.
 * HEREDA de `TcgcsvHttpClient` la seguridad anti-SSRF (host fijo `https://tcgcsv.com/tcgplayer`,
 * categoría Pokémon=3 constante, `assertValidGroupId`, `redirect:'error'`, timeout) SIN duplicarla.
 *
 * Money-safe / doctrina §4.24a:
 *  - La ESTRUCTURA es la PRESENCIA del `subTypeName`, NO su `marketPrice` (que puede ser `null`).
 *  - `subTypeName` desconocido/no mapeable ⇒ se OMITE (nunca se atribuye a `normal`; anti-invención).
 *  - Los tres métodos LANZAN ante fallo remoto/parse; el RESOLVER (que los orquesta) captura y deja
 *    la estructura previa intacta (una carta no resuelta conserva su valor; falta-una-casilla nunca
 *    sobra-una-falsa). El egress a tcgcsv.com está BLOQUEADO en dev/CI: se testea contra fixtures.
 */
@Injectable()
export class TcgcsvCatalogClient extends TcgcsvHttpClient {
  /** Grupos de la categoría Pokémon (para resolver el groupId por nombre; S-D3). Lanza ante fallo. */
  async listGroups(): Promise<TcgcsvGroupRef[]> {
    const body = await this.getJson<TcgcsvRawGroup>(`/${this.pokemonCategoryId}/groups`);
    const groups: TcgcsvGroupRef[] = [];
    for (const g of body.results ?? []) {
      if (typeof g?.groupId !== 'number' || !Number.isInteger(g.groupId) || !g?.name) continue;
      groups.push({
        groupId: g.groupId,
        name: g.name,
        ...(g.abbreviation ? { abbreviation: g.abbreviation } : {}),
        ...(g.publishedOn ? { publishedOn: g.publishedOn } : {}),
      });
    }
    return groups;
  }

  /**
   * Productos del grupo con su `extendedData.Number` (== número de carta dentro del set). Devuelve
   * TODOS los productos con `productId` válido; `number = null` cuando el producto no trae `Number`
   * (sellado/otros) — el resolver los ignora al unir por número. Lanza ante fallo remoto.
   */
  async getProducts(groupId: number): Promise<TcgcsvSingleProductRef[]> {
    this.assertValidGroupId(groupId);
    const body = await this.getJson<TcgcsvRawProduct>(
      `/${this.pokemonCategoryId}/${groupId}/products`,
    );
    const out: TcgcsvSingleProductRef[] = [];
    for (const p of body.results ?? []) {
      if (typeof p?.productId !== 'number' || !Number.isInteger(p.productId) || !p?.name) continue;
      out.push({ productId: p.productId, name: p.name, number: extractNumber(p.extendedData) });
    }
    return out;
  }

  /**
   * Filas de precio del grupo, reducidas a `{ productId, subTypeName, marketPrice }` — lo único que
   * el resolver necesita. Una fila con `marketPrice: null` SE CONSERVA (estructura ≠ precio). Lanza
   * ante fallo remoto.
   */
  async getPrices(groupId: number): Promise<TcgcsvPriceRow[]> {
    this.assertValidGroupId(groupId);
    const body = await this.getJson<TcgcsvRawPrice>(
      `/${this.pokemonCategoryId}/${groupId}/prices`,
    );
    const out: TcgcsvPriceRow[] = [];
    for (const r of body.results ?? []) {
      if (typeof r?.productId !== 'number' || !Number.isInteger(r.productId)) continue;
      out.push({
        productId: r.productId,
        subTypeName: r.subTypeName ?? null,
        marketPrice: typeof r.marketPrice === 'number' ? r.marketPrice : null,
      });
    }
    return out;
  }
}

/** Lee `extendedData` y devuelve el valor de la entrada `Number` como string, o `null`. */
function extractNumber(
  ext: { name?: string; value?: unknown }[] | null | undefined,
): string | null {
  if (!Array.isArray(ext)) return null;
  const entry = ext.find((e) => e?.name === 'Number');
  const value = entry?.value;
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * v1.29 (§4.27d) — Producto TCGplayer DERIVADO de la fuente: agrupado por `productId` EXACTO (NUNCA
 * por número). Es la unidad que persiste `CardProduct` (una fila por productId).
 */
export interface DerivedCardProduct {
  productId: number;
  name: string;
  /** `extendedData.Number` del producto (para enrutar a la carta local; NO funde acabados). */
  number: string | null;
  kind: CardProductKind;
  /** Acabados de ESTE producto (mapeados de SUS subTypeName; desconocidos OMITIDOS). */
  finishes: Finish[];
  /** Precio por variante: `marketPrice` de ESTE producto por su `subTypeName→Finish`. */
  pricesByFinish: { finish: Finish; marketPrice: number | null }[];
}

/**
 * v1.29 (§4.27d) — clasifica el `kind` del producto por su NOMBRE (heurística de STRING, no de
 * rareza), testeable con fixtures:
 *  - contiene «Deck Exclusive(s)» ⇒ `deck_exclusive` (VENDIBLE/COTIZABLE aparte, precio propio);
 *  - contiene «Promo»/«Staff»/«League»/«Prerelease»/«Jumbo» ⇒ `promo`;
 *  - nombre vacío/degenerado ⇒ `other` (fail-safe conservador: se compone como set_base en el binder);
 *  - en cualquier otro caso ⇒ `set_base` (el caso común de un single de set; §4.27d).
 */
export function classifyCardProductKind(name: string | null | undefined): CardProductKind {
  const s = (name ?? '').toLowerCase();
  if (s.trim() === '') return 'other';
  if (s.includes('deck exclusive')) return 'deck_exclusive';
  if (/\b(promo|staff|league|prerelease|pre-release|jumbo)\b/.test(s)) return 'promo';
  return 'set_base';
}

/**
 * v1.29 (§4.27d, paso 1) — FUNCIÓN PURA que REEMPLAZA a `unionStructuralFinishesByCardNumber` (el bug
 * de tres rondas): agrupa POR `productId` (jamás por número), así el fantasma es IMPOSIBLE por
 * construcción — nunca se cruza un `subTypeName` entre `productId`s distintos.
 *
 * Para cada `productId` produce `{ productId, name, number, kind, finishes, pricesByFinish }` donde
 * `finishes = deriveStructuralFinishes(subTypeNames de ESE producto)` y `pricesByFinish` lleva el
 * `marketPrice` de ESE producto por su acabado. Money-safe:
 *  - Estructura = PRESENCIA del `subTypeName`; una fila con `marketPrice: null` SIGUE declarando el
 *    acabado (estructura ≠ precio) pero NO produce fila de precio (§4.27e).
 *  - `subTypeName` desconocido ⇒ OMITIDO (anti-invención); un producto con 0 acabados mapeables se
 *    OMITE del resultado (nada que colgar).
 */
export function deriveCardProductsFromTcgcsv(
  products: TcgcsvSingleProductRef[],
  prices: TcgcsvPriceRow[],
): DerivedCardProduct[] {
  // productId → filas de precio de ESE producto (subTypeName + marketPrice).
  const pricesByProduct = new Map<number, TcgcsvPriceRow[]>();
  for (const row of prices) {
    const list = pricesByProduct.get(row.productId);
    if (list) list.push(row);
    else pricesByProduct.set(row.productId, [row]);
  }

  const out: DerivedCardProduct[] = [];
  for (const p of products) {
    const priceRows = pricesByProduct.get(p.productId) ?? [];
    // Acabados de ESTE producto (nunca de otro productId): estructura = presencia del subTypeName.
    const subs = priceRows.map((r) => r.subTypeName);
    const finishes = deriveStructuralFinishes(subs);
    if (finishes.length === 0) continue; // ningún subTypeName mapeable ⇒ nada que colgar (money-safe)
    // Precio por variante: marketPrice de ESTE producto por su subTypeName→Finish.
    const pricesByFinish: { finish: Finish; marketPrice: number | null }[] = [];
    const seen = new Set<Finish>();
    for (const r of priceRows) {
      const finish = tcgcsvSubTypeToFinish(r.subTypeName);
      if (finish == null || seen.has(finish)) continue;
      seen.add(finish);
      pricesByFinish.push({ finish, marketPrice: r.marketPrice });
    }
    out.push({
      productId: p.productId,
      name: p.name,
      number: p.number,
      kind: classifyCardProductKind(p.name),
      finishes,
      pricesByFinish,
    });
  }
  return out;
}
