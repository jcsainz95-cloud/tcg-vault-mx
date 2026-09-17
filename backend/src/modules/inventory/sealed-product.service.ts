import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, Role, SealedGroupKind, SealedProduct, SealedSubtype } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { usdToMxnCents } from '../../common/money';
import { PriceInfo, PricingService } from '../pricing/pricing.service';
import { FxService } from '../pricing/fx.service';
import { TcgcsvSealedBulkProvider } from '../pricing/providers/tcgcsv-sealed.provider';
import { TcgcsvGroupRef, sealedMarketGradeKey } from '../pricing/pricing.types';
import { normalizeSetName, setNameCandidates } from '../pricing/ppt-set-mapper.service';
import { matchTcgcsvGroupByName } from '../pricing/providers/tcgcsv-group-match';
import { releaseYear } from '../pricing/ppt-sync-scope';
import { SetRefDTO } from './master-set.service';
import { inferSealedSubtype, SEALED_SUBTYPE_META, SEALED_SORT_ORDER_FALLBACK } from './sealed-subtype';

/**
 * v1.41 (IMP-1) — valores del dial `sealedPriceSource` (§M10). NO es enum de BD; `off` = fail-closed.
 * Espeja el contrato `SealedPriceSource = tcgcsv | off`.
 */
export type SealedPriceSource = 'tcgcsv' | 'off';

/**
 * SealedProductDTO (API_CONTRACT §DTOs, v1.39) — presentación sellada REAL con IDENTIDAD PROPIA.
 * v1.41 (IMP-1) — DOS valores de mercado, NO intercambiables (money-safe):
 *   - `marketRef` = referencia INFORMATIVA (live TCGCSV → caché → null; MONEY-SAFE: sin precio ⇒ null,
 *     NUNCA 0). NO gateada por el dial `sealedPriceSource`; solo sugerencia/decoración, NO decide UI.
 *   - `effectiveMarketCents` = mercado AUTORITATIVO YA gateado por `sealedPriceSource` (resolver H-1
 *     §4.23, la MISMA función que decide PRICE_PENDING en el alta): `null` ⟺ el backend valuaría esta
 *     línea en PRICE_PENDING (dial `off`, sin mapeo o sin precio en la fuente gateada) ⟺ el alta ACEPTA
 *     `manualMarketMxnCents`; `!= null` ⟺ el alta RECHAZA el override (422 MANUAL_MARKET_NOT_ALLOWED).
 *     El front keyea la visibilidad del campo manual en ESTE campo, jamás en `marketRef`. Sin precio ⇒
 *     null (pendiente), NUNCA 0.
 */
export interface SealedProductDTO {
  id: string;
  setId: string;
  tcgplayerProductId: number;
  tcgplayerGroupId: number;
  name: string;
  cleanName?: string;
  subtype: SealedSubtype;
  subtypeInferred: boolean;
  isPrincipal: boolean;
  origin: SealedGroupKind;
  imageUrl: string | null;
  marketRef: PriceInfo | null;
  // v1.41 (IMP-1): AUTORITATIVO, gateado por sealedPriceSource (resolver H-1 §4.23). MXN centavos.
  effectiveMarketCents: number | null;
}

export interface SealedSetGroupDTO {
  id: string;
  setId: string;
  tcgplayerGroupId: number;
  kind: SealedGroupKind;
  label?: string;
}

/**
 * M11 (§10) — estado de precio/mapeo del sellado POR SET, desde estado PERSISTIDO (sin TCGCSV, O-17).
 * CLASE L (contrato §Enums, sin columna en BD): la unión ES la regla, se DERIVA de este literal (fuente
 * única) — el filtro `?state=` valida contra `SEALED_PRICE_STATE_VALUES`, no contra dos literales a mano.
 *   - `priced`          = ≥1 producto con `effectiveMarketCents` gateado != null (el gate H-1, no un cálculo nuevo).
 *   - `mapped_unpriced` = mapeado (grupo resuelto) pero sin precio gateado (dial off, o la fuente no trajo precio).
 *   - `unmapped`        = sin grupo TCGCSV resuelto (el matcher no cuadró / se desenlazó): §11 lo cura a mano.
 */
export const SEALED_PRICE_STATE_VALUES = ['priced', 'mapped_unpriced', 'unmapped'] as const;
export type SealedPriceState = (typeof SEALED_PRICE_STATE_VALUES)[number];

/**
 * M11 (§10) — POR QUÉ un set NO trae precio, para el humano (sin abrir logs). CLASE L (fuente única).
 *   - `no_group`         = estado `unmapped`: no hay `set_main`/grupo resuelto.
 *   - `dial_off`         = estado `mapped_unpriced` con `sealed_price_source=off` (fail-closed, I-2).
 *   - `no_source_price`  = estado `mapped_unpriced` con el dial ON pero sin `PriceReference` gateada (falta ingesta/mapeo).
 */
export const SEALED_PRICE_STATUS_REASON_VALUES = ['no_group', 'dial_off', 'no_source_price'] as const;
export type SealedPriceStatusReason = (typeof SEALED_PRICE_STATUS_REASON_VALUES)[number];

/**
 * M11 (§10) — una fila del estado de precio/mapeo del sellado por set (read-only, sin red externa).
 * Reusa `SetRefDTO`. Los conteos son de ESTADO (no de dinero): no se muestra ningún precio derivado aquí.
 */
export interface SealedPriceStatusRowDTO {
  set: SetRefDTO;
  /** `CardSet.tcgcsvGroupId` (espejo denormalizado del `set_main`); `null` ⇒ SIN emparejar. */
  setMainGroupId: number | null;
  /** `SealedSetGroup.tcgplayerGroupId` enlazados al set (set_main + promo_collection). */
  linkedGroupIds: number[];
  /** `SealedProduct` active del set. */
  productCount: number;
  /** Desglose de los tres estados a nivel de PRODUCTO sellado del set. */
  priced: number;
  mappedUnpriced: number;
  unmapped: number;
  /** ROLLUP del set (el PEOR estado no-vacío): `unmapped` > `mapped_unpriced` > `priced`. */
  state: SealedPriceState;
  /** Presente cuando `state != 'priced'` (por qué no trae precio). */
  reason?: SealedPriceStatusReason;
}

