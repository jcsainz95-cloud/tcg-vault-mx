import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CardProductKind, Finish, InventoryStatus, Prisma, ProductType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { PricingService } from '../pricing/pricing.service';
// H-1 (§4.36.6): «presente ⇔ > 0» en UN solo predicado compartido — prohibido repetirlo a mano.
import { hasManualPrice } from '../../common/money';
// v1.28 (P-18, §4.26b): composer ÚNICO del `pricing?` de la variante (consola de tres precios).
import { VariantPricingDTO, composeVariantPricing } from '../pricing/variant-pricing';
import { CARD_ORDER_BY_IN_SET, FINISH_ORDER, computeDisplayFinishes } from '../../common/card-order';
// v1.33 (P-27, §4.31): mapa curado padre→subset del MASTER SET COMBINADO. SOLO lectura de
// presentación (money-safe): resuelve `externalId`→`CardSet.id` local por join; nunca fuente de verdad.
import {
  allMappedExternalIds,
  groupForPrimaryExternalId,
  MASTER_SET_GROUPS,
  parentExternalIdOf,
  partExternalIds,
  subsetMetaOf,
} from '../../config/master-set-groups';

/**
 * MasterSetService (v1.16-master-set §4.17a · v1.20-master-set-everywhere §4.20a) — read model
 * ÚNICO de "contenido agrupado por set y por acabado", parametrizado por SCOPE:
 *  - `platform`   → inventario de PLATAFORMA (M1, regla on-hand v1.16 intacta).
 *  - `user_vault` → bóveda de UN usuario (ownerType='customer' AND ownerUserId=:userId, ambas
 *                   titularidades pending|settled, mismo filtro de status en bóveda).
 * Dos superficies, MISMO shape en los tres consumidores (M1 / admin-bóveda-cliente / Mi bóveda):
 *  - `index()`  → índice de sets con completitud/piezas + contadores por VARIANTE.
 *  - `binder()` → cuadrícula por número con countsByFinish + `variants[]`, ORDEN NATURAL.
 *
 * v1.20 — completitud por VARIANTE (carta+acabado): el universo esperado por carta =
 * `Card.availableFinishes` (histórico/vacío → ['normal']); los contadores «X/Y» cuentan variantes.
 * DRIFT: una pieza cuyo finish ya no está en availableFinishes se ve en countsByFinish pero NO
 * cuenta en expected/covered (evita covered > expected). Omisiones por scope (regla dura §4.20a):
 * este shape NUNCA expone ubicaciones/costos/folios; `owner` solo en user_vault (email solo vista
 * admin); `buyable` solo en la vista (iii) del propio cliente.
 *
 * Consultas FIJAS (sin N+1), patrón `set-value.service.ts`: queries en lote + agregación en memoria.
 */

/** "on-hand"/"en bóveda" = status NOT IN estos (ARCHITECTURE §4.17a/§4.20a, API_CONTRACT §DTOs). */
export const NOT_ON_HAND: InventoryStatus[] = [
  'withdrawn',
  'shipped',
  'delivered',
  'lost',
  'damaged',
];

/**
 * v1.22 — el ORDEN CANONICO (de acabados y de numeros) vive en `common/card-order.ts`: UN solo
 * algoritmo compartido por el sync (que ESCRIBE `numberSort`/`numberPrefix`), por el `orderBy` de
 * la BD y por los seeds (ARCHITECTURE 4.22b). Se re-exporta aqui por compatibilidad de imports.
 */
export {
  FINISH_ORDER,
  PROMO_SORT_BASE,
  deriveNumberParts,
  compareByNumber,
} from '../../common/card-order';

/** Alcance de la agregación (ARCHITECTURE §4.20a). Solo cambia el WHERE, nunca el shape. */
export type MasterSetQueryScope = { kind: 'platform' } | { kind: 'user_vault'; userId: string };

/** Opciones de vista (omisiones por scope §4.20a): email solo vista (ii); buyable solo vista (iii). */
export interface MasterSetViewOptions {
  includeOwnerEmail?: boolean;
  includeBuyable?: boolean;
}

export interface VaultOwnerRefDTO {
  userId: string;
  name: string;
  email?: string;
}

/**
 * v1.20 — variante = (carta, acabado) del UNIVERSO `Card.availableFinishes`. `covered` = ≥1 pieza
 * en el scope. `buyable` SOLO scope cliente y SOLO cuando covered=false: la pieza `listed` de
 * plataforma MÁS BARATA de ese (cardId, finish), o null si no hay nada publicado.
 */
export interface MasterSetVariantDTO {
  finish: Finish;
  count: number;
  covered: boolean;
  // v1.22-2 / N-16 (§4.22a-6): espejo de conveniencia para el render PLANO — `= finish ∈
  // cell.displayFinishes`. Las variantes `displayed=false` (acabado espurio suprimido) NO se pintan
  // pero SIGUEN contando para completitud (X/Y) y buyable (universo = availableFinishes, intacto).
  displayed: boolean;
  // v1.27 (P-15, §4.25b / §DTOs) — precio de MERCADO de ESTE acabado: la `PriceReference` vigente
  // de (cardId, 'raw', 'raw:NM', finish), FX-recomputada a MXN (`liveMxnCents` vía
  // `getReferencesBatch`). `null` = pending/ausente (jamás un 0 inventado; el front pinta «—»).
  // NO es el precio de venta derivado (ese vive en `buyable.salePriceCents`, solo vista cliente).
  marketReferenceMxnCents?: number | null;
  // v1.27 (P-15) — `PriceReference.capturedDate` (ISO yyyy-MM-dd) de ESA fila; decoración de
  // frescura, presente SOLO cuando hay precio (`marketReferenceMxnCents != null`).
  capturedDate?: string | null;
  // v1.28 (P-18, §4.26b / §DTOs) — la CONSOLA de precios de la variante (compra/venta: sugerido
  // por regla, override vigente, efectivo resuelto + fuente; bounty P-22). Presente SOLO en scope
  // `platform` (M1): en `user_vault` y «Mi bóveda» se OMITE SIEMPRE (la estrategia de compra/bounty
  // no se filtra al cliente — regla dura, misma familia que la omisión de costos/folios).
  // Sugeridos/efectivos en lote (reglas izadas una vez + getReferencesBatch +
  // getVariantOverridesBatch; sin N+1). `null` = no resoluble (money-safe, nunca 0 inventado).
  pricing?: VariantPricingDTO;
  buyable?: { inventoryItemId: string; salePriceCents: number } | null;
}

