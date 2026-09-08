import { Injectable } from '@nestjs/common';
import { Card, CardSet, Finish, Prisma, VariantPriceOverride } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { variantKey } from '../../common/variant-key';
import { PricingService } from './pricing.service';
import { VariantPricingDTO, composeVariantPricing } from './variant-pricing';
import { BOUNTY_SCOPE_WHERE, BountyState, deriveBountyState } from './bounty-state';
import { BountyProgress, bountyProgress } from './bounty-progress';

/**
 * admin-bounties.service.ts — v1.62/v1.62.1 · **CONSOLA DE BOUNTIES**
 * (`GET /api/v1/admin/pricing/bounties`, `super_admin`, **READ-ONLY**).
 * Contrato: `API_CONTRACT §M2-B.0/.1`. Diseño: `ARCHITECTURE §4.42`. Alcance: `PROJECT` criterio 184
 * (D52) — **ver + editar fila a fila**; la edición **no vive aquí** (§M2-B.2: reusa entero el
 * `PUT /admin/pricing/variant-controls/:cardId/:finish`, cero superficie de escritura nueva).
 *
 * ### Por qué existe (§4.42a, y es lo único que hay que entender)
 * Un bounty por debajo —o igual— de la tarifa vigente **deja de ser bounty**: no se paga, no se
 * publica en `GET /buylist/bounties` y las dos vitrinas que lo pintaban **desaparecen enteras** si no
 * hay bounties efectivos. Resultado: ese bounty es **invisible en todas partes** salvo en la casilla
 * del binder de su set, y el dueño **cree estar pagando un precio que no paga**. Esta lectura cura esa
 * ceguera; **todo lo demás de este archivo es secundario a eso**.
 *
 * ### Una lectura que COMPONE, no que calcula (§4.42b)
 * Ninguna cifra de dinero nace aquí. Se iza el **mismo trío en lote** que ya usan el binder y la
 * vitrina (`loadPricingCurve` + `getReferencesBatch` + la fila M-30) y cada renglón se compone con
 * **`composeVariantPricing`**, el mismo composer del binder ⇒ la consola, el binder, el drawer y la
 * vitrina **no pueden discrepar**. De ahí salen, **sin un solo campo nuevo**, las tres cifras que el
 * dueño pidió por fila: el precio del bounty (`pricing.bounty.priceCents`), la tarifa vigente contra
 * la que se compara (`pricing.bounty.curveQuoteCents`) y el veredicto (`pricing.bounty.effective`).
 *
 * ### SEC-A1 (§4.42f)
 * Lo que manda el cliente son **filtros y paginación**: entra a un `where` y a un `slice`, **jamás a
 * una fórmula**. `curveQuoteCents`, `suggestedCents`, `effective`, `state`, `progress` y
 * `remainingQty` son **salida, nunca entrada**.
 *
 * ⛔ **READ-ONLY estricto**: no persiste, no resuelve pendientes, no apaga nada, no mueve dinero y
 * **no audita** (una lectura no es un acto auditable; el gate de auditoría es de la escritura).
 */

/** `sort` del contrato. `attention_first` es el DEFAULT a propósito (decisión de producto, §M2-B.1). */
export const ADMIN_BOUNTY_SORT_VALUES = ['attention_first', 'price_desc', 'updated_desc'] as const;
export type AdminBountySort = (typeof ADMIN_BOUNTY_SORT_VALUES)[number];

/**
 * **TECHO DE SERVIDOR — constante de código, NO un dial** (§M2-B.1: *«el contrato norma la conducta
 * —que la incompletitud se DECLARE— no el número»*).
 *
 * Existe porque **el `state` no se puede calcular en SQL** (depende de la curva y de la referencia de
 * mercado, que se izan en lote en la aplicación): hay que traer el conjunto **entero** para poder
 * clasificarlo, y una lectura sin cota es superficie de abuso. Cuando el conjunto lo supera, la
 * respuesta **declara** su incompletitud (`truncated: true`) en vez de callarla — y ese `truncated`
 * gobierna **`data`, `total` y `counts` a la vez**.
 */
export const ADMIN_BOUNTY_SERVER_CAP = 1000;

/** `AdminBountyCountsDTO` — las CINCO claves del enum `state`, enteros ≥ 0 (§M2-B.1). */
export type AdminBountyCountsDTO = Record<BountyState, number>;