export interface SealedPriceStatusResponse {
  /** El dial (§M10): con `off`, todo lo mapeado es `mapped_unpriced` por el gate (para el copy del front). */
  sealedPriceSource: SealedPriceSource;
  data: SealedPriceStatusRowDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface SealedProductListResponse {
  set: SetRefDTO;
  needsSync: boolean;
  groups: SealedSetGroupDTO[];
  // v1.41 (IMP-1): estado del dial (§M10) que gatea `effectiveMarketCents`; una vez por respuesta
  // (para el copy del front: `off` ⇒ «la fuente de precio de sellado está apagada; captura el valor»).
  sealedPriceSource: SealedPriceSource;
  data: SealedProductDTO[];
}

export interface TcgcsvGroupCandidateDTO {
  tcgplayerGroupId: number;
  name: string;
  publishedOn?: string;
  alreadyLinked: boolean;
  matchScore: number;
}

export interface SealedSyncCandidatesResponse {
  set: SetRefDTO;
  candidates: TcgcsvGroupCandidateDTO[];
}

export interface SealedSyncResultDTO {
  setsSynced: number;
  groupsPopulated: number;
  productsUpserted: number;
  productsDeactivated: number;
  pricedCount: number;
  pendingPriceCount: number;
}

/** Reporte de reconciliación del backfill M-39 (pasos §4.34e 7-8). NO es un endpoint de contrato. */
export interface SealedBackfillReport {
  productsCreated: number;
  itemsLinked: number;
  /** Sellados SIN MAPEO (tcgplayerProductId null): no se pueden backfillar sin adivinar → quedan null. */
  unmappedItems: { folio: string; cardId: string }[];
}

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

/** sortOrder canónico del subtipo (§4.34c); fallback al final si el subtype no está en el mapa. */
function sortOrderOf(subtype: SealedSubtype): number {
  return SEALED_SUBTYPE_META[subtype]?.sortOrder ?? SEALED_SORT_ORDER_FALLBACK;
}

/**
 * H-P38-4 (TECH_DEBT): ¿el error es una violación de UNIQUE (Prisma P2002)? Bajo concurrencia dos
 * syncs/altas simultáneos pueden perder la carrera del `create` de una fila con constraint unique
 * (`SealedProduct.tcgplayerProductId`, `SealedSetGroup.setId_tcgplayerGroupId`); el perdedor recibe
 * P2002 y converge en vez de romper. Money-safe: solo endurece la escritura, no toca precios.
 */
function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/**
 * SealedProductService — v1.39-sealed-product-module (M-39, P-38 · ARCHITECTURE §4.34 · API_CONTRACT
 * §M1). CURA DE RAÍZ de SB-D5: da al sellado identidad de catálogo propia (`SealedProduct`) por set,
 * poblada por un SYNC desde TCGCSV que también **puebla los groupIds del set** (`CardSet.tcgcsvGroupId`
 * + filas `SealedSetGroup`) por name-match SIN requerir un item previo — rompe el círculo vicioso.
 *
 * REUSA el `TcgcsvSealedBulkProvider` (proxy read-only anti-SSRF; host fijo + categoría Pokémon=3).
 * Money-safe en todo: nunca fabrica precio (marketUsdCents null si TCGCSV no trae), nunca toca
 * inventario ni valuación existente. Sin N+1: una llamada de productos + una de precios por grupo.
 */
@Injectable()
export class SealedProductService {
  private readonly logger = new Logger(SealedProductService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: TcgcsvSealedBulkProvider,
    private readonly fx: FxService,
    // v1.41 (IMP-1): resolver H-1 gateado (getReferencesBatch + gateSealedMarketCents + loadSealedSpreads)
    // — la MISMA función que decide PRICE_PENDING en el alta, para que `effectiveMarketCents` no diverja.
    private readonly pricing: PricingService,
    // SEC-M11-1/-2: bitácora del remap set→grupo, escrita DENTRO de la misma `$transaction` que las
    // escrituras (atomicidad total, precedente `InventoryService.applySealedManualOverride`). `@Optional`
    // para que los tests unitarios que instancian el servicio a mano sin auditoría sigan compilando; en
    // producción `AuditModule` es `@Global`, así que siempre se inyecta.
    @Optional() private readonly audit?: AuditService,
  ) {}

  // ============================ LISTADO (vault_operator+) ============================