export interface MasterSetSummaryDTO {
  setId: string;
  name: string;
  series?: string;
  releaseDate?: string;
  year?: number;
  printedTotal?: number;
  catalogCardCount: number;
  distinctCardsOwned: number;
  completionPct: number | null;
  totalPieces: number;
  // v1.20 — contadores por VARIANTE (los «X/Y» de UI usan ESTOS, no los de carta).
  catalogVariantCount: number;
  distinctVariantsOwned: number;
  variantCompletionPct: number | null;
  // v1.33 (P-27, §4.31c): master set combinado. Los subset de un grupo se PLIEGAN en la fila del
  // principal y TODOS los agregados de arriba se SUMAN sobre `partSetIds` (los set-ids REALES
  // plegados: principal + subsets importados). Presente SOLO en masters combinados (≥2 partes);
  // un set normal lo OMITE. ADITIVO/opcional. Money-safe: solo lectura de presentación.
  partSetIds?: string[];
  // v1.52-set-logos (M-47, §4.39.5) — LOGO de la expansión (`CardSet.logoUrl`, `images.logo` de
  // pokemontcg.io). Es EL campo de la teja de selección de set y viaja en los CUATRO consumidores de
  // este DTO (M1, admin-bóveda-cliente, «Mi bóveda» y —vía `GET /buylist/sets`— el cotizador): es un
  // read model ÚNICO y romper esa simetría sería el error.
  // ⚠️ `string | null`, NO `logoUrl?`: la clave va SIEMPRE presente y la ausencia se expresa con `null`
  // (clase (P) presentación, §5.2.9). `null` es NORMAL y PERMANENTE (sets que el proveedor no ilustra)
  // y también es lo que rinde un set aún no re-sincronizado; el contrato NO distingue ambos orígenes.
  // Sale de la MISMA fila `CardSet` de la query (1) del índice ⇒ cero queries nuevas, cero N+1.
  // NO existe `symbolUrl` aquí: se persiste en `CardSet` pero NO se expone en ningún DTO (§4.39.5).
  logoUrl: string | null;
}

export interface MasterSetIndexResponse {
  data: MasterSetSummaryDTO[];
  page: number;
  pageSize: number;
  total: number;
  // v1.20 — scope de la agregación + dueño (solo user_vault; email solo vista admin).
  scope: MasterSetQueryScope['kind'];
  owner?: VaultOwnerRefDTO;
}

export interface SetRefDTO {
  id: string;
  name: string;
  series?: string;
  releaseDate?: string;
}

/**
 * v1.33 (P-27, §4.31b / §DTOs) — una parte de un master set combinado (principal o subset). El binder
 * de un master combinado trae `parts[]` (una entrada por parte importada, en orden de bloque) para que
 * el front pinte el desglose/separador. `catalogCardCount` = nº de `Card` de ESE set-id real.
 */
export interface SetPartDTO {
  setId: string;
  name: string;
  /** Etiqueta del separador del bloque. En el principal = su propio `name`; en un subset = su `label`. */
  label?: string;
  isPrimary: boolean;
  /** Orden de bloque: principal = 0; subsets por su `order` (1, 2, …). */
  order: number;
  catalogCardCount: number;
}

export interface MasterSetCardCellDTO {
  cardId: string;
  number: string;
  // v1.22 (M-26): claves PERSISTIDAS del orden natural. `numberSort` SOLO no basta para re-ordenar
  // en el front (`TG12` y `GG12` colisionan en 1000012) -> el contrato anade `numberPrefix`.
  numberSort: number;
  numberPrefix: string;
  name: string;
  rarity?: string;
  imageSmallUrl?: string;
  availableFinishes: Finish[];
  // v1.22-2 / N-15 (§4.22a-6): subconjunto DISPLAY-only de availableFinishes que el front PINTA
  // (oculta el acabado espurio de una premium de 1 impresión). ⊆ availableFinishes, orden
  // FINISH_ORDER, nunca vacío. NO cambia la completitud X/Y (que cuenta sobre availableFinishes).
  displayFinishes: Finish[];
  countsByFinish: { finish: Finish; count: number }[];
  totalCount: number;
  isSecretRare: boolean;
  // v1.20 — completitud por variante de ESTA carta (universo = availableFinishes; drift fuera).
  expectedVariantCount: number;
  coveredVariantCount: number;
  variants: MasterSetVariantDTO[];
  // v1.26 (P-2, §M1 / §4.24d) — precio de MERCADO de la carta = la `PriceReference` CRUDA del
  // acabado BASE (raw:NM, primer acabado del universo), FX-recomputada al MXN vigente (misma lógica
  // `liveMxnCents` que valúa la bóveda). NO es el precio de VENTA derivado (referencia × (1+markup));
  // ese vive en `buyable.salePriceCents` para la vista cliente. `null` cuando la referencia está
  // `pending`/ausente (no se inventa un 0). ADITIVO/opcional; solo lectura/visual (no toca SEC-A1).
  // Batched (getReferencesBatch) — sin N+1.
  // ⚠️ v1.27 (P-15, §4.25b): DEPRECADO — el precio de mercado vive ahora en la VARIANTE
  // (`variants[].marketReferenceMxnCents`). Este campo se conserva UNA versión como ESPEJO de la
  // variante del acabado base (`= variants[0].marketReferenceMxnCents`, costo cero: mismo batch)
  // para lectores rezagados; retiro en la siguiente rev de contrato.
  marketReferenceMxnCents?: number | null;
  // v1.29 (§4.27i / API_CONTRACT §DTOs) — productos SEPARADOS de la carta (`deck_exclusive`/`promo`),
  // cada uno con su `productId`, `kind`, `name`, `finishes` y precio POR VARIANTE en MXN (o `null`).
  // Los `set_base` ya están en `variants`; estos NO fusionan sus acabados con la carta de set (§4.27e).
  // Ausente/[] cuando la carta no tiene productos separados (el caso común).
  separateProducts?: CardProductDTO[];
  // v1.33 (P-27, §4.31b / §DTOs) — master set combinado: a qué PARTE REAL pertenece la celda (su
  // `CardSet` local) y la etiqueta del bloque. Presentes SOLO en un master combinado (cuando el binder
  // trae `parts`); el front agrupa las celdas por `partSetId` y pinta el separador con `partLabel`. En
  // un set normal se OMITEN. NO cambian la identidad: `cardId` sigue llaveado a su set real (money-safe).
  partSetId?: string;
  partLabel?: string;
}

/** v1.29 (§4.27i) — un producto TCGplayer vendible/cotizable aparte bajo la carta. */
export interface CardProductDTO {
  productId: number;
  kind: CardProductKind;
  name: string;
  finishes: Finish[];
  prices: { finish: Finish; marketReferenceMxnCents: number | null; capturedDate?: string | null }[];
}