/** `AdminBountyRowDTO` (§M2-B.1). `pricing` es el `VariantPricingDTO` COMPLETO y sin recortar. */
export interface AdminBountyRowDTO {
  cardId: string;
  setId: string;
  setName: string;
  name: string;
  number: string;
  imageSmallUrl?: string;
  rarity?: string;
  productType: 'raw';
  gradeKey: 'raw:NM';
  finish: Finish;
  state: BountyState;
  progress: BountyProgress;
  updatedAt: string;
  updatedBy?: string;
  pricing: VariantPricingDTO;
}

/** `AdminBountyListResponse` (§M2-B.1). */
export interface AdminBountyListResponse {
  data: AdminBountyRowDTO[];
  page: number;
  pageSize: number;
  total: number;
  counts: AdminBountyCountsDTO;
  truncated: boolean;
}

/** Parámetros YA validados por el controller (el borde HTTP es quien responde `400`). */
export interface AdminBountyListParams {
  /** Repetible; omitido ⇒ **todos**. Nunca vacío: el controller lo deja `undefined` si no vino. */
  states?: BountyState[];
  setId?: string;
  finish?: Finish;
  q?: string;
  page: number;
  pageSize: number;
  sort: AdminBountySort;
}

/** Fila M-30 con la carta y su set (lo que el DTO necesita para la identidad del renglón). */
type ScopedRow = VariantPriceOverride & { card: Card & { set: CardSet } };

/** Renglón ya CLASIFICADO: la fila, su `VariantPricingDTO` compuesto y su `state` derivado. */
interface ClassifiedRow {
  row: ScopedRow;
  pricing: VariantPricingDTO;
  state: BountyState;
}

/**
 * `attention_first` — **lo que está costando dinero en silencio, primero.** `rebasada` e `invalida`
 * comparten el primer grupo (las dos son «encendido que no paga lo que el dueño cree»); después
 * `activa`, después `completada` y al final `apagada`. Un listado de dinero ordenado por conveniencia
 * técnica entierra el hallazgo en la página 3.
 */
const ATTENTION_RANK: Record<BountyState, number> = {
  rebasada: 0,
  invalida: 0,
  activa: 1,
  completada: 2,
  apagada: 3,
};