  /**
   * `GET /admin/inventory/sealed-products` — lee los `SealedProduct` PERSISTIDOS (active=true) del set,
   * ordenados §4.34c (principales primero), cada uno con `marketRef` money-safe (live TCGCSV → caché
   * `marketUsdCents` → null). `needsSync=true` ⇒ catálogo vacío (el front ofrece «Sincronizar»).
   */
  async listSealedProducts(params: {
    setId: string;
    q?: string;
    origin?: SealedGroupKind;
    principalOnly?: boolean;
  }): Promise<SealedProductListResponse> {
    const set = await this.prisma.cardSet.findUnique({ where: { id: params.setId } });
    if (!set) throw BusinessException.notFound('NOT_FOUND', 'CardSet not found');
    const setRef = toSetRef(set);

    const groupRows = await this.prisma.sealedSetGroup.findMany({
      where: { setId: params.setId },
      orderBy: { tcgplayerGroupId: 'asc' },
    });
    const groups: SealedSetGroupDTO[] = groupRows.map((g) => ({
      id: g.id,
      setId: g.setId,
      tcgplayerGroupId: g.tcgplayerGroupId,
      kind: g.kind,
      ...(g.label ? { label: g.label } : {}),
    }));

    const needle = params.q?.trim().toLowerCase();
    const products = await this.prisma.sealedProduct.findMany({
      where: {
        setId: params.setId,
        active: true,
        ...(params.origin ? { origin: params.origin } : {}),
        ...(params.principalOnly ? { isPrincipal: true } : {}),
        ...(needle
          ? {
              OR: [
                { name: { contains: needle, mode: 'insensitive' } },
                { cleanName: { contains: needle, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
    });

    // needsSync se decide sobre el catálogo COMPLETO del set (sin filtros de q/origin/principalOnly):
    // el front ofrece «Sincronizar» solo si el set no tiene NINGÚN SealedProduct persistido.
    const totalActive =
      needle || params.origin || params.principalOnly
        ? await this.prisma.sealedProduct.count({ where: { setId: params.setId, active: true } })
        : products.length;
    const needsSync = totalActive === 0;

    // marketRef LIVE money-safe: una llamada de precios por grupo DISTINTO presente (dedupe), join en
    // memoria; fallback a marketUsdCents cacheado; null si ninguno. `fetchSealedPricesForGroup` NUNCA
    // lanza (ante fallo remoto devuelve lo acumulado → cae a la caché). FX una sola vez por request.
    const distinctGroupIds = [...new Set(products.map((p) => p.tcgplayerGroupId))];
    const liveUsdByProductId = new Map<number, number>();
    for (const gid of distinctGroupIds) {
      const priceResult = await this.provider.fetchSealedPricesForGroup(gid);
      for (const row of priceResult.rows) liveUsdByProductId.set(row.tcgplayerProductId, row.marketCents);
    }
    const fx = await this.fx.getCurrent();

    // v1.41 (IMP-1): `effectiveMarketCents` AUTORITATIVO — el mercado del sellado YA gateado por el dial
    // `sealedPriceSource`, resuelto con la MISMA cadena H-1 que el alta (resolver ÚNICO, para no divergir):
    //   ref = PriceReference(anchorCardId, 'sealed', 'sealed:tcg:<productId>', 'normal')
    //   effectiveMarketCents = gateSealedMarketCents(ref, sourceOn)  // dial off/seed ⇒ null ⇒ PRICE_PENDING
    // El ancla del set es la MISMA que usa el alta (`resolveAnchorCardId`: menor numberPrefix/numberSort),
    // así que `effectiveMarketCents == null` ⟺ el alta acepta `manualMarketMxnCents`. Sin ancla (set sin
    // cartas) ⇒ sin clave de mercado ⇒ null (money-safe). Un lote de referencias (sin N+1).
    const { sourceOn } = await this.pricing.loadSealedSpreads();
    const sealedPriceSource: SealedPriceSource = sourceOn ? 'tcgcsv' : 'off';
    const anchorCardId = await this.resolveAnchorCardId(params.setId);
    const effectiveByProductId = new Map<number, number | null>();
    if (anchorCardId) {
      const refs = await this.pricing.getReferencesBatch(
        products.map((p) => ({
          cardId: anchorCardId,
          productType: 'sealed' as const,
          gradeKey: sealedMarketGradeKey(p.tcgplayerProductId),
          finish: 'normal' as const,
        })),
      );
      for (const p of products) {
        const ref = refs.get(`${anchorCardId}|sealed|${sealedMarketGradeKey(p.tcgplayerProductId)}|normal`);
        effectiveByProductId.set(p.tcgplayerProductId, this.pricing.gateSealedMarketCents(ref, sourceOn));
      }
    }

    const data: SealedProductDTO[] = products
      .map((p) => this.toProductDTO(p, liveUsdByProductId, fx, effectiveByProductId))
      .sort(
        (a, b) =>
          Number(b.isPrincipal) - Number(a.isPrincipal) ||
          sortOrderOf(a.subtype) - sortOrderOf(b.subtype) ||
          a.name.localeCompare(b.name),
      );

    return { set: setRef, needsSync, groups, sealedPriceSource, data };
  }

  /**
   * v1.41 (IMP-1) — ancla representativa del set (menor `numberPrefix`/`numberSort`), la MISMA que usa el
   * alta (`InventoryService.resolveAnchorCardId`) para llavear la referencia de mercado del sellado. `null`
   * si el set no tiene cartas (⇒ sin clave de mercado ⇒ `effectiveMarketCents` null, money-safe).
   */
  private async resolveAnchorCardId(setId: string): Promise<string | null> {
    const anchor = await this.prisma.card.findFirst({
      where: { setId },
      orderBy: [{ numberPrefix: 'asc' }, { numberSort: 'asc' }],
      select: { id: true },
    });
    return anchor?.id ?? null;
  }

  private toProductDTO(
    p: SealedProduct,
    liveUsdByProductId: Map<number, number>,
    fx: { rate: number; bufferPct: number },
    effectiveByProductId: Map<number, number | null>,
  ): SealedProductDTO {
    const usdCents = liveUsdByProductId.get(p.tcgplayerProductId) ?? p.marketUsdCents ?? null;
    // MONEY-SAFE: sin precio en NINGUNA capa ⇒ marketRef null (pendiente/«—»), JAMÁS 0.
    const marketRef: PriceInfo | null =
      usdCents != null
        ? { status: 'priced', referenceMxnCents: usdToMxnCents(usdCents, fx.rate, fx.bufferPct) }
        : null;
    return {
      id: p.id,
      setId: p.setId,
      tcgplayerProductId: p.tcgplayerProductId,
      tcgplayerGroupId: p.tcgplayerGroupId,
      name: p.name,
      ...(p.cleanName ? { cleanName: p.cleanName } : {}),
      subtype: p.subtype,
      subtypeInferred: p.subtypeInferred,
      isPrincipal: p.isPrincipal,
      origin: p.origin,
      imageUrl: p.imageUrl ?? null,
      marketRef,
      // v1.41 (IMP-1): mercado gateado por el dial (null cuando el backend valuaría PRICE_PENDING).
      effectiveMarketCents: effectiveByProductId.get(p.tcgplayerProductId) ?? null,
    };
  }

  // ============================ SYNC (super_admin) ============================

  /**
   * `POST /admin/inventory/sealed-products/sync` — descarga las presentaciones selladas del set (o de
   * todos) desde TCGCSV y las persiste como `SealedProduct`, POBLANDO de paso `CardSet.tcgcsvGroupId`
   * + `SealedSetGroup` (rompe el círculo vicioso). Money-safe: nunca fabrica precio, nunca toca
   * inventario. Descarta singles (incl. el single promo de un grupo `promo_collection`).
   */
  async sync(req: { setId?: string; groupIds?: number[]; all?: boolean }): Promise<SealedSyncResultDTO> {
    if (!req.all && (!req.setId || req.setId.trim() === '')) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'one of setId or all:true is required');
    }
    if (req.all && req.setId) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'setId and all:true are mutually exclusive');
    }

    const sets = req.all
      ? await this.prisma.cardSet.findMany()
      : await (async () => {
          const s = await this.prisma.cardSet.findUnique({ where: { id: req.setId! } });
          if (!s) throw BusinessException.notFound('NOT_FOUND', 'CardSet not found');
          return [s];
        })();

    const result: SealedSyncResultDTO = {
      setsSynced: 0,
      groupsPopulated: 0,
      productsUpserted: 0,
      productsDeactivated: 0,
      pricedCount: 0,
      pendingPriceCount: 0,
    };

    // `listGroups` se pide UNA vez (name-match del set_main faltante). Puede LANZAR → 502.
    let allGroups: TcgcsvGroupRef[] | null = null;
    const ensureGroups = async (): Promise<TcgcsvGroupRef[]> => {
      if (allGroups == null) allGroups = await this.listGroupsOr502();
      return allGroups;
    };

    for (const set of sets) {
      const r = await this.syncSet(set, req.groupIds ?? [], ensureGroups);
      result.setsSynced += 1;
      result.groupsPopulated += r.groupsPopulated;
      result.productsUpserted += r.productsUpserted;
      result.productsDeactivated += r.productsDeactivated;
      result.pricedCount += r.pricedCount;
      result.pendingPriceCount += r.pendingPriceCount;
    }
    this.logger.log(
      `sealed-products/sync: ${result.setsSynced} sets, ${result.groupsPopulated} groupIds nuevos, ` +
        `${result.productsUpserted} productos upsert (${result.pricedCount} con precio, ` +
        `${result.pendingPriceCount} sin precio), ${result.productsDeactivated} desactivados.`,
    );
    return result;
  }

  private async syncSet(
    set: { id: string; name: string; releaseDate: string | null; tcgcsvGroupId: number | null },
    extraGroupIds: number[],
    ensureGroups: () => Promise<TcgcsvGroupRef[]>,
  ): Promise<Omit<SealedSyncResultDTO, 'setsSynced'>> {
    const out = {
      groupsPopulated: 0,
      productsUpserted: 0,
      productsDeactivated: 0,
      pricedCount: 0,
      pendingPriceCount: 0,
    };

    // Grupos conocidos del set (SealedSetGroup ∪ extraGroupIds ∪ name-match del set_main si falta).
    const known = await this.prisma.sealedSetGroup.findMany({ where: { setId: set.id } });
    const kindByGroup = new Map<number, SealedGroupKind>(
      known.map((g) => [g.tcgplayerGroupId, g.kind]),
    );
    const labelByGroup = new Map<number, string | null>(known.map((g) => [g.tcgplayerGroupId, g.label]));

    let setMainGroupId: number | null =
      known.find((g) => g.kind === 'set_main')?.tcgplayerGroupId ?? set.tcgcsvGroupId ?? null;

    // Los groupIds pasados por el request se enlazan como `promo_collection` (grupos extra).
    for (const gid of extraGroupIds) {
      if (!kindByGroup.has(gid)) kindByGroup.set(gid, 'promo_collection');
    }

    // Hueco 1: sin set_main → name-match contra TCGCSV (rompe el círculo vicioso, sin item previo).
    if (setMainGroupId == null) {
      const groups = await ensureGroups();
      const best = this.bestSetMainMatch(set, groups);
      if (best != null) {
        setMainGroupId = best.groupId;
        kindByGroup.set(best.groupId, 'set_main');
        labelByGroup.set(best.groupId, best.name);
      }
    }
    if (setMainGroupId != null && !kindByGroup.has(setMainGroupId)) {
      kindByGroup.set(setMainGroupId, 'set_main');
    }

    if (kindByGroup.size === 0) {
      this.logger.warn(
        `sealed-products/sync: set ${set.name} (${set.id}) sin grupo resoluble (ni curado ni name-match) ` +
          `→ nada que sincronizar (money-safe: no se adivina).`,
      );
      return out;
    }

    const seenProductIds: number[] = [];
    const syncedGroupIds: number[] = [];
    for (const [groupId, kind] of kindByGroup.entries()) {
      syncedGroupIds.push(groupId);
      // Productos del grupo (descarta singles, incl. single promo). LANZA → 502.
      const products = await this.listSealedProductsOr502(groupId);
      const priceResult = await this.provider.fetchSealedPricesForGroup(groupId);
      const usdByProductId = new Map(priceResult.rows.map((r) => [r.tcgplayerProductId, r.marketCents]));

      for (const p of products) {
        const usdCents = usdByProductId.get(p.productId) ?? null;
        if (usdCents != null) out.pricedCount += 1;
        else out.pendingPriceCount += 1;
        await this.upsertSealedProduct({
          setId: set.id,
          tcgplayerProductId: p.productId,
          tcgplayerGroupId: groupId,
          name: p.name,
          cleanName: p.cleanName ?? null,
          imageUrl: p.imageUrl ?? null,
          origin: kind,
          marketUsdCents: usdCents,
        });
        out.productsUpserted += 1;
        seenProductIds.push(p.productId);
      }

      // Asegura la fila SealedSetGroup (con su kind + label si lo tenemos).
      const created = await this.ensureSetGroup(set.id, groupId, kind, labelByGroup.get(groupId) ?? null);
      if (created) out.groupsPopulated += 1;
    }

    // Puebla CardSet.tcgcsvGroupId (denormalización del set_main) si era null.
    if (set.tcgcsvGroupId == null && setMainGroupId != null) {
      await this.prisma.cardSet.update({
        where: { id: set.id },
        data: { tcgcsvGroupId: setMainGroupId },
      });
    }

    // Soft-delete: productos de los grupos SINCRONIZADOS que ya no aparecen → active=false.
    const deactivated = await this.prisma.sealedProduct.updateMany({
      where: {
        setId: set.id,
        active: true,
        tcgplayerGroupId: { in: syncedGroupIds },
        tcgplayerProductId: { notIn: seenProductIds.length > 0 ? seenProductIds : [-1] },
      },
      data: { active: false },
    });
    out.productsDeactivated += deactivated.count;

    return out;
  }

  /**
   * Upsert idempotente por `tcgplayerProductId`. En UPDATE: refresca name/cleanName/image/marketUsdCents/
   * origin/group; el `subtype` solo si NO fue curado por un humano (`subtypeInferred=true`); `isPrincipal`
   * y `active` se conservan si el registro existe (curables). En CREATE: subtype inferido + isPrincipal
   * default del subtype. Money-safe: marketUsdCents null si TCGCSV no trae (JAMÁS 0).
   */
  private async upsertSealedProduct(input: {
    setId: string;
    tcgplayerProductId: number;
    tcgplayerGroupId: number;
    name: string;
    cleanName: string | null;
    imageUrl: string | null;
    origin: SealedGroupKind;
    marketUsdCents: number | null;
  }): Promise<void> {
    const inferred = inferSealedSubtype(input.name);
    const now = new Date();

    // UPDATE preservando la semántica: NO pisa un subtype curado por humano (subtypeInferred=false); si
    // sigue inferido, lo refresca. Cerrado en un closure para reusarlo en la ruta normal y en la de carrera.
    const applyUpdate = (row: SealedProduct) =>
      this.prisma.sealedProduct.update({
        where: { id: row.id },
        data: {
          setId: input.setId,
          tcgplayerGroupId: input.tcgplayerGroupId,
          name: input.name,
          cleanName: input.cleanName,
          origin: input.origin,
          imageUrl: input.imageUrl,
          ...(row.subtypeInferred && inferred ? { subtype: inferred } : {}),
          marketUsdCents: input.marketUsdCents,
          ...(input.marketUsdCents != null ? { marketUpdatedAt: now } : {}),
          active: true,
        },
      });

    const existing = await this.prisma.sealedProduct.findUnique({
      where: { tcgplayerProductId: input.tcgplayerProductId },
    });
    if (existing) {
      await applyUpdate(existing);
      return;
    }

    // H-P38-4 (TECH_DEBT): el `create` va guardado contra la carrera. Si entre el findUnique de arriba y
    // este create OTRO sync insertó la MISMA `tcgplayerProductId` (unique), Prisma lanza P2002 → en vez de
    // romper, releemos y CONVERGEMOS con el update (respetando el subtype curado). Money-safe: sin precio
    // ⇒ marketUsdCents null, JAMÁS 0.
    const subtype = inferred ?? 'collection'; // sin match → 'collection' (curable; jamás null en BD)
    const meta = SEALED_SUBTYPE_META[subtype];
    try {
      await this.prisma.sealedProduct.create({
        data: {
          setId: input.setId,
          tcgplayerProductId: input.tcgplayerProductId,
          tcgplayerGroupId: input.tcgplayerGroupId,
          name: input.name,
          cleanName: input.cleanName,
          subtype,
          subtypeInferred: true,
          isPrincipal: meta?.isPrincipal ?? false,
          origin: input.origin,
          imageUrl: input.imageUrl,
          marketUsdCents: input.marketUsdCents,
          marketUpdatedAt: input.marketUsdCents != null ? now : null,
          active: true,
        },
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const raced = await this.prisma.sealedProduct.findUnique({
        where: { tcgplayerProductId: input.tcgplayerProductId },
      });
      if (raced) await applyUpdate(raced);
    }
  }

  /** Asegura una fila SealedSetGroup (idempotente por unique). Devuelve true si la CREÓ. */
  private async ensureSetGroup(
    setId: string,
    tcgplayerGroupId: number,
    kind: SealedGroupKind,
    label: string | null,
  ): Promise<boolean> {
    const existing = await this.prisma.sealedSetGroup.findUnique({
      where: { setId_tcgplayerGroupId: { setId, tcgplayerGroupId } },
    });
    if (existing) {
      if (label && existing.label !== label) {
        await this.prisma.sealedSetGroup.update({ where: { id: existing.id }, data: { label } });
      }
      return false;
    }
    // H-P38-4 (TECH_DEBT): `create` guardado contra la carrera. Si otro sync creó el MISMO
    // (setId, tcgplayerGroupId) (unique) entre el findUnique y este create, Prisma lanza P2002 → NO se
    // creó por ESTA llamada (devuelve false, no doble-cuenta `groupsPopulated`) y converge el label.
    try {
      await this.prisma.sealedSetGroup.create({
        data: { setId, tcgplayerGroupId, kind, label },
      });
      return true;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const raced = await this.prisma.sealedSetGroup.findUnique({
        where: { setId_tcgplayerGroupId: { setId, tcgplayerGroupId } },
      });
      if (raced && label && raced.label !== label) {
        await this.prisma.sealedSetGroup.update({ where: { id: raced.id }, data: { label } });
      }
      return false;
    }
  }

  // ============================ CANDIDATES / LINK (super_admin) ============================

  /**
   * `GET /admin/inventory/sealed-products/sync/candidates?setId=` — grupos TCGCSV candidatos por
   * name-match contra el set (bootstrap del set_main + localizar promos/colecciones).
   */
  async syncCandidates(setId: string): Promise<SealedSyncCandidatesResponse> {
    const set = await this.prisma.cardSet.findUnique({ where: { id: setId } });
    if (!set) throw BusinessException.notFound('NOT_FOUND', 'CardSet not found');
    const groups = await this.listGroupsOr502();
    const linked = new Set(
      (await this.prisma.sealedSetGroup.findMany({ where: { setId }, select: { tcgplayerGroupId: true } }))
        .map((g) => g.tcgplayerGroupId),
    );
    const candidates: TcgcsvGroupCandidateDTO[] = groups
      .map((g) => ({
        tcgplayerGroupId: g.groupId,
        name: g.name,
        ...(g.publishedOn ? { publishedOn: g.publishedOn } : {}),
        alreadyLinked: linked.has(g.groupId),
        matchScore: this.matchScore(set, g),
      }))
      .filter((c) => c.matchScore > 0 || c.alreadyLinked)
      .sort((a, b) => b.matchScore - a.matchScore || a.name.localeCompare(b.name));
    return { set: toSetRef(set), candidates };
  }

  /**
   * `POST /admin/inventory/sealed-sets/:setId/groups` — enlaza un grupo TCGCSV EXTRA (promo/colección)
   * al set. Grupo ya enlazado → 409 CONFLICT. Si `kind=set_main` y CardSet.tcgcsvGroupId es null, lo
   * puebla (consistencia denormalizada).
   */
  async linkGroup(
    setId: string,
    body: { tcgplayerGroupId: number; kind: SealedGroupKind },
  ): Promise<SealedSetGroupDTO> {
    const set = await this.prisma.cardSet.findUnique({ where: { id: setId } });
    if (!set) throw BusinessException.notFound('NOT_FOUND', 'CardSet not found');
    const dup = await this.prisma.sealedSetGroup.findUnique({
      where: { setId_tcgplayerGroupId: { setId, tcgplayerGroupId: body.tcgplayerGroupId } },
    });
    if (dup) throw BusinessException.conflict('CONFLICT', 'group already linked to this set');

    // Label best-effort desde TCGCSV (observabilidad/curación); jamás bloquea el enlace.
    let label: string | null = null;
    try {
      const groups = await this.provider.listGroups();
      label = groups.find((g) => g.groupId === body.tcgplayerGroupId)?.name ?? null;
    } catch {
      /* money-safe: el enlace no depende del label */
    }

    // H-P38-4 (TECH_DEBT): el pre-check `dup` cubre el caso normal, pero bajo concurrencia dos linkGroup
    // simultáneos pueden pasarlo ambos y chocar en el `create` (unique setId_tcgplayerGroupId). El
    // perdedor recibe P2002 → se traduce al MISMO 409 CONFLICT (semántica preservada: enlace duplicado).
    let row;
    try {
      row = await this.prisma.sealedSetGroup.create({
        data: { setId, tcgplayerGroupId: body.tcgplayerGroupId, kind: body.kind, label },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw BusinessException.conflict('CONFLICT', 'group already linked to this set');
      }
      throw e;
    }
    if (body.kind === 'set_main' && set.tcgcsvGroupId == null) {
      await this.prisma.cardSet.update({
        where: { id: setId },
        data: { tcgcsvGroupId: body.tcgplayerGroupId },
      });
    }
    return {
      id: row.id,
      setId: row.setId,
      tcgplayerGroupId: row.tcgplayerGroupId,
      kind: row.kind,
      ...(row.label ? { label: row.label } : {}),
    };
  }

  // ============================ M11 §10 — ESTADO DE PRECIO POR SET (vault_operator+, read-only) ===

  /**
   * `GET /admin/inventory/sealed-price-status` (M11 §10) — por SET de sellado, en cuál de TRES estados
   * está su precio: **`priced` / `mapped_unpriced` / `unmapped`** (+ `reason`). Lo que hoy funde
   * `sealed-sets.unmappedCount` («no mapeado» O «mapeado sin precio») aquí queda SEPARADO, para decidir
   * si hace falta corregir el mapeo (§11) o sólo disparar la ingesta (§9).
   *
   * ⛔ **Read-only, sin red externa (O-17):** lee SÓLO estado persistido (`SealedProduct` + `SealedSetGroup`
   * + `CardSet.tcgcsvGroupId`) y clasifica con el **MISMO gate H-1** que el alta (`getReferencesBatch` +
   * `gateSealedMarketCents`) — NO reimplementa el gate (I-2/I-6) y **NUNCA** llama a `fetchSealedPricesForGroup`/
   * `listGroups` (a diferencia de `listSealedProducts`/`syncCandidates`), por lo que no toca `tcgcsv.com`.
   * Money-safe: clasifica, no fija precio; los conteos son de ESTADO, no de dinero.
   *
   * Incluye sets del CATÁLOGO sin inventario (que `sealed-sets` omite): universo = sets con ≥1
   * `SealedProduct` active ∪ ≥1 `SealedSetGroup` ∪ `CardSet.tcgcsvGroupId != null`.
   */
  async sealedPriceStatus(params: {
    q?: string;
    state?: SealedPriceState;
    page: number;
    pageSize: number;
  }): Promise<SealedPriceStatusResponse> {
    const { sourceOn } = await this.pricing.loadSealedSpreads();
    const sealedPriceSource: SealedPriceSource = sourceOn ? 'tcgcsv' : 'off';

    // Estado persistido en tres lecturas (sin red): productos active, grupos enlazados, y los sets con
    // set_main denormalizado. El universo de sets es la unión — así un set del catálogo sin inventario
    // (que `sealed-sets` no ve) también aparece para poder mapearse.
    const [products, groupRows, mainSets] = await Promise.all([
      this.prisma.sealedProduct.findMany({
        where: { active: true },
        select: { setId: true, tcgplayerProductId: true, tcgplayerGroupId: true },
      }),
      this.prisma.sealedSetGroup.findMany({
        select: { setId: true, tcgplayerGroupId: true, kind: true },
      }),
      this.prisma.cardSet.findMany({
        where: { tcgcsvGroupId: { not: null } },
        select: { id: true },
      }),
    ]);

    const setIdUniverse = new Set<string>([
      ...products.map((p) => p.setId),
      ...groupRows.map((g) => g.setId),
      ...mainSets.map((s) => s.id),
    ]);
    if (setIdUniverse.size === 0) {
      return { sealedPriceSource, data: [], page: params.page, pageSize: params.pageSize, total: 0 };
    }

    const needle = params.q?.trim().toLowerCase();
    const sets = await this.prisma.cardSet.findMany({
      where: {
        id: { in: [...setIdUniverse] },
        ...(needle ? { name: { contains: needle, mode: 'insensitive' } } : {}),
      },
    });

    // Índices por set (join en memoria, sin N+1 de datos).
    const productsBySet = new Map<string, { tcgplayerProductId: number; tcgplayerGroupId: number }[]>();
    for (const p of products) {
      const arr = productsBySet.get(p.setId) ?? [];
      arr.push({ tcgplayerProductId: p.tcgplayerProductId, tcgplayerGroupId: p.tcgplayerGroupId });
      productsBySet.set(p.setId, arr);
    }
    const groupsBySet = new Map<string, { tcgplayerGroupId: number; kind: SealedGroupKind }[]>();
    for (const g of groupRows) {
      const arr = groupsBySet.get(g.setId) ?? [];
      arr.push({ tcgplayerGroupId: g.tcgplayerGroupId, kind: g.kind });
      groupsBySet.set(g.setId, arr);
    }

    const rows: SealedPriceStatusRowDTO[] = [];
    for (const set of sets) {
      const setProducts = productsBySet.get(set.id) ?? [];
      const setGroups = groupsBySet.get(set.id) ?? [];
      const linkedGroupIds = [...new Set(setGroups.map((g) => g.tcgplayerGroupId))].sort((a, b) => a - b);
      const setMainGroupId =
        set.tcgcsvGroupId ?? setGroups.find((g) => g.kind === 'set_main')?.tcgplayerGroupId ?? null;
      const linkedSet = new Set<number>(linkedGroupIds);
      if (setMainGroupId != null) linkedSet.add(setMainGroupId);

      // Referencias gateadas de los productos del set — la MISMA cadena H-1 que `listSealedProducts`
      // (ancla del set + getReferencesBatch + gateSealedMarketCents). Sin ancla ⇒ sin clave ⇒ null.
      const anchorCardId = await this.resolveAnchorCardId(set.id);
      const effectiveByProductId = new Map<number, number | null>();
      if (anchorCardId && setProducts.length > 0) {
        const refs = await this.pricing.getReferencesBatch(
          setProducts.map((p) => ({
            cardId: anchorCardId,
            productType: 'sealed' as const,
            gradeKey: sealedMarketGradeKey(p.tcgplayerProductId),
            finish: 'normal' as const,
          })),
        );
        for (const p of setProducts) {
          const ref = refs.get(`${anchorCardId}|sealed|${sealedMarketGradeKey(p.tcgplayerProductId)}|normal`);
          effectiveByProductId.set(p.tcgplayerProductId, this.pricing.gateSealedMarketCents(ref, sourceOn));
        }
      }

      let priced = 0;
      let mappedUnpriced = 0;
      let unmapped = 0;
      for (const p of setProducts) {
        // «Mapeado» = su grupo está resuelto/enlazado en el set. Un producto huérfano (su grupo se
        // desenlazó, o el set perdió su set_main) cuenta como SIN emparejar (honesto, §11).
        const isMapped = linkedSet.has(p.tcgplayerGroupId);
        if (!isMapped) {
          unmapped += 1;
          continue;
        }
        if ((effectiveByProductId.get(p.tcgplayerProductId) ?? null) != null) priced += 1;
        else mappedUnpriced += 1;
      }

      // ROLLUP: el PEOR estado no-vacío. Set sin productos: `unmapped` si no hay grupo resuelto (honesto
      // «SIN emparejar»), si no `mapped_unpriced` (tiene grupo pero aún nada preciado).
      let state: SealedPriceState;
      if (unmapped > 0) state = 'unmapped';
      else if (mappedUnpriced > 0) state = 'mapped_unpriced';
      else if (priced > 0) state = 'priced';
      else state = setMainGroupId == null && linkedGroupIds.length === 0 ? 'unmapped' : 'mapped_unpriced';

      const reason: SealedPriceStatusReason | undefined =
        state === 'unmapped'
          ? 'no_group'
          : state === 'mapped_unpriced'
            ? sourceOn
              ? 'no_source_price'
              : 'dial_off'
            : undefined;

      rows.push({
        set: toSetRef(set),
        setMainGroupId,
        linkedGroupIds,
        productCount: setProducts.length,
        priced,
        mappedUnpriced,
        unmapped,
        state,
        ...(reason ? { reason } : {}),
      });
    }

    // Filtro por estado (derivado del enum; §0-Q) y orden por lanzamiento desc (convención de pestaña).
    const filtered = params.state ? rows.filter((r) => r.state === params.state) : rows;
    filtered.sort((a, b) => (b.set.releaseDate ?? '').localeCompare(a.set.releaseDate ?? ''));
    const total = filtered.length;
    const data = filtered.slice((params.page - 1) * params.pageSize, params.page * params.pageSize);
    return { sealedPriceSource, data, page: params.page, pageSize: params.pageSize, total };
  }

  // ============================ M11 §11 — CORRECCIÓN DEL MAPEO set→grupo (super_admin, AUDITADO) ===

  /**
   * `PUT /admin/inventory/sealed-sets/:setId/set-main-group` (M11 §11.1) — fija/**REEMPLAZA** el grupo
   * `set_main` del set **aunque ya exista** (a diferencia de `linkGroup`, que sólo escribe
   * `CardSet.tcgcsvGroupId` si es null, `:642`). Es el escape de P-46 cuando el matcher automático
   * escribió un grupo equivocado. Money-safe (I-2): fija de qué grupo saldrá el precio; **no** fabrica
   * precio (lo trae el job §9, gateado). El `set_main` anterior se DEGRADA a `promo_collection` (DO-5:
   * conserva el enlace por si tenía productos válidos; el super-admin lo borra aparte con el DELETE).
   *
   * Devuelve el `SealedSetGroupDTO` del `set_main` resultante y el `before/after` (para el eco del
   * controller). La bitácora `inventory.sealed_set_main_group_set` la escribe ESTE método DENTRO de la
   * `$transaction` cuando el controller pasa `actor` (SEC-M11-2, I-4).
   *
   * ### SEC-M11-1/-2 — atomicidad del remap
   * El remap toca **tres** filas (degradar el/los set_main anterior(es), promover/crear el nuevo,
   * reescribir el espejo `CardSet.tcgcsvGroupId`) **más** la bitácora. Antes iban sueltas: un fallo a
   * mitad dejaba un **mapeo parcial** (p. ej. el viejo degradado pero el nuevo sin crear) o una
   * bitácora huérfana. Ahora COMMITEAN JUNTAS en una `$transaction` — o entra todo, o no entra nada.
   * La lectura del `label` (red a TCGCSV, best-effort) se resuelve **ANTES** de abrir la transacción:
   * ⛔ no se sostiene una transacción de BD abierta durante una llamada de red (O-17). Money-safe (I-2):
   * fija de qué grupo saldrá el precio; NO fabrica precio.
   */
  async setMainGroup(
    setId: string,
    body: { tcgplayerGroupId: number; reason?: string },
    actor?: { userId: string; role: Role },
  ): Promise<{ group: SealedSetGroupDTO; before: number | null; after: number }> {
    const set = await this.prisma.cardSet.findUnique({ where: { id: setId } });
    if (!set) throw BusinessException.notFound('NOT_FOUND', 'CardSet not found');
    const before = set.tcgcsvGroupId ?? null;
    const newGroupId = body.tcgplayerGroupId;

    const existingGroups = await this.prisma.sealedSetGroup.findMany({ where: { setId } });
    // Si ya existía la fila del NUEVO set_main (p. ej. como promo_collection) se PROMUEVE; si no, se crea.
    const dup = existingGroups.find((g) => g.tcgplayerGroupId === newGroupId);

    // Label best-effort desde TCGCSV (observabilidad/curación), FUERA de la transacción (red bloqueable,
    // O-17; jamás bloquea el remap). Solo hace falta cuando se crea una fila nueva.
    let label: string | null = null;
    if (!dup) {
      try {
        const groups = await this.provider.listGroups();
        label = groups.find((g) => g.groupId === newGroupId)?.name ?? null;
      } catch {
        /* money-safe: el mapeo no depende del label (egress a tcgcsv.com puede estar bloqueado, O-17). */
      }
    }

    const row = await this.prisma.$transaction(async (tx) => {
      // Degrada el/los set_main anterior(es) distinto(s) del nuevo a promo_collection (DO-5: no se borra;
      // conserva el enlace y sus productos, y el DELETE lo retira aparte si estorba).
      for (const g of existingGroups) {
        if (g.kind === 'set_main' && g.tcgplayerGroupId !== newGroupId) {
          await tx.sealedSetGroup.update({ where: { id: g.id }, data: { kind: 'promo_collection' } });
        }
      }
      const r = dup
        ? await tx.sealedSetGroup.update({ where: { id: dup.id }, data: { kind: 'set_main' } })
        : await tx.sealedSetGroup.create({
            data: { setId, tcgplayerGroupId: newGroupId, kind: 'set_main', label },
          });
      // REESCRIBE `CardSet.tcgcsvGroupId` (aunque ya hubiera uno) — la diferencia clave con `linkGroup`.
      await tx.cardSet.update({ where: { id: setId }, data: { tcgcsvGroupId: newGroupId } });
      // SEC-M11-2: la bitácora participa del MISMO commit/rollback que el remap que audita.
      if (this.audit && actor) {
        await this.audit.log(
          {
            actorUserId: actor.userId,
            actorRole: actor.role,
            action: 'inventory.sealed_set_main_group_set',
            entityType: 'CardSet',
            entityId: setId,
            before: { tcgcsvGroupId: before },
            after: { tcgcsvGroupId: newGroupId, reason: body.reason },
          },
          tx,
        );
      }
      return r;
    });

    return {
      group: {
        id: row.id,
        setId: row.setId,
        tcgplayerGroupId: row.tcgplayerGroupId,
        kind: row.kind,
        ...(row.label ? { label: row.label } : {}),
      },
      before,
      after: newGroupId,
    };
  }

  /**
   * `DELETE /admin/inventory/sealed-sets/:setId/groups/:groupId` (M11 §11.2) — desenlaza un grupo mal
   * asignado. Si era el `set_main`, pone `CardSet.tcgcsvGroupId=null` (el set vuelve a «SIN emparejar»
   * en §10, honesto). Money-safe: **NO borra `PriceReference`** ya escritas (quedan stale/inocuas,
   * §4.19c); sólo cambia de dónde saldrá el precio en la próxima ingesta. AUDITADO por el controller
   * (`inventory.sealed_set_group_unlink`, I-4) con el `before` que aquí se devuelve.
   */
  async unlinkGroup(
    setId: string,
    groupId: number,
  ): Promise<{ setId: string; tcgplayerGroupId: number; kind: SealedGroupKind }> {
    const set = await this.prisma.cardSet.findUnique({ where: { id: setId } });
    if (!set) throw BusinessException.notFound('NOT_FOUND', 'CardSet not found');
    const row = await this.prisma.sealedSetGroup.findUnique({
      where: { setId_tcgplayerGroupId: { setId, tcgplayerGroupId: groupId } },
    });
    if (!row) throw BusinessException.notFound('NOT_FOUND', 'group link not found for this set');

    await this.prisma.sealedSetGroup.delete({ where: { id: row.id } });
    // Si desenlazamos el set_main (por kind o por el espejo denormalizado), el set vuelve a SIN emparejar.
    if (row.kind === 'set_main' || set.tcgcsvGroupId === groupId) {
      await this.prisma.cardSet.update({ where: { id: setId }, data: { tcgcsvGroupId: null } });
    }
    return { setId, tcgplayerGroupId: row.tcgplayerGroupId, kind: row.kind };
  }

  // ============================ BACKFILL M-39 (pasos §4.34e 7-8) ============================

  /**
   * Backfill money-safe (pasos §4.34e 7-8): deriva `SealedProduct` de los items sellados YA MAPEADOS y
   * liga su `sealedProductId` (**cura el ETB→Tropius**: la pieza queda ligada a su presentación real).
   * Los sellados SIN MAPEO (tcgplayerProductId null) quedan `sealedProductId=null` + reporte de
   * reconciliación (cero adivinación; nunca inventa precio). IDEMPOTENTE (upsert + solo liga items con
   * sealedProductId null). El paso 6 (SealedSetGroup desde CardSet.tcgcsvGroupId) lo hizo la migración.
   */
  async backfillFromInventory(): Promise<SealedBackfillReport> {
    const report: SealedBackfillReport = { productsCreated: 0, itemsLinked: 0, unmappedItems: [] };

    // Pares DISTINTOS (productId, groupId) de sellado MAPEADO aún sin sealedProductId.
    const mapped = await this.prisma.inventoryItem.findMany({
      where: {
        productType: 'sealed',
        tcgplayerProductId: { not: null },
        sealedProductId: null,
      },
      select: {
        tcgplayerProductId: true,
        tcgplayerGroupId: true,
        sealedProductName: true,
        sealedImageUrl: true,
        sealedSubtype: true,
        cardId: true,
        card: { select: { setId: true } },
      },
    });

    const byProductId = new Map<number, (typeof mapped)[number]>();
    for (const it of mapped) {
      const pid = it.tcgplayerProductId as number;
      if (!byProductId.has(pid)) byProductId.set(pid, it);
    }

    for (const [productId, sample] of byProductId.entries()) {
      const setId = sample.card.setId;
      const name = sample.sealedProductName ?? `Sealed #${productId}`;
      const subtype = sample.sealedSubtype ?? inferSealedSubtype(name) ?? 'collection';
      const meta = SEALED_SUBTYPE_META[subtype];
      const existing = await this.prisma.sealedProduct.findUnique({
        where: { tcgplayerProductId: productId },
      });
      const sp =
        existing ??
        (await this.prisma.sealedProduct.create({
          data: {
            setId,
            tcgplayerProductId: productId,
            tcgplayerGroupId: sample.tcgplayerGroupId ?? 0,
            name,
            subtype,
            // El subtype VINO de una pieza curada al alta → no es «inferido de más»; pero si salió de
            // inferSealedSubtype sobre el nombre, sí. Conservador: marcado inferido para que un sync
            // pueda re-curarlo (money-safe: no se congela una adivinación).
            subtypeInferred: sample.sealedSubtype == null,
            isPrincipal: meta?.isPrincipal ?? false,
            origin: 'set_main',
            imageUrl: sample.sealedImageUrl ?? null,
            // Money-safe: JAMÁS se fabrica precio en el backfill (el ingest lo poblará).
            marketUsdCents: null,
            active: true,
          },
        }));
      if (!existing) report.productsCreated += 1;

      // Liga TODAS las piezas selladas de ese productId aún sin sealedProductId (cura ETB→Tropius).
      const linked = await this.prisma.inventoryItem.updateMany({
        where: { productType: 'sealed', tcgplayerProductId: productId, sealedProductId: null },
        data: { sealedProductId: sp.id },
      });
      report.itemsLinked += linked.count;
    }

    // Paso 8: sellados SIN MAPEO → no se pueden backfillar sin adivinar → sealedProductId queda null.
    const unmapped = await this.prisma.inventoryItem.findMany({
      where: { productType: 'sealed', tcgplayerProductId: null, sealedProductId: null },
      select: { folio: true, cardId: true },
    });
    report.unmappedItems = unmapped.map((u) => ({ folio: u.folio, cardId: u.cardId }));

    this.logger.log(
      `M-39 backfill: ${report.productsCreated} SealedProduct creados, ${report.itemsLinked} piezas ` +
        `ligadas (ETB→Tropius curado), ${report.unmappedItems.length} piezas SIN MAPEO quedan null ` +
        `(reconciliación; cero adivinación).`,
    );
    return report;
  }

  // ============================ helpers de name-match / upstream ============================

  private async listGroupsOr502(): Promise<TcgcsvGroupRef[]> {
    try {
      return await this.provider.listGroups();
    } catch (e) {
      throw new BusinessException(
        ErrorCode.UPSTREAM_ERROR,
        HttpStatus.BAD_GATEWAY,
        `TCGCSV upstream error (groups): ${(e as Error).message}`,
      );
    }
  }

  private async listSealedProductsOr502(groupId: number) {
    try {
      return await this.provider.listSealedProducts(groupId);
    } catch (e) {
      throw new BusinessException(
        ErrorCode.UPSTREAM_ERROR,
        HttpStatus.BAD_GATEWAY,
        `TCGCSV upstream error (products of group ${groupId}): ${(e as Error).message}`,
      );
    }
  }

  /**
   * Score de coincidencia nombre+año (0..1, orientativo). 1.0 = nombre exacto (normalizado) + año igual;
   * 0.9 = nombre exacto sin poder confirmar año; 0.5 = contención parcial. Money-safe: solo orienta la UI.
   *
   * Tolerante al prefijo de código de TCGCSV: los grupos de TCGCSV nombran con prefijo de colección
   * (`"SV08: Pitch Black"`) mientras el catálogo local NO (`"Pitch Black"`). Comparamos vía
   * `setNameCandidates`, que incluye el nombre completo y —si trae prefijo tipo `"SV08:"`— también el
   * nombre SIN prefijo; así el match exacto sin-prefijo sube al rango auto-resoluble en vez de caer a 0.5.
   */
  private matchScore(
    set: { name: string; releaseDate: string | null },
    g: TcgcsvGroupRef,
  ): number {
    const targets = setNameCandidates(set.name).filter((s) => s !== '');
    if (targets.length === 0) return 0;
    const gnames = setNameCandidates(g.name).filter((s) => s !== '');
    if (gnames.length === 0) return 0;
    // Exacto: alguna variante (con/sin prefijo) del set local empata con alguna del grupo.
    if (targets.some((t) => gnames.includes(t))) {
      const localYear = releaseYear({ releaseDate: set.releaseDate });
      const groupYear = releaseYear({ releaseDate: g.publishedOn ?? null });
      if (localYear != null && groupYear != null) return localYear === groupYear ? 1.0 : 0.7;
      return 0.9;
    }
    // Contención parcial: alguna variante contiene o está contenida en alguna del grupo.
    if (targets.some((t) => gnames.some((gn) => gn.includes(t) || t.includes(gn)))) return 0.5;
    return 0;
  }

  /**
   * Mejor candidato a set_main. **REUSA `matchTcgcsvGroupByName`** (P-46-bis, 2026-09-17): la escalera
   * de match S-D3 vive en UN solo sitio (`providers/tcgcsv-group-match.ts`) — `exact` / `exact_unprefixed`
   * (P-47) / `exact_debased` (bases de era «SV01: … Base Set») / `contains`, con desambiguación money-safe
   * (match ÚNICO o `null`, nunca adivina). Antes el sellado duplicaba la lógica con `matchScore`, que **no
   * tenía el peldaño `exact_debased`** ⇒ las bases de era caían al `contains` ambiguo y quedaban sin grupo.
   * ⚠️ El comentario de `tcgcsv-group-match.ts:26` ya advertía que copiar el match es cómo P-46 llegó a
   * tres sitios y nunca al que movía dinero: el sellado era esa tercera ruta; ahora llama a la fuente única.
   *
   * Sobre el resultado de la fuente única el sellado aplica su política PROPIA, **más estricta** que la de
   * sueltas (que se conserva idéntica a la del histórico `bestSetMainMatch`, ≥0.9 y con desempate de año):
   *  - **RECHAZA el peldaño `contains`** — la contención pura (kit de prerelease, promos) puntuaba 0.5 en
   *    `matchScore`, por debajo del umbral 0.9; sigue siendo curación a mano, no auto-adopción.
   *  - **Guarda de AÑO** — si el set local y el grupo tienen año y **DIFIEREN**, no adopta (reimpresión /
   *    homónimo de otra era); espeja el 0.7 < 0.9 del histórico. Año desconocido en cualquier lado ⇒ acepta
   *    (espeja el 0.9 «exacto sin poder confirmar año»).
   *
   * Money-safe respecto de HOY: sólo puede pasar `null → groupId` (rescatar bases de era congeladas), jamás
   * `groupId → OTRO grupo`. La contención ambigua de varios grupos ya la corta `matchTcgcsvGroupByName`
   * devolviendo `null` (no baja al siguiente peldaño). `matchScore` se conserva para la UI de candidatos.
   */
  private bestSetMainMatch(
    set: { name: string; releaseDate: string | null },
    groups: TcgcsvGroupRef[],
  ): TcgcsvGroupRef | null {
    const match = matchTcgcsvGroupByName(set.name, groups);
    if (match.groupId == null) return null;
    // El sellado NO auto-adopta contención pura (needs human curation): conserva el umbral histórico.
    if (match.tier === 'contains') return null;
    const g = groups.find((x) => x.groupId === match.groupId);
    if (!g) return null;
    // Guarda de año money-safe: ambos conocidos y distintos ⇒ no adopta (misma regla que el 0.7 histórico).
    const localYear = releaseYear({ releaseDate: set.releaseDate });
    const groupYear = releaseYear({ releaseDate: g.publishedOn ?? null });
    if (localYear != null && groupYear != null && localYear !== groupYear) return null;
    return g;
  }
}