export interface MasterSetBinderResponse {
  set: SetRefDTO;
  printedTotal: number | null;
  catalogCardCount: number;
  cells: MasterSetCardCellDTO[];
  // v1.20 — scope + dueño (solo user_vault; email solo vista admin).
  scope: MasterSetQueryScope['kind'];
  owner?: VaultOwnerRefDTO;
  // v1.33 (P-27, §4.31b / §DTOs) — master set combinado. `set` = SetRefDTO del PRINCIPAL (nombre del
  // master); `catalogCardCount`/`printedTotal` = Σ de TODAS las partes (Celebrations = 50). `parts`
  // presente SOLO en un master combinado (≥2 partes): una entrada por parte, orden de bloque
  // (principal primero). `canonicalSetId` presente SOLO cuando el `:setId` pedido era un SUBSET y se
  // normalizó a su principal (el front actualiza la URL; evita el binder roto de 25). Un set normal
  // omite ambos. Money-safe: cada celda/pieza conserva su set-id real.
  parts?: SetPartDTO[];
  canonicalSetId?: string;
}

/** Deriva el año del set desde `releaseDate` (`yyyy/MM/dd` de pokemontcg.io). */
export function yearFromReleaseDate(releaseDate?: string | null): number | undefined {
  if (!releaseDate) return undefined;
  const m = /^(\d{4})/.exec(releaseDate);
  return m ? parseInt(m[1], 10) : undefined;
}

/**
 * v1.20 — universo de variantes esperadas de una carta: `Card.availableFinishes` en el orden del
 * enum Finish; filas históricas/sin datos (array vacío o null) → ['normal'] (API_CONTRACT §DTOs).
 */
export function expectedFinishes(available: Finish[] | null | undefined): Finish[] {
  const arr = available ?? [];
  if (arr.length === 0) return ['normal'];
  return FINISH_ORDER.filter((f) => arr.includes(f));
}

/**
 * v1.33 (P-27, §4.31b) — resultado de resolver las partes de un master set combinado. `null` en el
 * llamador = set normal (comportamiento v1.20 intacto). Las partes vienen en ORDEN DE BLOQUE
 * (principal primero, order 0; luego cada subset por su `order`). Todas son set-ids LOCALES REALES
 * ya resueltos por join (solo las importadas). Money-safe: es SOLO metadata de presentación.
 */
interface ResolvedMasterSet {
  /** El `CardSet` PRINCIPAL (nombra al master, provee el `SetRefDTO`). */
  primary: { id: string; name: string; series: string | null; releaseDate: string | null; printedTotal: number | null };
  /** Partes importadas en orden de bloque (incluye el principal). Siempre ≥2 (si fuera 1 → null). */
  parts: { setId: string; name: string; label: string; isPrimary: boolean; order: number; printedTotal: number | null }[];
  /** Set-ids locales reales de las partes, en orden de bloque. */
  partSetIds: string[];
  /** Presente SOLO si el `:setId` pedido era un SUBSET y se normalizó a su principal (el front actualiza URL). */
  canonicalSetId?: string;
}

@Injectable()
export class MasterSetService implements OnModuleInit {
  private readonly logger = new Logger(MasterSetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * v1.33 (P-27, §4.31a) — validación al BOOT del mapa curado: resuelve cada `externalId` mapeado
   * contra `CardSet` local y LOGUEA WARNING por cada uno NO importado (caso borde CA-71). NUNCA
   * revienta: es solo un aviso de higiene del mapa (un subset sin su principal se degrada a set normal
   * en runtime). Defensivo: si la BD no está disponible al arrancar (tests de DI con Prisma mockeado),
   * se ignora en silencio. Money-safe: solo lectura, ninguna escritura.
   */
  async onModuleInit(): Promise<void> {
    const externalIds = allMappedExternalIds();
    if (externalIds.length === 0) return;
    try {
      const present = await this.prisma.cardSet.findMany({
        where: { externalId: { in: externalIds } },
        select: { externalId: true },
      });
      const found = new Set(present.map((s) => s.externalId));
      const missing = externalIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        this.logger.warn(
          `[master-set-groups] externalId(s) mapeados pero NO importados: ${missing.join(', ')}. ` +
            `Esas partes NO se combinan hasta importarse (CA-71). Revisa config/master-set-groups.ts.`,
        );
      }
    } catch {
      // BD no disponible en el arranque (p. ej. smoke de DI con Prisma mockeado): validación diferida.
    }
  }

  /**
   * v1.33 (P-27, §4.31b) — resuelve si `set` (por su `externalId`) forma parte de un master COMBINADO
   * y, de ser así, devuelve sus partes importadas en orden de bloque. Devuelve `null` cuando NO hay
   * combinación (set normal, o subset cuyo principal no está importado, o principal cuyos subsets no
   * están importados → una sola parte): el llamador conserva el comportamiento v1.20. SOLO lectura;
   * jamás toca precio/inventario/bóveda. UNA query (`CardSet WHERE externalId IN partes`).
   */
  private async resolveMasterSet(set: {
    id: string;
    externalId: string;
  }): Promise<ResolvedMasterSet | null> {
    // ¿El set pedido es el PRINCIPAL de un grupo, o un SUBSET (que normalizamos a su principal)?
    let primaryExternalId: string | undefined;
    let requestedIsSubset = false;
    if (groupForPrimaryExternalId(set.externalId)) {
      primaryExternalId = set.externalId;
    } else {
      const parent = parentExternalIdOf(set.externalId);
      if (parent) {
        primaryExternalId = parent;
        requestedIsSubset = true;
      }
    }
    if (!primaryExternalId) return null; // set normal → sin combinación.

    // Resolver externalId → CardSet local de TODAS las partes del grupo (solo las importadas).
    const partExt = partExternalIds(primaryExternalId); // [principal, ...subsets] en orden de bloque
    const cardSets = await this.prisma.cardSet.findMany({
      where: { externalId: { in: partExt } },
      select: { id: true, externalId: true, name: true, series: true, releaseDate: true, printedTotal: true },
    });
    const byExternal = new Map(cardSets.map((s) => [s.externalId, s]));

    const primary = byExternal.get(primaryExternalId);
    // CA-71: principal NO importado → no se pliega (el subset se muestra como su propio set normal).
    if (!primary) return null;

    // Partes en orden de bloque: principal (order 0) + cada subset importado por su `order`.
    const parts: ResolvedMasterSet['parts'] = [
      {
        setId: primary.id,
        name: primary.name,
        label: primary.name, // en el principal la etiqueta = su propio nombre (§DTOs).
        isPrimary: true,
        order: 0,
        printedTotal: primary.printedTotal,
      },
    ];
    for (const ext of partExt) {
      if (ext === primaryExternalId) continue;
      const cs = byExternal.get(ext);
      if (!cs) continue; // subset no importado → se omite (suma sobre las partes presentes, §4.31f).
      const meta = subsetMetaOf(ext);
      parts.push({
        setId: cs.id,
        name: cs.name,
        label: meta?.label ?? cs.name,
        isPrimary: false,
        order: meta?.order ?? 1,
        printedTotal: cs.printedTotal,
      });
    }
    parts.sort((a, b) => a.order - b.order);

    // Combinado = ≥2 partes. Si solo está el principal (sin subsets importados) → set normal (null).
    if (parts.length < 2) return null;

    return {
      primary,
      parts,
      partSetIds: parts.map((p) => p.setId),
      // Normalización del subset: si pedimos por el id del subset, exponemos el id del principal.
      ...(requestedIsSubset && set.id !== primary.id ? { canonicalSetId: primary.id } : {}),
    };
  }

