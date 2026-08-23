import { HttpStatus, Injectable } from '@nestjs/common';
import { SealedSubtype } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { usdToMxnCents } from '../../common/money';
import { PriceInfo } from '../pricing/pricing.service';
import { FxService } from '../pricing/fx.service';
import { TcgcsvSealedBulkProvider } from '../pricing/providers/tcgcsv-sealed.provider';
import { SetRefDTO } from './master-set.service';
// v1.39 (M-39, P-38): la heurística de subtipo pasa a la fuente canónica (incl. `upc`/`collection`).
// Se re-exporta aquí para no romper a los consumidores/tests del alias DEPRECADO.
import { inferSealedSubtype as inferSealedSubtypeCanonical } from './sealed-subtype';

/**
 * Un producto SELLADO del catálogo TCGCSV de un set (ETB / booster box / bundle / tin / blíster),
 * NO un single. API_CONTRACT §DTOs (SealedCatalogProductDTO, v1.36-sealed-alta).
 * `tcgplayerProductId` = clave de emparejamiento TCGplayer (== la que el alta reenvía al batch).
 * `sealedSubtype` = INFERIDO por heurística de nombre (null si no se pudo inferir → el operador lo
 * elige en el alta). `imageUrl` = imagen del producto DESDE LA API; null si no trae imagen.
 * `marketRef` = valor de mercado INFORMATIVO (USD→MXN con FX+colchón); MONEY-SAFE: sin precio en la
 * fuente ⇒ `null` (pendiente / «—»), NUNCA 0.
 */
export interface SealedCatalogProductDTO {
  tcgplayerProductId: number;
  name: string;
  cleanName?: string;
  sealedSubtype: SealedSubtype | null;
  imageUrl: string | null;
  marketRef: PriceInfo | null;
}

/** Respuesta de GET /admin/inventory/sealed-catalog (API_CONTRACT §DTOs — SealedCatalogResponse). */
export interface SealedCatalogResponse {
  set: SetRefDTO;
  tcgcsvGroupId: number | null;
  groupResolved: boolean;
  anchorCardId: string;
  data: SealedCatalogProductDTO[];
}

/** Proyección mínima de CardSet para el SetRefDTO del contrato. */
function toSetRef(s: {
  id: string;
  name: string;
  series: string | null;
  releaseDate: string | null;
}): SetRefDTO {
  return {
    id: s.id,
    name: s.name,
    series: s.series ?? undefined,
    releaseDate: s.releaseDate ?? undefined,
  };
}

/**
 * Heurística de nombre → `SealedSubtype`. DEPRECADO: delega en la fuente canónica (§4.34c, incl.
 * `upc`/`collection` con el orden normativo). Se re-exporta para no romper importadores/tests previos.
 */
export function inferSealedSubtype(name: string): SealedSubtype | null {
  return inferSealedSubtypeCanonical(name);
}

/**
 * SealedCatalogAdminService — v1.36-sealed-alta (M-37, P-35 · ARCHITECTURE §4.32 · API_CONTRACT §M1).
 * Sirve `GET /admin/inventory/sealed-catalog?setId=` (`vault_operator+`): lista los PRODUCTOS SELLADOS
 * de un set desde TCGCSV (NO singles) para el ALTA DEDICADA de la pestaña «Sellado».
 *
 * REUSA (sin duplicar) el `TcgcsvSealedBulkProvider` de M2 (proxy read-only server-side; host fijo
 * anti-SSRF + categoría Pokémon=3 en el provider base) que ya sirve el explorador de curación. El
 * navegador NUNCA habla con tcgcsv.com. Diferencia de autorización: aquel explorador es `super_admin`
 * (curación M2); ESTE es `vault_operator+` (alta M1) — se acepta porque el listado es solo lectura de
 * catálogo (no mueve dinero), §4.32c.
 *
 * Money-safe: `marketRef` es INFORMATIVO (sugerencia junto al alta), leído del precio TCGCSV del grupo
 * y convertido USD→MXN con FX+colchón; sin precio en la fuente ⇒ `null` (pendiente/«—»), NUNCA 0. NO
 * fija venta ni costo (eso se deriva al alta/publish, server-side). Sin N+1: UNA llamada de productos +
 * UNA de precios por grupo, join en memoria.
 */