@Injectable()
export class AdminBountiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * ### ⚠️⚠️ ORDEN DE OPERACIONES NORMATIVO (§M2-B.1, bullet de `truncated`) — se sigue AL PIE
   *
   * ```
   * seleccionar (alcance §M2-B.0 + filtros de IDENTIDAD; el TECHO se aplica AQUÍ y solo aquí
   *   ⇒ `truncated`) → resolver el estado de TODO lo seleccionado → CONTAR (`counts`)
   *   → filtrar por `state` → ordenar → paginar
   * ```
   *
   * ⛔ **Prohibido paginar o cortar ANTES de clasificar**: cortar primero es exactamente cómo un
   * `rebasada` volvería a desaparecer, ahora en la pantalla que se construyó para verlo (mismo orden
   * que ya norma `publicBounties`: *«filtrar DESPUÉS del cap dejaría huecos silenciosos»*).
   */
  async list(params: AdminBountyListParams): Promise<AdminBountyListResponse> {
    // ---- 1. SELECCIONAR: alcance + identidad. El techo se aplica aquí y SOLO aquí. -------------
    const selected = await this.prisma.variantPriceOverride.findMany({
      where: this.buildWhere(params),
      // Orden del CORTE (no es el orden de la respuesta, que se decide tras clasificar). Cuando el
      // conjunto rebasa el techo, lo que sobrevive es lo que **sigue encendido** —lo que puede estar
      // costando dinero— y no la historia ya apagada. Determinista (`id` desempata) para que dos
      // llamadas idénticas corten por el mismo sitio.
      orderBy: [{ bountyEnabled: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }],
      // +1 SOLO para DETECTAR el rebase; la fila extra nunca se clasifica ni se cuenta.
      take: ADMIN_BOUNTY_SERVER_CAP + 1,
      include: { card: { include: { set: true } } },
    });
    const truncated = selected.length > ADMIN_BOUNTY_SERVER_CAP;
    const inScope = truncated ? selected.slice(0, ADMIN_BOUNTY_SERVER_CAP) : selected;

    // ---- 2. RESOLVER EL ESTADO DE TODO LO SELECCIONADO ------------------------------------------
    const classified = await this.classify(inScope);

    // ---- 3. CONTAR (§M2-B.1 regla 3: MISMA pasada de clasificación, jamás un `groupBy` de SQL) --
    const counts = this.countByState(classified);

    // ---- 4. FILTRAR POR `state` (después de contar: los conteos IGNORAN este filtro, regla 2) ---
    const filtered = params.states
      ? classified.filter((c) => params.states!.includes(c.state))
      : classified;

    // ---- 5. ORDENAR + 6. PAGINAR ----------------------------------------------------------------
    const ordered = [...filtered].sort(this.comparator(params.sort));
    const start = (params.page - 1) * params.pageSize;
    const pageRows = ordered.slice(start, start + params.pageSize);

    return {
      data: pageRows.map((c) => this.toRowDTO(c)),
      page: params.page,
      pageSize: params.pageSize,
      // `total` obedece a TODOS los filtros (es el tamaño del conjunto que se está paginando);
      // `counts` NO obedece a `state`. Invariante verificable con `state` omitido:
      // `total == counts.activa + counts.rebasada + counts.invalida + counts.completada + counts.apagada`.
      total: filtered.length,
      counts,
      // Gobierna `data`, `total` Y `counts`: con `truncated: true` los conteos **también** están
      // incompletos. *Un cero de una lista cortada no es un cero* — el frontend no puede enunciar
      // ahí el cero tranquilizador (§M2-B.1 regla 4).
      truncated,
    };
  }

  /**
   * `where` = **alcance** (historia de bounty) + **identidad** (`setId`, `finish`, `q`). Nada más:
   * el `state` NO es filtrable en SQL —no es calculable en SQL— y por eso se aplica en memoria,
   * después de clasificar.
   *
   * `productType`/`gradeKey` fijos a `raw`/`raw:NM`: el bounty es **raw-only** por la escritura
   * (`variant-controls`, §4.26a) y el DTO del contrato los declara literales. Es defensa en
   * profundidad, igual que en la vitrina pública, no un predicado nuevo.
   */
  private buildWhere(params: AdminBountyListParams): Prisma.VariantPriceOverrideWhereInput {
    const card: Prisma.CardWhereInput = {};
    if (params.setId !== undefined) card.setId = params.setId;
    if (params.q !== undefined) {
      // Convención transversal de filtros de lista admin: `contains`, case-insensitive, OR entre los
      // campos que el endpoint declara — aquí **nombre o número** de la carta (§M2-B.1).
      card.OR = [
        { name: { contains: params.q, mode: 'insensitive' } },
        { number: { contains: params.q, mode: 'insensitive' } },
      ];
    }
    return {
      productType: 'raw',
      gradeKey: 'raw:NM',
      ...(params.finish !== undefined ? { finish: params.finish } : {}),
      ...(Object.keys(card).length > 0 ? { card } : {}),
      // `AND` para no pisar el `OR` de `q`: el alcance y la búsqueda son dos `OR` distintos.
      AND: [BOUNTY_SCOPE_WHERE],
    };
  }

  /**
   * Izado EN LOTE (una lectura de curva + una de referencias) y composición por variante con el
   * **mismo** cuerpo que el binder. Sin N+1 y sin una segunda proyección del mismo dinero.
   */
  private async classify(rows: ScopedRow[]): Promise<ClassifiedRow[]> {
    if (rows.length === 0) return [];
    const curve = await this.pricing.loadPricingCurve();
    const refs = await this.pricing.getReferencesBatch(
      rows.map((r) => ({
        cardId: r.cardId,
        productType: r.productType,
        gradeKey: r.gradeKey,
        finish: r.finish,
      })),
    );
    return rows.map((row) => {
      // P-30 H2: misma fuente de clave que el PRODUCTOR del map (`getReferencesBatch`).
      const ref = refs.get(
        variantKey({
          cardId: row.cardId,
          productType: row.productType,
          gradeKey: row.gradeKey,
          finish: row.finish,
        }),
      );
      const referenceMxnCents =
        ref && ref.status === 'priced' ? (ref.referenceMxnCents ?? null) : null;
      const pricing = composeVariantPricing(
        referenceMxnCents,
        curve,
        row,
        row.card.rarityCanonical ?? row.card.rarity,
      );
      // El composer incluye SIEMPRE el bloque `bounty` cuando hay fila M-30, y aquí SIEMPRE la hay
      // (el predicado de alcance selecciona filas M-30). Si algún día dejara de cumplirlo, esto
      // revienta ruidosamente en vez de clasificar en silencio por el valor equivocado.
      const bounty = pricing.bounty as NonNullable<VariantPricingDTO['bounty']>;
      return { row, pricing, state: deriveBountyState(bounty) };
    });
  }

  /**
   * `counts` sobre **el conjunto clasificado**, jamás sobre la página (§M2-B.1). Sale de la MISMA
   * pasada: un `groupBy` de SQL sería **otro predicado con otro resultado** —el estado no es
   * calculable en SQL—, es decir dos proyecciones del mismo dinero.
   *
   * Las cinco claves se inicializan en `0` **siempre**: el panel **enuncia el cero** (inversión
   * deliberada de la vitrina, que calla cuando no hay nada), así que una clave ausente no es una
   * opción. Y **`invalida` tiene la suya**: fundirla dentro de `activa` pintaría *«está pagando»*
   * sobre un bounty encendido sin precio utilizable.
   */
  private countByState(classified: ClassifiedRow[]): AdminBountyCountsDTO {
    const counts: AdminBountyCountsDTO = {
      activa: 0,
      rebasada: 0,
      invalida: 0,
      completada: 0,
      apagada: 0,
    };
    for (const c of classified) counts[c.state] += 1;
    return counts;
  }

  /**
   * Los tres órdenes del contrato. Todos terminan en `id` asc para que el orden sea **total** y la
   * paginación **estable** (dos filas empatadas en todo lo demás no pueden bailar entre páginas).
   *
   * - `attention_first` (**default**): grupo de atención, luego `bountyPriceCents` **desc**
   *   (espejo de la vitrina), desempate `updatedAt` desc.
   * - `price_desc`: espejo EXACTO del orden de `GET /buylist/bounties` (precio desc, `updatedAt` desc).
   * - `updated_desc`: lo último tocado primero.
   *
   * Un `bountyPriceCents` nulo (solo lo tiene `invalida`, y filas de pura historia) ordena **al
   * final** de su grupo: `null` no es «gratis», es «sin precio», y no puede ganarle a una cifra.
   */
  private comparator(sort: AdminBountySort): (a: ClassifiedRow, b: ClassifiedRow) => number {
    const price = (c: ClassifiedRow) => c.row.bountyPriceCents ?? -1;
    const updated = (c: ClassifiedRow) => c.row.updatedAt.getTime();
    const byId = (a: ClassifiedRow, b: ClassifiedRow) => (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0);
    if (sort === 'updated_desc') {
      return (a, b) => updated(b) - updated(a) || byId(a, b);
    }
    if (sort === 'price_desc') {
      return (a, b) => price(b) - price(a) || updated(b) - updated(a) || byId(a, b);
    }
    return (a, b) =>
      ATTENTION_RANK[a.state] - ATTENTION_RANK[b.state] ||
      price(b) - price(a) ||
      updated(b) - updated(a) ||
      byId(a, b);
  }

  /** Proyección al DTO del contrato. Los opcionales AUSENTES no viajan (no se emiten como `null`). */
  private toRowDTO(c: ClassifiedRow): AdminBountyRowDTO {
    const { row, pricing, state } = c;
    return {
      cardId: row.cardId,
      setId: row.card.setId,
      setName: row.card.set.name,
      name: row.card.name,
      number: row.card.number,
      ...(row.card.imageSmallUrl ? { imageSmallUrl: row.card.imageSmallUrl } : {}),
      ...(row.card.rarity ? { rarity: row.card.rarity } : {}),
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: row.finish,
      // Lo deriva el SERVIDOR y **no es opcional**: la UI lo obedece, no lo infiere cruzando
      // `enabled`/`effective`/`completedAt` en pantalla (misma doctrina que `priceBasis`, §N.7).
      state,
      progress: bountyProgress(row.bountyTargetQty, row.bountyAcquiredQty),
      updatedAt: row.updatedAt.toISOString(),
      ...(row.updatedBy ? { updatedBy: row.updatedBy } : {}),
      // El `VariantPricingDTO` COMPLETO y sin recortar: ⛔ nada de un DTO «plano» de bounty, que
      // sería una segunda proyección de las mismas columnas — y dos proyecciones del mismo dinero
      // divergen (§0-B.1).
      pricing,
    };
  }
}