  /**
   * Índice de sets con resumen agregado, por SCOPE. SIN N+1: 4 queries fijas (sets q-filtrados +
   * `Card.groupBy` de catalogCardCount + 1 agregación raw de Σ|availableFinishes| por set + 1
   * agregación raw de piezas/distinct cartas/distinct VARIANTES por set). La agregación cubre TODOS
   * los sets que hacen match con `q` para permitir el `sort` global; sigue O(1) queries.
   * En scope `user_vault` el índice devuelve SOLO sets con ≥1 pieza del usuario (API_CONTRACT §3).
   */
  async index(
    q: { q?: string; page: number; pageSize: number; sort: string },
    scope: MasterSetQueryScope = { kind: 'platform' },
    opts: MasterSetViewOptions = {},
  ): Promise<MasterSetIndexResponse> {
    // 404 temprano si el userId del scope no existe (vista (ii) admin). Vista (iii): siempre yo.
    const owner = await this.resolveOwner(scope, opts);

    const sets = await this.prisma.cardSet.findMany({
      where: q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {},
      // v1.33 (P-27): `externalId` para plegar subsets→principal por el mapa curado (§4.31c).
      // v1.52 (M-47, §4.39.5): `logoUrl` sale de ESTA misma fila ⇒ cero queries nuevas, cero N+1.
      select: {
        id: true,
        externalId: true,
        name: true,
        series: true,
        releaseDate: true,
        printedTotal: true,
        logoUrl: true,
      },
    });
    const setIds = sets.map((s) => s.id);
    const externalBySetId = new Map(sets.map((s) => [s.id, s.externalId]));

    const grouped = setIds.length
      ? await this.prisma.card.groupBy({
          by: ['setId'],
          where: { setId: { in: setIds } },
          _count: { _all: true },
        })
      : [];
    const catalogBySet = new Map<string, number>(grouped.map((g) => [g.setId, g._count._all]));

    const variantsBySet = await this.aggregateCatalogVariantsBySet(setIds);
    const agg = await this.aggregateInventoryBySet(setIds, scope);

    let rows: MasterSetSummaryDTO[] = sets.map((s) => {
      const catalogCardCount = catalogBySet.get(s.id) ?? 0;
      const catalogVariantCount = variantsBySet.get(s.id) ?? 0;
      const a = agg.get(s.id) ?? { pieces: 0, distinctCards: 0, distinctVariants: 0 };
      const completionPct =
        catalogCardCount === 0
          ? null
          : Math.round((a.distinctCards / catalogCardCount) * 10000) / 100;
      const variantCompletionPct =
        catalogVariantCount === 0
          ? null
          : Math.round((a.distinctVariants / catalogVariantCount) * 10000) / 100;
      return {
        setId: s.id,
        name: s.name,
        series: s.series ?? undefined,
        releaseDate: s.releaseDate ?? undefined,
        year: yearFromReleaseDate(s.releaseDate),
        printedTotal: s.printedTotal ?? undefined,
        catalogCardCount,
        distinctCardsOwned: a.distinctCards,
        completionPct,
        totalPieces: a.pieces,
        catalogVariantCount,
        distinctVariantsOwned: a.distinctVariants,
        variantCompletionPct,
        // v1.52 (M-47, §4.39.6): clave SIEMPRE presente; `?? null` porque la columna es `String?` y
        // Prisma rinde `null`, pero el `??` deja explícito que jamás se omite ni se emite `""`.
        logoUrl: s.logoUrl ?? null,
      };
    });

    // v1.33 (P-27, §4.31c): PLEGADO del master set combinado. Los subset de un grupo se funden en la
    // fila del principal (agregados SUMADos sobre las partes; completitud recomputada) y desaparecen
    // como filas propias. Va ANTES del filtro user_vault para que un subset con piezas cuente en el
    // principal aunque el principal tenga 0. Money-safe: solo re-agrupa lecturas ya calculadas.
    rows = this.foldCombinedMasterSets(rows, externalBySetId);

    // Vista de bóveda: solo sets con ≥1 pieza del usuario (el catálogo entero como índice es ruido;
    // la completitud contra el catálogo se ve al abrir el binder de un set, §4.20a).
    if (scope.kind === 'user_vault') rows = rows.filter((r) => r.totalPieces > 0);

    rows = this.sortSummaries(rows, q.sort);
    const total = rows.length;
    const start = (q.page - 1) * q.pageSize;
    const data = rows.slice(start, start + q.pageSize);
    return {
      data,
      page: q.page,
      pageSize: q.pageSize,
      total,
      scope: scope.kind,
      ...(owner ? { owner } : {}),
    };
  }

  /** Ordena el índice según `sort` (release_desc default | completion_asc | pieces_desc). */
  private sortSummaries(rows: MasterSetSummaryDTO[], sort: string): MasterSetSummaryDTO[] {
    const byRelease = (a: MasterSetSummaryDTO, b: MasterSetSummaryDTO) =>
      (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '');
    if (sort === 'completion_asc') {
      return [...rows].sort((a, b) => {
        const av = a.completionPct ?? Number.POSITIVE_INFINITY; // null (sin catálogo) al final
        const bv = b.completionPct ?? Number.POSITIVE_INFINITY;
        return av - bv || byRelease(a, b);
      });
    }
    if (sort === 'pieces_desc') {
      return [...rows].sort((a, b) => b.totalPieces - a.totalPieces || byRelease(a, b));
    }
    return [...rows].sort(byRelease); // release_desc (default)
  }

