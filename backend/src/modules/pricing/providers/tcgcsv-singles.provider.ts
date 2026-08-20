import { Injectable } from '@nestjs/common';
import { Finish } from '@prisma/client';
import {
  TcgcsvGroupRef,
  TcgcsvSingleProductRef,
  TcgcsvPriceRow,
  deriveStructuralFinishes,
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
 * v1.26 (§4.24a, paso 3) — FUNCIÓN PURA del «AGRUPAR POR CARTA»: une los `subTypeName` de TODAS las
 * filas de precio que pertenecen a la MISMA CARTA, keyeadas por el NÚMERO de carta dentro del set
 * (`extendedData.Number`). ROBUSTA a las dos representaciones de TCGplayer (candado del open-question
 * S-D1): varias filas bajo UN `productId` O `productId`s SEPARADOS por impresión — ambas colapsan al
 * mismo número de carta.
 *
 * Reglas money-safe:
 *  - Estructura = PRESENCIA del `subTypeName`; una fila con `marketPrice: null` SIGUE aportando.
 *  - `subTypeName` desconocido/no mapeable ⇒ OMITIDO (anti-invención, `deriveStructuralFinishes`).
 *  - Una fila cuyo `productId` no corresponde a ningún producto con `Number` (p. ej. sellado) NO
 *    aporta señal (no hay carta a la que atribuirla).
 *
 * @returns `Map<cardNumber, { finishes, productIds }>` con `finishes` en orden canónico
 *   `FINISH_ORDER` y los `productId`s que contribuyeron (ancla/validación del join). Los números con
 *   0 acabados mapeables se OMITEN del mapa (nada que escribir).
 */
export function unionStructuralFinishesByCardNumber(
  products: TcgcsvSingleProductRef[],
  prices: TcgcsvPriceRow[],
): Map<string, { finishes: Finish[]; productIds: number[] }> {
  // productId → número de carta (solo productos que traen `Number`).
  const numberByProduct = new Map<number, string>();
  for (const p of products) {
    if (p.number != null) numberByProduct.set(p.productId, p.number);
  }

  // número de carta → { subTypeNames vistos, productIds contribuyentes }.
  const subtypesByNumber = new Map<string, { subs: string[]; productIds: Set<number> }>();
  for (const row of prices) {
    const number = numberByProduct.get(row.productId);
    if (number == null) continue; // fila sin carta (sellado/otro): no aporta estructura
    let acc = subtypesByNumber.get(number);
    if (!acc) {
      acc = { subs: [], productIds: new Set<number>() };
      subtypesByNumber.set(number, acc);
    }
    if (row.subTypeName != null) acc.subs.push(row.subTypeName);
    acc.productIds.add(row.productId);
  }

  const result = new Map<string, { finishes: Finish[]; productIds: number[] }>();
  for (const [number, acc] of subtypesByNumber) {
    const finishes = deriveStructuralFinishes(acc.subs); // mapea + omite desconocidos + ordena
    if (finishes.length === 0) continue; // todos los subTypeName desconocidos ⇒ nada que escribir
    result.set(number, { finishes, productIds: [...acc.productIds] });
  }
  return result;
}