@Injectable()
export class SealedCatalogAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: TcgcsvSealedBulkProvider,
    private readonly fx: FxService,
  ) {}

  /**
   * @param setId  id LOCAL del CardSet (requerido; inexistente → 404 NOT_FOUND).
   * @param groupId override manual del grupo TCGCSV (ya validado entero positivo por el controller).
   * @param q      filtro por nombre (opcional).
   */
  async sealedCatalog(params: {
    setId: string;
    groupId?: number;
    q?: string;
  }): Promise<SealedCatalogResponse> {
    const set = await this.prisma.cardSet.findUnique({ where: { id: params.setId } });
    if (!set) throw BusinessException.notFound('NOT_FOUND', 'CardSet not found');
    const setRef = toSetRef(set);

    // Ancla representativa del set = menor (numberPrefix, numberSort). El sellado se ancla a ella SOLO
    // para satisfacer InventoryItem.cardId (NOT NULL); el display real sale de sealedImageUrl/Name (§4.32b).
    const anchor = await this.prisma.card.findFirst({
      where: { setId: params.setId },
      orderBy: [{ numberPrefix: 'asc' }, { numberSort: 'asc' }],
      select: { id: true },
    });
    const anchorCardId = anchor?.id ?? '';

    // Resolución set → grupo TCGCSV (precedencia §4.32b): override query > CardSet.tcgcsvGroupId >
    // DISTINCT tcgplayerGroupId de hermanos sellados ya mapeados. No resoluble ⇒ groupResolved:false.
    const groupId = await this.resolveGroupId(set, params.setId, params.groupId);
    if (groupId == null) {
      return { set: setRef, tcgcsvGroupId: null, groupResolved: false, anchorCardId, data: [] };
    }

    // Productos del grupo (proxy read-only). `listSealedProducts` LANZA ante fallo remoto → 502.
    let products;
    try {
      products = await this.provider.listSealedProducts(groupId);
    } catch (e) {
      throw new BusinessException(
        ErrorCode.UPSTREAM_ERROR,
        HttpStatus.BAD_GATEWAY,
        `TCGCSV upstream error: ${(e as Error).message}`,
      );
    }

    // Precios del grupo (money-safe: NUNCA lanza; ante fallo devuelve lo acumulado, posiblemente vacío).
    const priceResult = await this.provider.fetchSealedPricesForGroup(groupId);
    const usdCentsByProductId = new Map(
      priceResult.rows.map((r) => [r.tcgplayerProductId, r.marketCents]),
    );
    // FX UNA sola vez por request (§4.32a): USD→MXN con colchón para el `marketRef` informativo.
    const fx = await this.fx.getCurrent();

    const needle = params.q?.trim().toLowerCase();
    const data: SealedCatalogProductDTO[] = products
      .filter(
        (p) =>
          !needle ||
          p.name.toLowerCase().includes(needle) ||
          (p.cleanName ?? '').toLowerCase().includes(needle),
      )
      .map((p) => {
        const usdCents = usdCentsByProductId.get(p.productId);
        // MONEY-SAFE: sin precio en la fuente ⇒ marketRef=null (pendiente/«—»), NUNCA 0.
        const marketRef: PriceInfo | null =
          usdCents != null
            ? { status: 'priced', referenceMxnCents: usdToMxnCents(usdCents, fx.rate, fx.bufferPct) }
            : null;
        return {
          tcgplayerProductId: p.productId,
          name: p.name,
          ...(p.cleanName ? { cleanName: p.cleanName } : {}),
          sealedSubtype: inferSealedSubtype(p.name),
          imageUrl: p.imageUrl ?? null,
          marketRef,
        };
      });

    return { set: setRef, tcgcsvGroupId: groupId, groupResolved: true, anchorCardId, data };
  }

  /**
   * Resuelve el grupo TCGCSV del set (§4.32b): `groupId` explícito (override) > `CardSet.tcgcsvGroupId`
   * (curado) > `DISTINCT tcgplayerGroupId` de los `InventoryItem` sellados YA mapeados del set.
   * Exactamente uno ⇒ se usa; cero o varios (sin `CardSet.tcgcsvGroupId`) ⇒ `null` (no se adivina).
   */
  private async resolveGroupId(
    set: { tcgcsvGroupId: number | null },
    setId: string,
    override?: number,
  ): Promise<number | null> {
    if (override != null) return override;
    if (set.tcgcsvGroupId != null) return set.tcgcsvGroupId;
    const rows = await this.prisma.inventoryItem.findMany({
      where: { productType: 'sealed', tcgplayerGroupId: { not: null }, card: { setId } },
      distinct: ['tcgplayerGroupId'],
      select: { tcgplayerGroupId: true },
    });
    const distinct = [
      ...new Set(rows.map((r) => r.tcgplayerGroupId).filter((g): g is number => g != null)),
    ];
    return distinct.length === 1 ? distinct[0] : null;
  }
}