  /**
   * v1.33 (P-27, §4.31c) — PLIEGA los subset de cada master combinado en la fila de su principal:
   * suma los agregados sobre las partes (cada carta pertenece a UN solo set → sin solapamiento, la
   * suma es exacta), recomputa completitud y quita las filas de subset. La fila del principal conserva
   * su `setId`/`name`/`releaseDate` (nombre del master) y gana `partSetIds`. CA-71: si el principal no
   * está en `rows` (no importado / fuera del filtro `q`) NO se pliega. Puro/sin queries; money-safe.
   * v1.52 (M-47): `logoUrl` NO se suma ni se hereda del subset — la fila combinada emite el logo DEL
   * PRINCIPAL (§API_CONTRACT M1), que es exactamente lo que ya trae `primaryRow` sin tocarlo.
   */
  private foldCombinedMasterSets(
    rows: MasterSetSummaryDTO[],
    externalBySetId: Map<string, string>,
  ): MasterSetSummaryDTO[] {
    if (MASTER_SET_GROUPS.length === 0) return rows;
    const rowByExternal = new Map<string, MasterSetSummaryDTO>();
    for (const r of rows) {
      const ext = externalBySetId.get(r.setId);
      if (ext) rowByExternal.set(ext, r);
    }
    const sum = (parts: MasterSetSummaryDTO[], pick: (r: MasterSetSummaryDTO) => number) =>
      parts.reduce((acc, r) => acc + pick(r), 0);
    const removedSetIds = new Set<string>();
    for (const g of MASTER_SET_GROUPS) {
      const primaryRow = rowByExternal.get(g.primary);
      if (!primaryRow) continue; // CA-71: principal ausente → no se pliega (subset queda como su set).
      const subsetRows = g.subsets
        .map((s) => rowByExternal.get(s.externalId))
        .filter((r): r is MasterSetSummaryDTO => Boolean(r));
      if (subsetRows.length === 0) continue; // solo el principal presente → set normal (sin pliegue).
      const partRows = [primaryRow, ...subsetRows];
      const catalogCardCount = sum(partRows, (r) => r.catalogCardCount);
      const catalogVariantCount = sum(partRows, (r) => r.catalogVariantCount);
      const distinctCardsOwned = sum(partRows, (r) => r.distinctCardsOwned);
      const distinctVariantsOwned = sum(partRows, (r) => r.distinctVariantsOwned);
      const totalPieces = sum(partRows, (r) => r.totalPieces);
      const printedTotal = partRows.reduce<number | undefined>(
        (acc, r) => (r.printedTotal == null ? acc : (acc ?? 0) + r.printedTotal),
        undefined,
      );
      // Muta la fila del principal (in-place): sus agregados pasan a ser Σ de las partes.
      primaryRow.catalogCardCount = catalogCardCount;
      primaryRow.catalogVariantCount = catalogVariantCount;
      primaryRow.distinctCardsOwned = distinctCardsOwned;
      primaryRow.distinctVariantsOwned = distinctVariantsOwned;
      primaryRow.totalPieces = totalPieces;
      primaryRow.printedTotal = printedTotal;
      primaryRow.completionPct =
        catalogCardCount === 0
          ? null
          : Math.round((distinctCardsOwned / catalogCardCount) * 10000) / 100;
      primaryRow.variantCompletionPct =
        catalogVariantCount === 0
          ? null
          : Math.round((distinctVariantsOwned / catalogVariantCount) * 10000) / 100;
      primaryRow.partSetIds = partRows.map((r) => r.setId);
      for (const s of subsetRows) removedSetIds.add(s.setId);
    }
    return removedSetIds.size ? rows.filter((r) => !removedSetIds.has(r.setId)) : rows;
  }

  /**
   * v1.20 — resuelve el `owner` del scope (`user_vault` → { userId, name, email? }; email SOLO en
   * la vista admin (ii)). 404 si el usuario del scope no existe (API_CONTRACT §M1 v1.20).
   */
  private async resolveOwner(
    scope: MasterSetQueryScope,
    opts: MasterSetViewOptions,
  ): Promise<VaultOwnerRefDTO | null> {
    if (scope.kind !== 'user_vault') return null;
    const user = await this.prisma.user.findUnique({
      where: { id: scope.userId },
      select: { id: true, name: true, email: true },
    });
    if (!user) throw BusinessException.notFound('NOT_FOUND', 'User not found');
    return {
      userId: user.id,
      name: user.name,
      ...(opts.includeOwnerEmail ? { email: user.email } : {}),
    };
  }

  /** WHERE Prisma del scope (mismo filtro de status "en bóveda"/on-hand en ambos). */
  private scopeWhere(scope: MasterSetQueryScope): Prisma.InventoryItemWhereInput {
    return scope.kind === 'platform'
      ? { ownerType: 'platform', status: { notIn: NOT_ON_HAND } }
      : { ownerType: 'customer', ownerUserId: scope.userId, status: { notIn: NOT_ON_HAND } };
  }

  /** Fragmento SQL del scope para las agregaciones raw (alias `ii` = InventoryItem). */
  private scopeSql(scope: MasterSetQueryScope): Prisma.Sql {
    return scope.kind === 'platform'
      ? Prisma.sql`ii."ownerType" = 'platform'`
      : Prisma.sql`ii."ownerType" = 'customer' AND ii."ownerUserId" = ${scope.userId}`;
  }

  /**
   * v1.20 — UNA agregación raw sobre `Card`: Σ|availableFinishes| por set (denominador de la
   * completitud por variante). Filas con array vacío cuentan 1 (universo histórico = ['normal']).
   */
  private async aggregateCatalogVariantsBySet(setIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (setIds.length === 0) return map;
    const rows = await this.prisma.$queryRaw<{ setId: string; variantCount: bigint }[]>(Prisma.sql`
      SELECT "setId" AS "setId",
             SUM(COALESCE(array_length("availableFinishes", 1), 1))::bigint AS "variantCount"
      FROM "Card"
      WHERE "setId" IN (${Prisma.join(setIds)})
      GROUP BY "setId"
    `);
    for (const r of rows) map.set(r.setId, Number(r.variantCount));
    return map;
  }

  /**
   * UNA agregación cruzada `InventoryItem ⋈ Card` (raw SQL) por SCOPE → piezas totales + cartas
   * distintas + VARIANTES distintas del universo (v1.20: solo cuentan las (cardId, finish) cuyo
   * finish ∈ availableFinishes; array vacío → universo ['normal']; el drift queda fuera del
   * numerador). 1 query por request (no por set). Vacío → Map vacío.
   */
  private async aggregateInventoryBySet(
    setIds: string[],
    scope: MasterSetQueryScope,
  ): Promise<Map<string, { pieces: number; distinctCards: number; distinctVariants: number }>> {
    const map = new Map<
      string,
      { pieces: number; distinctCards: number; distinctVariants: number }
    >();
    if (setIds.length === 0) return map;
    const rows = await this.prisma.$queryRaw<
      { setId: string; pieces: bigint; distinctCards: bigint; distinctVariants: bigint }[]
    >(Prisma.sql`
      SELECT c."setId" AS "setId",
             COUNT(*)::bigint AS pieces,
             COUNT(DISTINCT ii."cardId")::bigint AS "distinctCards",
             COUNT(DISTINCT CASE
               WHEN ii."finish" = ANY(c."availableFinishes")
                 OR (COALESCE(array_length(c."availableFinishes", 1), 0) = 0
                     AND ii."finish" = 'normal')
               THEN ii."cardId" || '|' || ii."finish"::text
             END)::bigint AS "distinctVariants"
      FROM "InventoryItem" ii
      JOIN "Card" c ON c.id = ii."cardId"
      WHERE ${this.scopeSql(scope)}
        -- [BE-46] Lista on-hand interpolada desde NOT_ON_HAND (fuente única de verdad, misma que
        -- scopeWhere/admin-vaults); el ::text castea el enum para comparar con los parámetros.
        AND ii.status::text NOT IN (${Prisma.join(NOT_ON_HAND)})
        -- v1.42 (BLOQ-3, 4.20b): el binder cuenta SOLO SINGLES -> excluye productType='sealed' de piezas/
        -- cartas/variantes distintas. graded SIGUE contando (copia real del single). El sellado vive en su
        -- pestana dedicada (sealed-sets); catalogCardCount (denominador) NO cambia (no se toca aqui).
        AND ii."productType"::text <> 'sealed'
        AND c."setId" IN (${Prisma.join(setIds)})
      GROUP BY c."setId"
    `);
    for (const r of rows) {
      map.set(r.setId, {
        pieces: Number(r.pieces),
        distinctCards: Number(r.distinctCards),
        distinctVariants: Number(r.distinctVariants),
      });
    }
    return map;
  }

  /**
   * Binder del set por SCOPE: una celda por Card del catálogo del set, en ORDEN NATURAL por número,
   * con `variants[]` (v1.20, universo = availableFinishes). SIN N+1: (1) Card WHERE setId; (2) UNA
   * agregación `groupBy [cardId, finish]` de piezas del scope → countsByFinish; (3) si la vista es
   * la del cliente (`includeBuyable`), UNA resolución en lote de faltantes comprables. Los filtros
   * locales (rareza/acabado/faltantes/secret) los aplica el frontend. 404 si no existe el set.
   * `:setId` = id LOCAL del CardSet. El binder de `user_vault` funciona para CUALQUIER set del
   * catálogo (las celdas/variantes sin piezas son los faltantes del usuario).
   */
  async binder(
    setId: string,
    scope: MasterSetQueryScope = { kind: 'platform' },
    opts: MasterSetViewOptions = {},
  ): Promise<MasterSetBinderResponse> {
    const set = await this.prisma.cardSet.findUnique({ where: { id: setId } });
    if (!set) throw BusinessException.notFound();

    const owner = await this.resolveOwner(scope, opts);

    // v1.33 (P-27, §4.31b): FAN-IN del master set combinado. `resolveMasterSet` devuelve las partes
    // importadas (principal + subsets) en orden de bloque, o `null` para un set normal (v1.20 intacto).
    // El fan-in vive SOLO aquí (read model único §4.20): M1, bóveda del cliente y admin-bóveda lo
    // heredan sin código extra. Money-safe: cada `Card` conserva su `setId` real; el `groupBy` de
    // piezas y `scopeWhere` siguen filtrando por `cardId` (nada re-llaveado).
    const combined = await this.resolveMasterSet(set);
    const partSetIds = combined ? combined.partSetIds : [setId];
    // Mapa parte → { order de bloque, label } para etiquetar cada celda y ordenar por bloque.
    const partInfo = new Map<string, { order: number; label: string }>(
      combined ? combined.parts.map((p) => [p.setId, { order: p.order, label: p.label }]) : [],
    );

    const cards = await this.prisma.card.findMany({
      // v1.33 (P-27): `setId IN partSetIds` (una sola parte para un set normal → idéntico a v1.20).
      where: { setId: { in: partSetIds } },
      select: {
        id: true,
        setId: true,
        number: true,
        name: true,
        rarity: true,
        // v2.0 (§4.36.5): la rareza CANÓNICA alimenta el veredicto del guardarraíl (`premiumAtFloor`
        // del binder). No entra al monto — solo decide publicar/no publicar (criterio 84).
        rarityCanonical: true,
        imageSmallUrl: true,
        availableFinishes: true,
        // v1.22 (M-26): se LEEN de la columna; ya no se derivan en memoria (ARCHITECTURE 4.22b).
        numberSort: true,
        numberPrefix: true,
      },
      // v1.22: el ORDEN NATURAL lo aplica la BASE DE DATOS con el mismo `orderBy` normativo de
      // `GET /buylist/cards?setId=` (indice `(setId, numberPrefix, numberSort)`), en vez del
      // `.sort(compareByNumber)` en memoria. UN solo algoritmo, una sola fuente del orden.
      orderBy: CARD_ORDER_BY_IN_SET,
    });
    // v1.33 (P-27, §4.31b, D4): orden por BLOQUE — principal primero, luego cada subset en su `order`;
    // DENTRO del bloque el orden natural ya viene de la BD. `Array.sort` es estable → preserva el
    // orden intra-bloque. No-op para un set normal (una sola parte, order 0). El separador por
    // `partSetId` desambigua dos "#20" de partes distintas (§4.31f).
    if (combined) {
      cards.sort(
        (a, b) => (partInfo.get(a.setId)?.order ?? 0) - (partInfo.get(b.setId)?.order ?? 0),
      );
    }
    const cardIds = cards.map((c) => c.id);

    const grouped = cardIds.length
      ? await this.prisma.inventoryItem.groupBy({
          by: ['cardId', 'finish'],
          // v1.42 (BLOQ-3, §4.20b): countsByFinish/totalCount cuentan SOLO SINGLES — un ETB sellado anclado
          // a esta carta ya NO la infla como `finish=normal`. `graded` sigue contando. Sellado → pestaña
          // dedicada. El filtro va aquí (no en scopeWhere, usado por otras rutas) para no cambiar otros scopes.
          where: { cardId: { in: cardIds }, productType: { not: 'sealed' }, ...this.scopeWhere(scope) },
          _count: { _all: true },
        })
      : [];

    const countsByCard = new Map<string, { finish: Finish; count: number }[]>();
    for (const g of grouped) {
      const list = countsByCard.get(g.cardId) ?? [];
      list.push({ finish: g.finish, count: g._count._all });
      countsByCard.set(g.cardId, list);
    }

    // v1.22-2 / N-15 (§4.22a-6): acabados priceados por carta EN LOTE (sin N+1) para displayFinishes.
    const pricedByCard = await this.pricing.getPricedRawFinishesBatch(cardIds);

    // v1.27 (P-15, §4.25b): referencia de MERCADO POR VARIANTE en lote (sin N+1). El lote se expande
    // de (1 clave por carta, acabado base — v1.26) a (carta × acabado del universo expectedFinishes):
    // `getReferencesBatch` ya acepta lista y sigue siendo UNA query. raw:NM = la referencia de
    // MERCADO cruda; `getReferencesBatch` YA aplica `liveMxnCents` (FX-recompute a MXN vigente) y
    // devuelve `capturedDate` (decoración de frescura).
    const universeKeys = cards.flatMap((c) =>
      expectedFinishes(c.availableFinishes as Finish[]).map((finish) => ({
        cardId: c.id,
        productType: 'raw' as ProductType,
        gradeKey: 'raw:NM',
        finish,
      })),
    );
    const marketRefs = await this.pricing.getReferencesBatch(universeKeys);

    // v1.29 (§4.27i): productos SEPARADOS (deck_exclusive/promo) por carta EN LOTE (sin N+1), con su
    // precio por variante. Se exponen aparte de la carta de set (no fusionan acabados, §4.27e).
    const separateByCard = await this.pricing.getSeparateProductsByCard(cardIds);

    // v1.28 (P-18, §4.26b): la CONSOLA `pricing?` por variante — SOLO scope `platform` (M1). Reglas
    // de compra/venta izadas UNA vez + overrides M-30 en UNA query (mismo lote del universo); la
    // referencia reusa `marketRefs` (mismo batch). En scopes de cliente NO se computa ni viaja.
    const includePricing = scope.kind === 'platform';
    // v2.0 (P-48, §4.36.2): UNA curva izada una vez por request, compartida por los dos ejes.
    const pricingCurve = includePricing ? await this.pricing.loadPricingCurve() : null;
    const variantOverrides = includePricing
      ? await this.pricing.getVariantOverridesBatch(universeKeys)
      : new Map<string, never>();

    // v1.33 (P-27, §4.31b, D5/CA-67): `printedTotal` = Σ de las partes en un master combinado
    // (Celebrations 25 + 25 = 50); en un set normal = su propio `printedTotal` (v1.20 intacto).
    const printedTotal = combined
      ? combined.parts.reduce<number | null>(
          (acc, p) => (p.printedTotal == null ? acc : (acc ?? 0) + p.printedTotal),
          null,
        )
      : (set.printedTotal ?? null);
    const cells: MasterSetCardCellDTO[] = cards
      .map((c) => {
        const byFinish = (countsByCard.get(c.id) ?? []).sort((a, b) =>
          a.finish < b.finish ? -1 : a.finish > b.finish ? 1 : 0,
        );
        const totalCount = byFinish.reduce((s, x) => s + x.count, 0);
        // v1.20 — universo de variantes esperado (histórico → ['normal']). El drift (piezas con
        // finish FUERA del universo) queda visible en countsByFinish pero no en variants/covered.
        const universe = expectedFinishes(c.availableFinishes as Finish[]);
        // v1.29 (§4.27c): la supresión heurística N-15 quedó DEROGADA. `computeDisplayFinishes` es hoy
        // un shim PURO (`displayFinishes := availableFinishes`, sin filtrar por rareza/premium): ya no
        // hay casilla espuria que ocultar porque `availableFinishes` se deriva EXACTO de CardProduct.
        // Se conserva la llamada solo por el contrato del DTO (retiro del campo pendiente en front).
        // `displayed` marca por variante si el front la PINTA; la completitud (expected/covered) cuenta
        // sobre el universo `availableFinishes`, sin cambio.
        const displayFinishes = computeDisplayFinishes(
          c.rarity,
          c.availableFinishes as Finish[],
          pricedByCard.get(c.id) ?? [],
        );
        const displaySet = new Set<Finish>(displayFinishes);
        // v1.27 (P-15): cada variante lleva SU propia referencia de mercado (clave por finish del
        // lote expandido). null = pending/ausente (nunca un 0 inventado); `capturedDate` solo con precio.
        const variants: MasterSetVariantDTO[] = universe.map((finish) => {
          const count = byFinish.find((x) => x.finish === finish)?.count ?? 0;
          const mref = marketRefs.get(`${c.id}|raw|raw:NM|${finish}`);
          const marketReferenceMxnCents =
            mref && mref.status === 'priced' ? (mref.referenceMxnCents ?? null) : null;
          return {
            finish,
            count,
            covered: count > 0,
            displayed: displaySet.has(finish),
            marketReferenceMxnCents,
            ...(marketReferenceMxnCents != null && mref?.capturedDate != null
              ? { capturedDate: mref.capturedDate }
              : {}),
            // v1.28 (P-18): consola de tres precios — SOLO scope platform (regla dura §4.26b).
            ...(pricingCurve
              ? {
                  pricing: composeVariantPricing(
                    marketReferenceMxnCents,
                    pricingCurve,
                    variantOverrides.get(`${c.id}|raw|raw:NM|${finish}`) ?? null,
                    // v2.0 (§4.36.5): la rareza SOLO para el veredicto del guardarraíl (`premiumAtFloor`).
                    c.rarityCanonical ?? c.rarity,
                  ),
                }
              : {}),
          };
        });
        // v1.27 (P-15): el campo de CELDA queda DEPRECADO — se emite como ESPEJO de la variante del
        // acabado base (`variants[0]` = universe[0]), costo cero (mismo batch). Retiro en la
        // siguiente rev de contrato; el front debe leer la variante.
        const marketReferenceMxnCents = variants[0]?.marketReferenceMxnCents ?? null;
        return {
          cardId: c.id,
          number: c.number,
          numberSort: c.numberSort,
          numberPrefix: c.numberPrefix,
          name: c.name,
          rarity: c.rarity ?? undefined,
          imageSmallUrl: c.imageSmallUrl ?? undefined,
          availableFinishes: (c.availableFinishes ?? ['normal']) as Finish[],
          displayFinishes,
          countsByFinish: byFinish,
          totalCount,
          // isSecretRare — heurística de DISPLAY (API_CONTRACT §M1 v1.16.1 / ARCHITECTURE §4.17a,
          // BE-36). Secret rare REAL = numeración PRINCIPAL (número puramente numérico, sin prefijo
          // alfabético) con entero > printedTotal. Los promos/subsets (TG/GG/SV, con prefijo) NO
          // cuentan aunque su `numberSort` (PROMO_SORT_BASE + n) supere printedTotal; printedTotal
          // nulo → false.
          // v1.22: mismas dos claves, leidas de las COLUMNAS (para un numero puro `numberSort` ES
          // el entero, asi que la heuristica no cambia de semantica).
          isSecretRare: printedTotal != null && c.numberPrefix === '' && c.numberSort > printedTotal,
          expectedVariantCount: universe.length,
          coveredVariantCount: variants.filter((v) => v.covered).length,
          variants,
          marketReferenceMxnCents,
          // v1.29 (§4.27i): SOLO si la carta tiene productos separados (el caso común: ausente).
          ...(separateByCard.has(c.id)
            ? {
                separateProducts: separateByCard.get(c.id)!.map((p) => ({
                  productId: p.productId,
                  kind: p.kind,
                  name: p.name,
                  finishes: p.finishes,
                  prices: p.prices.map((pr) => ({
                    finish: pr.finish,
                    marketReferenceMxnCents: pr.marketReferenceMxnCents,
                    ...(pr.capturedDate != null ? { capturedDate: pr.capturedDate } : {}),
                  })),
                })),
              }
            : {}),
          // v1.33 (P-27, §4.31b): a qué PARTE real pertenece la celda + etiqueta del bloque. SOLO en un
          // master combinado; el front agrupa por `partSetId` y pinta el separador con `partLabel`.
          ...(combined
            ? { partSetId: c.setId, partLabel: partInfo.get(c.setId)?.label }
            : {}),
        };
      });

    // v1.20 §4.20d — faltantes comprables, SOLO vista (iii) del cliente: para cada variante
    // covered=false, la pieza `listed` de plataforma MÁS BARATA de ese (cardId, finish), o null.
    if (opts.includeBuyable) {
      const missing: { cardId: string; finish: Finish }[] = [];
      for (const cell of cells) {
        for (const v of cell.variants) {
          if (!v.covered) missing.push({ cardId: cell.cardId, finish: v.finish });
        }
      }
      const buyables = await this.resolveBuyables(missing);
      for (const cell of cells) {
        cell.variants = cell.variants.map((v) =>
          v.covered ? v : { ...v, buyable: buyables.get(`${cell.cardId}|${v.finish}`) ?? null },
        );
      }
    }

    // v1.33 (P-27, §4.31b, D4): en un master combinado `set` = el PRINCIPAL (nombre del master); en un
    // set normal = el propio set (v1.20 intacto). `catalogCardCount` = cards.length ya es Σ de partes.
    const setRef = combined ? combined.primary : set;
    const partsDTO: SetPartDTO[] | undefined = combined
      ? combined.parts.map((p) => ({
          setId: p.setId,
          name: p.name,
          label: p.label,
          isPrimary: p.isPrimary,
          order: p.order,
          catalogCardCount: cards.filter((c) => c.setId === p.setId).length,
        }))
      : undefined;

    return {
      set: {
        id: setRef.id,
        name: setRef.name,
        series: setRef.series ?? undefined,
        releaseDate: setRef.releaseDate ?? undefined,
      },
      printedTotal,
      catalogCardCount: cards.length,
      cells,
      scope: scope.kind,
      ...(owner ? { owner } : {}),
      // v1.33 (P-27, §4.31b): master set combinado — desglose de partes + normalización del subset.
      ...(partsDTO ? { parts: partsDTO } : {}),
      ...(combined?.canonicalSetId ? { canonicalSetId: combined.canonicalSetId } : {}),
    };
  }

  /**
   * v1.20 §4.20d — resuelve en LOTE la pieza `listed` de plataforma MÁS BARATA por (cardId, finish)
   * para las variantes faltantes del binder del cliente. Precio con el MISMO criterio de la ficha
   * (§4.9): `listPriceCents` override manual POR PIEZA, o derivado server-side (SEC-A1) por el SEAM
   * ÚNICO del eje de venta (`pricing.decideSalePrice`, v2.0 §4.36.5b) sobre el valor de mercado.
   * SIN N+1: 1 findMany de listadas + curva izada UNA vez + 1 lote de referencias + 1 lote de overrides.
   * El binder NO crea órdenes ni reservas: el CTA lleva a la ficha/checkout normal.
   *
   * v2.0 (P-48, gate techlead) — el binder pasa por el MISMO seam que el storefront y el checkout, así
   * que hereda el GUARDARRAÍL: una premium cuyo precio aterriza en el piso deja de ofrecerse como
   * `buyable` aquí igual que deja de publicarse allá. Antes este call site calculaba el monto con la
   * función pura y se saltaba el veredicto: el binder ofrecía a MX$25 —con CTA a un checkout que
   * respondía `PRICE_PENDING`— justo la carta que el storefront ya ocultaba. Dos superficies de la
   * MISMA decisión de dinero discrepando; por eso el veredicto ya no es opcional en la firma.
   */
  private async resolveBuyables(
    pairs: { cardId: string; finish: Finish }[],
  ): Promise<Map<string, { inventoryItemId: string; salePriceCents: number }>> {
    const map = new Map<string, { inventoryItemId: string; salePriceCents: number }>();
    if (pairs.length === 0) return map;
    const wanted = new Set(pairs.map((p) => `${p.cardId}|${p.finish}`));
    const listed = await this.prisma.inventoryItem.findMany({
      where: {
        ownerType: 'platform',
        status: 'listed',
        // v1.42 (BLOQ-3b, §4.20d): `buyable` resuelve SOLO SINGLES — ya no ofrece un ETB sellado para
        // llenar la casilla de un single (mata «Tropius» en el faltante). `graded` sigue siendo buyable.
        // SEC-A1 intacto: solo cambia QUÉ piezas son elegibles; salePriceCents sigue server-side.
        productType: { not: 'sealed' },
        cardId: { in: [...new Set(pairs.map((p) => p.cardId))] },
      },
      include: { card: true },
    });
    const candidates = listed.filter((i) => wanted.has(`${i.cardId}|${i.finish}`));
    if (candidates.length === 0) return map;

    const curve = await this.pricing.loadPricingCurve();
    const derivableKeys = candidates
      // H-1 (E5-bis): `<= 0` es AUSENTE ⇒ esas piezas también derivan precio.
      .filter((i) => !hasManualPrice(i))
      .map((i) => ({
        cardId: i.cardId,
        productType: i.productType,
        gradeKey: this.pricing.gradeKeyFor(i),
        finish: i.finish,
      }));
    const refs = await this.pricing.getReferencesBatch(derivableKeys);
    // v1.28 (P-18, §4.26b) · v2.0 (§4.36): el `buyable` del binder cobra EXACTAMENTE lo que el
    // storefront — misma CURVA, mismo sellOverride de variante (mismo cuerpo único; lote sin N+1).
    const variantOverrides = await this.pricing.getVariantOverridesBatch(derivableKeys);

    for (const item of candidates) {
      let salePriceCents: number | null;
      if (hasManualPrice(item)) {
        salePriceCents = item.listPriceCents; // override manual POR PIEZA gana siempre (§4.9/§4.26b)
      } else {
        const gradeKey = this.pricing.gradeKeyFor(item);
        const key = `${item.cardId}|${item.productType}|${gradeKey}|${item.finish}`;
        const ref = refs.get(key);
        const refCents = ref && ref.status === 'priced' ? (ref.referenceMxnCents ?? null) : null;
        // SEAM ÚNICO (§4.36.5b): monto + veredicto juntos. Una variante bloqueada por el guardarraíl
        // vuelve con `priceCents=null` y cae en el `continue` de abajo — NO se ofrece como buyable.
        salePriceCents = this.pricing.decideSalePrice({
          referenceMxnCents: refCents,
          // SOLO para el veredicto (criterio 84): no entra al monto.
          rarityCanonical: item.card.rarityCanonical ?? item.card.rarity,
          controls: variantOverrides.get(key) ?? null,
          curve,
        }).priceCents;
      }
      // Sin precio resoluble (>0) → no comprable (paridad con `sellable` de la ficha §4.9).
      if (salePriceCents == null || salePriceCents <= 0) continue;
      const key = `${item.cardId}|${item.finish}`;
      const prev = map.get(key);
      if (!prev || salePriceCents < prev.salePriceCents) {
        map.set(key, { inventoryItemId: item.id, salePriceCents });
      }
    }
    return map;
  }
}
