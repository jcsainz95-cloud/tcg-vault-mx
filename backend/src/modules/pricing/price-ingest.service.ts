import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CardSet, Finish } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { MONEY_REF_WHERE, PricingService } from './pricing.service';
import { BulkFetchInput, BulkPriceProvider, BulkPriceRow, cardNumberVariants } from './pricing.types';
import {
  GradedFormat,
  PokemonPriceTrackerBulkProvider,
} from './providers/pokemonpricetracker-bulk.provider';
import { PokemonTcgIoBulkProvider } from './providers/pokemontcg-io-bulk.provider';
import { TcgcsvSinglesBulkPriceProvider } from './providers/tcgcsv-singles-bulk.provider';
import { orderFinishes } from '../../common/card-order';
// H-1 (§4.36.6): «presente ⇔ > 0» en UN solo predicado compartido.
import { hasManualPrice } from '../../common/money';
// v1.50.3 (§4.38m.2): la fecha de negocio del gate de EVIDENCIA — la MISMA que usa la lectura.
import { businessDateCdmx } from '../../common/graded-estimate';
import { FinishReconciler } from '../catalog/finish-reconciler.service';
import { PptSetMapper } from './ppt-set-mapper.service';
import { SetScope, classifySet, isModernSet, isPremiumRarity } from './ppt-sync-scope';
import { AuditService } from '../audit/audit.service';
import { GradedPhase2Verdict, gradedPhase2Verdict } from './graded-phase2-verdict';

/** InventoryStatus que NO cuentan como "activo" para el scope parcial (regla del PO: no withdrawn/lost). */
const INACTIVE_INVENTORY_STATUSES: ReadonlyArray<'withdrawn' | 'lost'> = ['withdrawn', 'lost'];

/**
 * v1.50.3-c (techlead + arquitecto, §4.38h.1-ter / GU-A25) — **TECHO del suelo de muestra** de la
 * escalada por shape. El suelo EFECTIVO de cada corrida es `min(este número, cartas en alcance)`.
 *
 * ### Por qué hay suelo
 * Sin él, `1 > 0` satisface la mayoría estricta y **una sola carta** escalaría a una decisión de
 * arquitectura y presupuesto. Con el alcance acotado por diseño (curaduría manual en fase 1 y
 * `graded_estimate_ingest_max_cards_per_run` por corrida), los denominadores diminutos son normales.
 *
 * ### Por qué es RELATIVO y no absoluto (la corrección del arquitecto)
 * Mi propuesta era un suelo absoluto de 5, y **tenía el mismo defecto que el `STALE` inalcanzable que
 * este mismo pase acababa de arreglar**: el alcance del ingest es «solo cartas con inventario
 * publicado» (§4.38h.3), así que **una tienda con 3 cartas publicadas nunca llegaría a 5** — si las 3
 * devolvieran S2, la fase 2 quedaría muerta **en silencio** y el detector diseñado para avisarlo estaría
 * apagado por construcción. Con `min(5, …)`, el 5 sigue gobernando la operación normal (catálogo real)
 * pero **pierde la capacidad de bloquear el aviso** justo donde más desapercibido pasaría.
 *
 * ### Lo que este número NO es
 * No busca significancia estadística —este job no muestrea, barre lo que hay—; solo descarta el ruido de
 * una o dos observaciones. Y **no gobierna la vía (A)** (`s1 == 0 && s2 >= 1`), que escala **sin suelo**
 * porque «nunca hemos visto un S1» es cualitativamente distinto de «vemos una mezcla».
 *
 * **Constante de código, NO dial** (§4.38h.1-ter): se calibra una vez, con datos reales, y no merece una
 * clave de `ConfigSetting` — mismo criterio que (k.1). La escalada es **señal, no fallo**: no aborta la
 * corrida ni apaga el ingest, así que un falso positivo cuesta una conversación.
 */
const GRADED_SHAPE_ESCALATION_MIN_CARDS = 5;

/**
 * v1.50.3-g (§4.38h.1-quater) — **tope de sets que la SONDA barre en una corrida.**
 *
 * La sonda contesta una pregunta de esquema («¿qué shape sirve PPT?»), no ingesta: la primera respuesta
 * con bloque PSA ya la contesta. El tope solo gobierna el caso en que NINGÚN set trae bloque, donde sí
 * conviene insistir un poco (un set sin ventas PSA es un estado normal) pero no barrer el catálogo
 * publicado entero a 2 créditos por carta. Constante de código y no dial: es un límite de GASTO de un
 * modo de diagnóstico, se calibra con la primera corrida real y su valor no cambia ninguna decisión de
 * dinero. Cuando aplica, se LOGUEA (un límite silencioso vuelve inexplicable un resultado parcial).
 */
const GRADED_PROBE_MAX_SETS = 3;

/** Scope resuelto de un set para la ingesta de PPT (+ cartas permitidas en el caso parcial). */
interface SetScopeInfo {
  scope: SetScope;
  /** cardIds permitidos en el caso `partial` (inventario activo ∪ rares). `null` en full/skip. */
  allowedCardIds: Set<string> | null;
}

/** Snapshot de FX cargado UNA vez por corrida (§4.15f), pasado a cada set. */
export type FxSnapshot = { rate: number; bufferPct: number };

/** v1.50.2 (§4.38h) — resultado de UNA corrida del ingest de estimados PSA. Todo es observabilidad. */
/**
 * BE-GE3 (v1.50.2) — índice EN MEMORIA de las cartas EN ALCANCE de un set, por los dos identificadores
 * que trae el proveedor. Reemplaza las 1-3 queries POR FILA que `resolveCardId` hacía dentro del bucle.
 */
interface GradedCardIndex {
  /** `Card.externalId` → `cardId` (clave PRIMARIA de resolución). */
  byExternalId: Map<string, string>;
  /** `Card.number` → `cardId[]` (fallback; una lista porque el número NO es único por construcción). */
  byNumber: Map<string, string[]>;
}

/**
 * Resuelve la fila del proveedor contra el índice del set. **Función pura** (por eso vive fuera de la
 * clase y recibe el logger como callback): su regla es exactamente la de `resolveCardId` —externalId
 * primero, número después, variantes del número al final— y así puede probarse sin BD.
 *
 * ⚠️ **Ambigüedad ⇒ se OMITE.** Si el número (o sus variantes) casa con más de una carta del set, no
 * se devuelve ninguna: escribir un precio en la carta equivocada es peor que no escribirlo.
 */
function resolveGradedCardId(
  index: GradedCardIndex,
  externalId: string | null | undefined,
  number: string | null | undefined,
  onAmbiguous: (number: string, matches: number) => void,
): string | null {
  if (externalId) {
    const byExt = index.byExternalId.get(externalId);
    if (byExt) return byExt;
  }
  if (number) {
    const exact = index.byNumber.get(number);
    if (exact?.length === 1) return exact[0];
    if (exact && exact.length > 1) {
      onAmbiguous(number, exact.length);
      return null;
    }
    const matches = new Set<string>();
    for (const v of cardNumberVariants(number)) {
      for (const id of index.byNumber.get(v) ?? []) matches.add(id);
    }
    if (matches.size === 1) return [...matches][0];
    if (matches.size > 1) onAmbiguous(number, matches.size);
  }
  return null;
}

export interface GradedIngestResult {
  /** ¿El dial `grading_hook_enabled` estaba `on` **y** la config del ingest era válida? (v1.51, M-46) */
  enabled: boolean;
  sets: number;
  cardsInScope: number;
  written: number;
  /** Filas NO escritas porque había override MANUAL del día (§O.6: el manual gana). */
  skippedManual: number;
  /** Saltadas por INV-D (§4.38l): hay slab PUBLICADO de ese grado ⇒ esa fila es dinero real. */
  skippedSlabPublished: number;
  /** Descartadas por `count < minSampleCount` **o** `count` DESCONOCIDO (fail-closed, §4.38k.1). */
  skippedSample: number;
  /** Entradas cuya forma el parser NO identificó positivamente ⇒ **no se escribió nada** de ellas. */
  unrecognized: number;
  /**
   * Sets que devolvieron entradas pero NINGUNA con bloque PSA (v1.50.2, techlead). Con al menos un set
   * del run que SÍ lo vio, esto es un estado de datos NORMAL —sets sin ventas PSA— y se cuenta aquí en
   * vez de parar la corrida. Solo si el run entero queda a 0 sets con bloque, se escala.
   */
  skippedNoGradedBlock: number;
  /**
   * v1.50.3 (§4.38m.2) — filas NO escritas por el **gate de evidencia**: la última venta observada es
   * más vieja que `freshnessDays`, o el proveedor no dijo cuándo fue. Se cuenta APARTE de
   * `skippedSample` a propósito: «no hay ventas recientes de esta carta» y «la muestra es corta» son
   * diagnósticos distintos y llevan a acciones distintas.
   */
  skippedEvidence: number;
  /**
   * v1.50.3-a (§4.38h.1-bis) — **cartas cuyo bloque PSA venía en el shape S2** (`gradedPrices.psaN`,
   * escalar), declarado **NO PERSISTIBLE**. Se cuenta APARTE de `skippedSample` y de `skippedEvidence`
   * **a propósito**: «el proveedor cambió de shape» y «esta carta tiene pocas ventas» exigen
   * **reacciones opuestas** —escalar vs. no hacer nada— y un contador único los vuelve indistinguibles
   * justo cuando hay que decidir. No es un descarte de rutina: es la **señal de escalada**.
   */
  skippedShapeS2: number;
  dailyLimited: boolean;
  /**
   * v1.50.3-g (§4.38h.1-quater) — la corrida fue **SONDA de solo lectura** (sin formato de moneda, o
   * con `POKEMONPRICETRACKER_GRADED_PROBE`): se preguntó al proveedor y se logueó la muestra cruda,
   * pero `written` es 0 **por construcción**. Sin este campo, «0 escritas» sería ambiguo entre «no
   * había nada que escribir» y «esta corrida no podía escribir», que es justo lo que hay que distinguir.
   */
  probe: boolean;
  /** v1.50.3-g — el veredicto de la fase 2 que se imprimió (`VIABLE` | `NO_VIABLE` | `INDETERMINADO`). */
  verdict: GradedPhase2Verdict;
  /** ⛔ Presente ⇒ el job PARÓ y hay que volver al ARQUITECTO (regla 9). */
  escalation: { reason: string; detail: string } | null;
}

/** Resumen de la ingesta de un set (observabilidad; NO expuesto por contrato). */
export interface IngestSetResult {
  setId: string;
  setExternalId: string | null;
  provider: string;
  /** Cartas locales tocadas (con ≥1 fila válida resuelta). */
  cardCount: number;
  /** Filas `PriceReference` upserteadas (por carta+acabado). */
  priced: number;
  /** Filas devueltas por el adapter que NO resolvieron a una carta local. */
  unresolved: number;
  /** Entradas omitidas por el adapter (mal formadas) + no resueltas. */
  skipped: number;
  /**
   * WS-A fix-ppt — el proveedor de paga agotó la cuota DIARIA en este set (429 daily). El orquestador
   * debe DETENER el barrido de los sets restantes (no resetea hasta 00:00 UTC). `undefined`/`false`
   * = la cuota no se agotó.
   */
  dailyLimited?: boolean;
  /** Scope aplicado a este set (`full`/`partial`/`skip`) — observabilidad del reporte. */
  scope?: SetScope;
  /** N-11 — presupuesto diario vivo tras este set (para la barra de progreso). */
  dailyRemaining?: number | null;
}

/**
 * N-11 (barra de progreso del sync de precios) — estado OBSERVABLE del barrido en curso (o del
 * último), en memoria del proceso. Calca `catalog-sync.getSyncStatus`. `GET /admin/pricing/sync-status`
 * lo expone; el front lo pollea. NO persistido (se pierde al reiniciar, como el de catálogo).
 */
export interface PriceSyncStatus {
  running: boolean;
  jobId: string | null;
  /** Sets a procesar en la corrida. */
  total: number;
  /** Sets ya intentados (éxito o fallo) — barra honesta done/total. */
  done: number;
  startedAt: string | null;
  finishedAt: string | null;
  /** Último error del barrido (mensaje), o null. */
  lastError: string | null;
  /** Presupuesto diario vivo restante del proveedor de paga, o null. */
  dailyRemaining: number | null;
  /** true si el barrido se DETUVO por límite diario (429 daily) → aviso "pausado hasta 00:00 UTC". */
  dailyLimited: boolean;
  /** Sets que quedaron pendientes si se detuvo por límite diario. */
  pending: number;
  /** Proveedor de la corrida (`pokemonpricetracker`/`pokemontcg_io`). */
  provider: string | null;
}

/**
 * PriceIngestService — corazón de WS-A (ARCHITECTURE §4.15c). Ingesta MASIVA de precios por SET
 * vía un `BulkPriceProvider` pluggable, con **upsert idempotente** de `PriceReference` por
 * `(cardId, 'raw', 'raw:NM', finish, hoy)`.
 *
 * ⛔ **v1.22-variantes-orden (§4.22a): NUNCA escribe `Card.availableFinishes`.** El refresco directo
 * de la lista blanca desde el proveedor (§4.15e) quedó DEROGADO — era la causa raíz del bug de tres
 * rondas del PO (VAR-1, §9): derivar las VARIANTES de la existencia de un PRECIO borraba el reverse
 * holo de toda carta sin precio de reverse holo.
 *
 * ✅ **v1.22-1 (§4.22g): Señal C money-safe.** Lo que este servicio SÍ hace ahora es escribir su
 * PROPIA columna de entrada `Card.pricedFinishesSnapshot` = los acabados que PPT reportó con
 * `market>0` y **alias VERIFICADO** (candado 2), por REEMPLAZO por carta en una corrida EXITOSA, y
 * luego LLAMAR a `FinishReconciler.reconcile(cardIds)` (§4.22g candado 4). El ÚNICO escritor de
 * `availableFinishes` sigue siendo el reconciliador del módulo `catalog`; aquí seguimos haciendo
 * CERO escrituras sobre `availableFinishes`. Ante fallo de PPT / 0 filas NO se toca ningún snapshot
 * (stale money-safe, como hoy no se borran precios). El drift se LOGUEA (`finishNotInCatalog`).
 *
 * ✅ **v1.27 (P-13, §4.25a): el snapshot ya NO compone `availableFinishes`** (el precio CONFIRMA,
 * nunca AÑADE; la lista blanca sale SOLO de `structuralFinishes`). El snapshot se conserva como
 * observabilidad/confirmación, y las filas del modo FORZADO (`fetchPrintings`, finish por etiqueta
 * de request) quedan EXCLUIDAS de él (§4.25a-2): sirven para precios, jamás como evidencia.
 *
 * - **Provider por dial:** `providerFor()` lee `PRICE_PROVIDER` y elige la implementación.
 * - **Resolución carta↔BD (§4.15d):** externalId (primario) → `(set, number)` (fallback); sin
 *   resolución → se OMITE (no crea `PriceReference` huérfana). Vive AQUÍ (no en el adapter) porque
 *   necesita la BD y el `BulkPriceRow` trae los identificadores (no un cardId ya resuelto).
 * - **FX una vez por corrida (§4.15f):** el `fx` lo carga el JOB y se pasa a cada `ingestSet`.
 * - **Money-safe:** respeta overrides manuales (vía `PricingService.persistMarketReference`), no
 *   toca `availableFinishes` en ningún caso (§4.22a), MXN sin conversión.
 */
@Injectable()
export class PriceIngestService {
  private readonly logger = new Logger(PriceIngestService.name);

  /**
   * N-11 — estado en memoria del barrido de precios (barra de progreso). Calca el patrón de
   * `catalog-sync`. Se inicializa "vacío/terminado"; lo maneja `ingestAll` (barrido completo).
   */
  private syncStatus: PriceSyncStatus = {
    running: false,
    jobId: null,
    total: 0,
    done: 0,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    dailyRemaining: null,
    dailyLimited: false,
    pending: 0,
    provider: null,
  };

  /** GET /admin/pricing/sync-status — progreso del barrido de precios en curso (o del último). */
  getSyncStatus(): PriceSyncStatus {
    return { ...this.syncStatus };
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly pricing: PricingService,
    private readonly pptBulk: PokemonPriceTrackerBulkProvider,
    private readonly tcgIoBulk: PokemonTcgIoBulkProvider,
    // v1.22-1 (§4.22g): tras escribir `pricedFinishesSnapshot` (Señal C), este servicio LLAMA al
    // ÚNICO escritor de `availableFinishes`. NUNCA escribe `availableFinishes` directamente.
    private readonly finishReconciler: FinishReconciler,
    // WS-A fix-ppt: resuelve `CardSet.pptSetId` (causa raíz #1) y lee los diales de scope/throttle.
    private readonly pptSetMapper: PptSetMapper,
    private readonly config: ConfigService,
    // v1.44 (P-47, §4.35): PRIMARIO del barrido de singles por-acabado desde TCGCSV `tcgcsv_singles`.
    // Opcional en el constructor para no forzar la actualización de los mocks de tests que no lo usan
    // (dial != 'tcgcsv_singles' nunca lo dereferencia); en DI real SIEMPRE se inyecta.
    private readonly tcgcsvSinglesBulk?: TcgcsvSinglesBulkPriceProvider,
    // v1.50.2 (§4.38h.4): la TRAZA por carta saltada es OBLIGATORIA, no opcional — sin ella el descarte
    // por `count` bajo sería INVISIBLE (el `preview` lo vería como `NO_PSA10`, porque la fila no
    // existe). Va al final y opcional por la MISMA razón que `tcgcsvSinglesBulk`: no romper los mocks
    // posicionales de los tests que no tocan este camino. `AuditModule` es @Global ⇒ en DI real
    // SIEMPRE se inyecta.
    private readonly audit?: AuditService,
  ) {}

  /** Elige el `BulkPriceProvider` según el dial `PRICE_PROVIDER` (default legacy pokemontcg_io). */
  async providerFor(): Promise<BulkPriceProvider> {
    const wanted = await this.settings.getString(SettingKey.PRICE_PROVIDER);
    // v1.44 (§4.35): `tcgcsv_singles` entra como opción PRIMARIA del barrido. Se filtra `undefined`
    // (mocks de tests que no inyectan el provider) para no reventar el `.find`.
    const candidates: Array<BulkPriceProvider | undefined> = [
      this.pptBulk,
      this.tcgIoBulk,
      this.tcgcsvSinglesBulk,
    ];
    const providers = candidates.filter((p): p is BulkPriceProvider => p != null);
    const chosen = providers.find((p) => p.source === wanted);
    if (!chosen) {
      this.logger.warn(`PRICE_PROVIDER="${wanted}" desconocido → fallback a pokemontcg_io (legacy).`);
      return this.tcgIoBulk;
    }
    return chosen;
  }

  /** IDs internos de TODOS los `CardSet` locales (parent fan-out + fallback secuencial). */
  async listLocalSetIds(): Promise<string[]> {
    const sets = await this.prisma.cardSet.findMany({ select: { id: true } });
    return sets.map((s) => s.id);
  }

  /**
   * ¿Hubo ingesta de MERCADO reciente? (catch-up al boot, auditoría 2026-08-17).
   * "Reciente" = existe ≥1 `PriceReference` NO-manual con `capturedDate` de hoy o ayer (UTC).
   * Los overrides manuales del admin NO cuentan: un admin poniendo un precio a mano no
   * significa que el ingest masivo haya corrido.
   */
  async hasRecentIngest(): Promise<boolean> {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - 1);
    const row = await this.prisma.priceReference.findFirst({
      // v1.50.3-f (M-43, §4.38l.4.4A): la pregunta es «¿corrió el barrido de MERCADO?», así que una
      // fila de ESTIMADO no la contesta. Sin el predicado, una corrida del ingest de fase 2 (que
      // escribe `graded_estimate` sobre cartas raw publicadas) haría creer al catch-up del boot que el
      // mercado ya se ingirió y **saltaría el barrido** — un fail-open operativo por la puerta de atrás.
      where: { capturedDate: { gte: since }, isManualOverride: false, ...MONEY_REF_WHERE },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * Ingesta de UN set por su id interno (child job `price-ingest-set`). Idempotente.
   * `fx` = snapshot cargado una vez por corrida.
   */
  async ingestSet(setId: string, fx: FxSnapshot): Promise<IngestSetResult> {
    const set = await this.prisma.cardSet.findUnique({ where: { id: setId } });
    if (!set) {
      this.logger.warn(`price-ingest-set: set ${setId} no existe localmente; se omite.`);
      return this.emptyResult(setId, null, 'none');
    }
    return this.ingestForSet(set, fx);
  }

  /**
   * WS-A fix-ppt — SETS a ingerir en la corrida completa, aplicando el SCOPE del PO cuando el
   * proveedor es el de PAGA (PokemonPriceTracker): sets modernos (año ≥ umbral) + sets viejos con
   * cartas en scope (inventario activo ∪ rares). Con el proveedor legacy (pokemontcg_io) NO hay
   * scope (se devuelven TODOS los sets, como siempre). El orden pone los modernos primero (mayor
   * valor de mercado) para que, si la cuota diaria se agota a media corrida, lo pendiente sea lo
   * menos crítico (sets viejos).
   */
  async listSetIdsForIngest(): Promise<string[]> {
    const provider = await this.providerFor();
    const sets = await this.prisma.cardSet.findMany();
    if (provider.source !== 'pokemonpricetracker') return sets.map((s) => s.id);

    const modern: string[] = [];
    const partial: string[] = [];
    let skipped = 0;
    for (const set of sets) {
      if (isModernSet(set)) {
        modern.push(set.id);
        continue;
      }
      const { scope } = await this.computeScope(set);
      if (scope === 'partial') partial.push(set.id);
      else skipped += 1;
    }
    this.logger.log(
      `price-ingest scope (pokemonpricetracker): ${modern.length} sets modernos (≥2020, full) + ` +
        `${partial.length} viejos con inventario/rares (partial), ${skipped} viejos omitidos (bulk).`,
    );
    return [...modern, ...partial];
  }

  /**
   * Ingesta de UN set por su externalId (`sv8`) o su id interno — para el disparo manual
   * `POST /admin/jobs/price-ingest { setId }` (verificación de esquema en la 1ª corrida, §4.15h).
   */
  async ingestSetByExternalId(setIdOrExternal: string, fx: FxSnapshot): Promise<IngestSetResult> {
    const set = await this.prisma.cardSet.findFirst({
      where: { OR: [{ externalId: setIdOrExternal }, { id: setIdOrExternal }] },
    });
    if (!set) {
      this.logger.warn(`price-ingest: set "${setIdOrExternal}" no encontrado (externalId/id); se omite.`);
      return this.emptyResult(setIdOrExternal, null, 'none');
    }
    // Disparo MANUAL de un set concreto (verificación de esquema, §4.15h): se fuerza el barrido
    // COMPLETO aunque el scope lo clasificaría como `skip` (el operador lo pidió explícitamente).
    return this.ingestForSet(set, fx, { manual: true });
  }

  /**
   * Ingesta secuencial y AWAITED del catálogo EN SCOPE (fallback sin Redis, §4.15c). Se DETIENE si el
   * proveedor de paga agota la cuota DIARIA (429 daily) y reporta cuántos sets quedaron pendientes
   * (money-safe: no se reintenta hasta 00:00 UTC).
   */
  async ingestAll(fx: FxSnapshot): Promise<{ sets: number; priced: number; pending: number; dailyLimited: boolean }> {
    const provider = await this.providerFor();
    const ids = await this.listSetIdsForIngest();
    // N-11: publica el estado observable ANTES de arrancar (barra honesta done/total).
    const jobId = `price-ingest-${new Date().toISOString().slice(0, 10)}`;
    this.syncStatus = {
      running: true,
      jobId,
      total: ids.length,
      done: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      lastError: null,
      dailyRemaining: null,
      dailyLimited: false,
      pending: ids.length,
      provider: provider.source,
    };

    let priced = 0;
    let dailyLimited = false;
    let processed = 0;
    try {
      for (const id of ids) {
        const res = await this.ingestSet(id, fx);
        priced += res.priced;
        processed += 1;
        // Progreso honesto: done por set intentado; dailyRemaining vivo si el proveedor lo reporta.
        this.syncStatus.done = processed;
        this.syncStatus.pending = ids.length - processed;
        if (res.dailyRemaining != null) this.syncStatus.dailyRemaining = res.dailyRemaining;
        if (res.dailyLimited) {
          dailyLimited = true;
          this.syncStatus.dailyLimited = true;
          break;
        }
      }
    } catch (e) {
      this.syncStatus.lastError = (e as Error).message;
      throw e;
    } finally {
      this.syncStatus.running = false;
      this.syncStatus.finishedAt = new Date().toISOString();
      this.syncStatus.pending = ids.length - processed;
    }

    const pending = ids.length - processed;
    if (dailyLimited) {
      this.logger.warn(
        `price-ingest (secuencial): PARADA por cuota DIARIA agotada tras ${processed}/${ids.length} sets ` +
          `(${pending} pendientes; reintenta tras 00:00 UTC). ${priced} referencias escritas.`,
      );
    } else {
      this.logger.log(`price-ingest (secuencial): ${processed} sets, ${priced} referencias.`);
    }
    return { sets: ids.length, priced, pending, dailyLimited };
  }

  // ----------------------------------------------------------------------------

  private async ingestForSet(
    set: CardSet,
    fx: FxSnapshot,
    opts: { manual?: boolean } = {},
  ): Promise<IngestSetResult> {
    const provider = await this.providerFor();
    // v1.44 (P-47, §4.35): el PRIMARIO de singles reprecia SOLO por-acabado (marketPrice de TCGCSV por
    // CardProduct+finish) y NO re-resuelve estructura. Va por un camino DEDICADO, keyed por
    // `cardProductId`, que NO comparte el colapso `(cardId, finish)` ni el bloque snapshot/reconcile
    // del flujo PPT/pokemontcg.io (ese bloque tocaría estructura; §4.35 lo prohíbe a diario).
    if (provider.source === 'tcgcsv_singles') {
      return this.ingestSinglesForSet(set, provider, fx);
    }
    const input = await this.buildFetchInput(provider, set, opts.manual === true);
    if (input === 'skip') {
      // Set viejo sin inventario activo ni rares (scope PO): no se pide nada (ahorra créditos).
      this.logger.log(`price-ingest-set(${set.externalId}, ${provider.source}): scope=skip (viejo sin inventario/rares).`);
      const empty = this.emptyResult(set.id, set.externalId, provider.source);
      return { ...empty, scope: 'skip' };
    }
    const { fetchInput, scope, allowedCardIds } = input;
    const result = await provider.fetchPricesForSet(fetchInput);

    // Agrupa las filas VÁLIDAS por cardId RESUELTO (§4.15c/§4.15d). En scope `partial`, SOLO se
    // conservan las cartas permitidas (inventario activo ∪ rares) — así, aunque el barrido traiga
    // el set entero, NO se persiste el bulk de comunes de un set viejo (regla del PO).
    const byCard = new Map<string, Map<Finish, BulkPriceRow>>();
    let unresolved = 0;
    let outOfScope = 0;
    for (const row of result.rows) {
      const cardId = await this.resolveCardId(row, set);
      if (!cardId) {
        unresolved += 1;
        continue;
      }
      if (allowedCardIds && !allowedCardIds.has(cardId)) {
        outOfScope += 1;
        continue;
      }
      const finishes = byCard.get(cardId) ?? new Map<Finish, BulkPriceRow>();
      // Si el proveedor repite un acabado para la misma carta, gana la ÚLTIMA (idempotente igual).
      finishes.set(row.finish, row);
      byCard.set(cardId, finishes);
    }

    // v1.22 (§4.22a): CATÁLOGO de acabados de las cartas tocadas — se lee SOLO para detectar drift
    // y LOGUEARLO (`finishNotInCatalog`). NUNCA para escribir `availableFinishes` desde aquí.
    const catalogFinishes = new Map<string, Finish[]>();
    if (byCard.size > 0) {
      const rows = await this.prisma.card.findMany({
        where: { id: { in: [...byCard.keys()] } },
        select: { id: true, externalId: true, availableFinishes: true },
      });
      for (const r of rows) catalogFinishes.set(r.id, (r.availableFinishes ?? ['normal']) as Finish[]);
    }

    let priced = 0;
    const driftPairs: string[] = [];
    for (const [cardId, finishes] of byCard) {
      const known = catalogFinishes.get(cardId) ?? ['normal'];
      for (const [finish, row] of finishes) {
        // El adapter ya garantizó market > 0; doble-guard money-safe.
        if (row.marketCents <= 0) continue;
        await this.pricing.persistMarketReference(
          cardId,
          finish,
          { marketCents: row.marketCents, currency: row.currency, source: provider.source },
          fx,
        );
        // §4.22a — DRIFT observable: el proveedor reporta un acabado que el CATÁLOGO no declara.
        // `PriceReference` se persiste igual (dato inocuo: el quote valida el finish contra
        // `Card.availableFinishes` ANTES de leer precio, SEC-A1), pero queda evidencia para el
        // dueño. El remedio es un `sync-all {force:true}` o el override manual — jamás escribir
        // la lista blanca desde un feed de precios.
        if (!known.includes(finish)) driftPairs.push(`${cardId}:${finish}`);
        priced += 1;
      }
      // ⛔ v1.22-variantes-orden (§4.22a-1/2): NUNCA se escribe `card.update({ availableFinishes })`
      // aquí (VAR-1, §9). La lista blanca la recompone SOLO el reconciliador (abajo), a partir de
      // las columnas de entrada. Este bucle solo persiste PRECIOS (tolerante con alias SUPUESTO).
    }

    // v1.22-1 (§4.22g) — Señal C: REEMPLAZO money-safe de `pricedFinishesSnapshot` + reconcile.
    // Solo en una corrida EXITOSA con filas (`requestOk && rows>0`): ante fallo total / 0 filas /
    // modo sample-only NO se toca ningún snapshot (stale conservador). Por cada carta VISTA con ≥1
    // fila válida, el snapshot se reemplaza por sus acabados con `market>0 && finishAliasVerified`
    // (vacío si ninguno es verificado ⇒ se limpia lo stale, reparabilidad §4.22g). Luego se llama
    // al ÚNICO escritor de `availableFinishes`. `price-ingest` JAMÁS escribe `availableFinishes`.
    //
    // v1.27 (P-13.2, §4.25a-2): las filas del modo FORZADO (`forcedPrinting`, finish por etiqueta
    // de request) NO son evidencia — se EXCLUYEN del snapshot. Si TODAS las filas de una carta son
    // forzadas (corrida `fetchPrintings`), su snapshot se CONSERVA tal cual (ni se escribe ni se
    // limpia: una corrida por-impresión no aporta ni retira evidencia del modo lista). El reconcile
    // SÍ corre igual: es idempotente y repara availableFinishes stale con la fórmula §4.25a.
    if (result.requestOk && result.rows.length > 0 && byCard.size > 0) {
      const reconcileIds: string[] = [];
      for (const [cardId, finishes] of byCard) {
        const evidence = [...finishes.values()].filter((row) => row.forcedPrinting !== true);
        if (evidence.length > 0) {
          const verified = orderFinishes(
            evidence
              .filter((row) => row.finishAliasVerified && row.marketCents > 0)
              .map((row) => row.finish),
          );
          await this.prisma.card.update({
            where: { id: cardId },
            data: { pricedFinishesSnapshot: verified },
          });
        }
        reconcileIds.push(cardId);
      }
      await this.finishReconciler.reconcile(reconcileIds);
    }

    // v2.1.1 (P-48, §4.36.5b-ter) — CONTINUIDAD DEL GUARDARRAÍL: el pase posterior al barrido ABRE
    // entradas, no solo las cierra. Hasta aquí la SALIDA de la cola cabalgaba sobre el barrido (una
    // `PriceReference` nueva la cierra en la siguiente resolución) pero la ENTRADA estaba atada solo a
    // eventos de publicación: el guardarraíl se cerraba solo y NO se abría solo, así que cada
    // degradación futura del feed dependía de que alguien pulsara «publicar». Solo tras una corrida
    // EXITOSA con filas (mismo criterio conservador que el snapshot de acabados: ante fallo total o 0
    // filas no se concluye nada).
    if (result.requestOk && result.rows.length > 0) {
      await this.reconcilePublishedPrices(set);
    }

    if (driftPairs.length > 0) {
      this.logger.warn(
        `price-ingest-set(${set.externalId}, ${provider.source}): finishNotInCatalog — ` +
          `${driftPairs.length} referencia(s) de acabados FUERA de Card.availableFinishes ` +
          `[${driftPairs.slice(0, 20).join(', ')}${driftPairs.length > 20 ? ', …' : ''}]. ` +
          `El precio SÍ se persiste; el catálogo NO se modifica (§4.22a).`,
      );
    }

    this.logger.log(
      `price-ingest-set(${set.externalId}, ${provider.source}, scope=${scope}): ${byCard.size} cartas, ` +
        `${priced} refs, ${unresolved} sin resolver, ${outOfScope} fuera de scope, ` +
        `${result.skipped} omitidas por el adapter, ${driftPairs.length} finishNotInCatalog` +
        `${result.dailyLimited ? ', 429 DAILY (parada)' : ''}.`,
    );
    return {
      setId: set.id,
      setExternalId: set.externalId,
      provider: provider.source,
      cardCount: byCard.size,
      priced,
      unresolved,
      skipped: result.skipped + unresolved + outOfScope,
      dailyLimited: result.dailyLimited,
      scope,
      dailyRemaining: result.dailyRemaining ?? null,
    };
  }

  /**
   * v1.44 (P-47, §4.35) — barrido DIARIO de PRECIO por-acabado de singles desde TCGCSV
   * `tcgcsv_singles`. El provider ya hizo el join EXACTO por `CardProduct.tcgplayerProductId` y
   * devuelve una fila por `(cardProductId, finish, marketCents>0)`; aquí SOLO se upsertea la
   * `PriceReference` keyed por `cardProductId` (source `tcgcsv_singles`, FX del snapshot), respetando
   * `isManualOverride` (lo garantiza `persistMarketReference`).
   *
   * SEPARACIÓN ESTRUCTURA ↔ PRECIO (§4.35a): NO escribe `CardProduct.finishes` ni
   * `Card.availableFinishes`, NO toca `pricedFinishesSnapshot`, NO llama al `FinishReconciler`. La
   * composición sigue GATEADA a import/`--force` (§4.27d). Money-safe: un acabado sin `marketPrice`
   * fresco en TCGCSV NO produce fila (el provider ya lo omitió) ⇒ queda «—»/PRICE_PENDING, jamás el
   * precio de otro acabado ni un 0. La precedencia §4.27f (`sourceRank`/`isBetterRef`) hace que la
   * fila `tcgcsv_singles` (con `cardProductId`) gane sobre cualquier residuo de PPT (`cardProductId=null`).
   */
  private async ingestSinglesForSet(
    set: CardSet,
    provider: BulkPriceProvider,
    fx: FxSnapshot,
  ): Promise<IngestSetResult> {
    const result = await provider.fetchPricesForSet({ set });
    const touchedCards = new Set<string>();
    let priced = 0;
    let skipped = result.skipped;
    for (const row of result.rows) {
      // Defensa en profundidad: el provider de singles SIEMPRE puebla ambos; sin ellos no se escribe
      // (nunca una `PriceReference` huérfana ni una variante sin su `cardProductId` money-safe).
      if (!row.cardId || !row.cardProductId) {
        skipped += 1;
        continue;
      }
      if (!(row.marketCents > 0)) {
        skipped += 1;
        continue;
      }
      await this.pricing.persistMarketReference(
        row.cardId,
        row.finish,
        { marketCents: row.marketCents, currency: row.currency, source: 'tcgcsv_singles' },
        fx,
        row.cardProductId,
      );
      touchedCards.add(row.cardId);
      priced += 1;
    }
    this.logger.log(
      `price-ingest-set(${set.externalId}, tcgcsv_singles): ${touchedCards.size} cartas, ${priced} ` +
        `refs por-acabado (keyed por cardProduct), ${skipped} omitidas` +
        `${result.requestOk ? '' : ' [fetch FALLÓ → 0 filas, precios previos STALE]'}. ` +
        `Estructura NO re-resuelta (§4.35).`,
    );
    // §4.36(c) — COEXISTENCIA de las DOS CAPAS ortogonales (ESCRIBIR-luego-LEER): la capa REFERENCIA
    // (P-47, `tcgcsv_singles`) acaba de upsertear las `PriceReference` per-acabado del set; ahora la
    // capa REGLA (curva v2) LEE esas mismas filas para re-resolver el precio de venta de las piezas
    // PUBLICADAS y abrir/cerrar su entrada en la cola. Sin esto, el barrido PRIMARIO (tcgcsv_singles)
    // repreciaría la referencia pero NUNCA re-resolvería la curva de lo ya `listed` (regresión del
    // guardarraíl continuo, §4.36.5b-ter). Mismo criterio conservador que el flujo PPT/pokemontcg.io:
    // solo tras una corrida EXITOSA con filas. Falla-seguro (los precios YA se persistieron).
    if (result.requestOk && result.rows.length > 0) {
      await this.reconcilePublishedPrices(set);
    }
    return {
      setId: set.id,
      setExternalId: set.externalId,
      provider: provider.source,
      cardCount: touchedCards.size,
      priced,
      unresolved: 0,
      skipped,
      dailyLimited: false,
      scope: 'full',
      dailyRemaining: null,
    };
  }

  /**
   * v2.1.1 (P-48, §4.36.5b-ter) — RE-RESUELVE el precio de venta de las piezas PUBLICADAS del set que
   * el barrido acaba de repreciar y **abre o cierra** su entrada en la cola según el veredicto. Es lo
   * que hace CONTINUO al guardarraíl: sin esto, una pieza ya `listed` cuyo mercado se degrada deja de
   * venderse en silencio hasta que alguien pulse «publicar» (§N.5 pide lo contrario).
   *
   * - **No es un job nuevo ni una fan-out nueva:** es el lote que el barrido YA tiene en la mano.
   * - **Alcance = el SET completo, no solo las variantes con fila nueva.** A propósito: el caso feo es
   *   justamente el acabado/carta que el proveedor DEJÓ de reportar; si solo mirásemos lo que vino en
   *   la respuesta, ese caso —el que más se parece a una degradación real— nunca se detectaría.
   * - **Solo `raw`:** es lo que este barrido reprecia (`productType='raw'`, `gradeKey='raw:NM'`). El
   *   sellado y las gradeadas tienen su propio ingest y su propia clave de cola.
   * - **Las piezas con override manual POR PIEZA se saltan**, igual que en `resolvePublishSalePrice`:
   *   su precio no depende del mercado, así que ni escalan ni cierran nada.
   * - **NO cambia el `status`** (§4.36.5b-bis decisión 3): la pieza sigue `listed`. No hay exposición
   *   que cerrar (la resolución en lectura ya la sacó de Compra y de `stockCount`) y un flip
   *   `listed → in_stock` competiría con un checkout en vuelo. La señal es la entrada en la cola.
   *
   * Falla-seguro: un error aquí NO tumba la ingesta (los precios ya se persistieron); se loguea.
   */
  private async reconcilePublishedPrices(set: CardSet): Promise<void> {
    try {
      const items = await this.prisma.inventoryItem.findMany({
        where: {
          ownerType: 'platform',
          status: 'listed',
          productType: 'raw',
          card: { setId: set.id },
        },
        include: { card: true },
      });
      if (items.length === 0) return;
      // Pago mínimo BE-25: curva izada UNA vez; referencias y overrides EN LOTE (sin N+1 por pieza).
      const curve = await this.pricing.loadPricingCurve();
      const keys = items.map((it) => ({
        cardId: it.cardId,
        productType: it.productType,
        gradeKey: this.pricing.gradeKeyFor(it),
        finish: it.finish,
      }));
      const refs = await this.pricing.getReferencesBatch(keys);
      const overrides = await this.pricing.getVariantOverridesBatch(keys);
      let opened = 0;
      let closed = 0;
      for (const item of items) {
        // Override manual POR PIEZA: el precio no sale del mercado ⇒ el barrido no opina sobre su cola.
        // H-1 (E5-bis): `<= 0` es AUSENTE, así que esa pieza SÍ deriva de la curva y SÍ tiene que
        // entrar al barrido. Con el `!= null` de antes se saltaba y NUNCA se reconciliaba — el mismo
        // hueco de D5, recién abierto por este bucle.
        if (hasManualPrice(item)) continue;
        const gradeKey = this.pricing.gradeKeyFor(item);
        const key = `${item.cardId}|${item.productType}|${gradeKey}|${item.finish}`;
        const ref = refs.get(key);
        const refCents = ref && ref.status === 'priced' ? (ref.referenceMxnCents ?? null) : null;
        // SEAM ÚNICO del eje de venta (§4.36.5b): mismo cuerpo, mismo veredicto que publicación y
        // checkout — el barrido no puede llegar a una conclusión distinta de la del storefront.
        const decision = this.pricing.decideSalePrice({
          referenceMxnCents: refCents,
          rarityCanonical: item.card.rarityCanonical ?? item.card.rarity,
          controls: overrides.get(key) ?? null,
          curve,
        });
        // §4.36.5c: el MISMO seam abre y cierra. `reason != null` ⇒ entra a la cola; `null` ⇒ se cierra
        // la entrada abierta de esa clave si el mercado volvió a resolver.
        await this.pricing.settlePendingForVariant(
          decision.pendingReason,
          { cardId: item.cardId, productType: item.productType, gradeKey, finish: item.finish },
          'inventory',
        );
        if (decision.pendingReason != null) opened++;
        else closed++;
      }
      if (opened > 0) {
        this.logger.warn(
          `price-ingest-set(${set.externalId}): ${opened} pieza(s) PUBLICADA(s) dejaron de resolver precio ` +
            `tras el barrido y entraron a la cola (siguen \`listed\`); ${closed} re-verificada(s) sana(s).`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `price-ingest-set(${set.externalId}): la reconciliación de piezas publicadas falló ` +
          `(los precios YA se persistieron): ${(e as Error).message}`,
      );
    }
  }

  /**
   * WS-A fix-ppt — arma la entrada de `fetchPricesForSet`. Para el proveedor legacy (pokemontcg_io)
   * es `{ set }` sin scope. Para el de PAGA (PokemonPriceTracker):
   *  - Resuelve `pptSetId` (causa raíz #1) vía `PptSetMapper` (una carga de `/api/v2/sets` cacheada).
   *  - Aplica el SCOPE del PO: modernos → full; viejos → partial (con `allowedCardIds` = inventario ∪
   *    rares) o skip. `manual` fuerza full (disparo explícito del operador).
   *  - Pasa `minPrice` (dial) en partial para no traer bulk desde el origen, y `fetchPrintings` (dial).
   * Devuelve `'skip'` si el set queda fuera de scope.
   */
  private async buildFetchInput(
    provider: BulkPriceProvider,
    set: CardSet,
    manual: boolean,
  ): Promise<'skip' | { fetchInput: BulkFetchInput; scope: SetScope; allowedCardIds: Set<string> | null }> {
    if (provider.source !== 'pokemonpricetracker') {
      return { fetchInput: { set }, scope: 'full', allowedCardIds: null };
    }

    const scopeInfo = manual
      ? ({ scope: 'full', allowedCardIds: null } as SetScopeInfo)
      : await this.computeScope(set);
    if (scopeInfo.scope === 'skip') return 'skip';

    const map = await this.pptSetMapper.resolveForSets([set]);
    const providerSetId = map.get(set.id) ?? null;

    const fetchInput: BulkFetchInput = {
      set,
      providerSetId,
      // En partial: `minPrice` (unidad del proveedor) para excluir bulk en el origen. Dial opcional;
      // sin él, el filtro de allowedCardIds igual evita persistir bulk (a costa de más créditos).
      minPrice: scopeInfo.scope === 'partial' ? this.partialMinPrice() : null,
      fetchPrintings: this.fetchPrintingsEnabled(),
    };
    return { fetchInput, scope: scopeInfo.scope, allowedCardIds: scopeInfo.allowedCardIds };
  }

  /**
   * WS-A fix-ppt — SCOPE de un set (regla del PO). Moderno (año ≥ umbral) → full. Viejo → partial si
   * tiene ≥1 carta con inventario ACTIVO (no withdrawn/lost) ∪ carta RARA; si no, skip. Devuelve los
   * `cardIds` permitidos para el filtro de persistencia del caso partial.
   */
  private async computeScope(set: CardSet): Promise<SetScopeInfo> {
    if (isModernSet(set)) return { scope: 'full', allowedCardIds: null };

    // Cartas del set con inventario ACTIVO.
    const invItems = await this.prisma.inventoryItem.findMany({
      where: { card: { setId: set.id }, status: { notIn: [...INACTIVE_INVENTORY_STATUSES] } },
      select: { cardId: true },
      distinct: ['cardId'],
    });
    // Cartas PREMIUM/CHASE del set (refinamiento PO: Illustration Rare para arriba + ex/GX/V…;
    // NO bulk, NO rare normal, NO reverse holo como tier). Ver `isPremiumRarity`.
    const cards = await this.prisma.card.findMany({
      where: { setId: set.id },
      select: { id: true, rarity: true },
    });
    const allowed = new Set<string>();
    for (const it of invItems) allowed.add(it.cardId);
    for (const c of cards) if (isPremiumRarity(c.rarity)) allowed.add(c.id);

    const scope = classifySet(set, allowed.size);
    return { scope, allowedCardIds: scope === 'partial' ? allowed : null };
  }

  /** Dial `POKEMONPRICETRACKER_PARTIAL_MIN_PRICE` (unidad del proveedor); vacío → sin filtro. */
  private partialMinPrice(): string | null {
    const raw = this.config.get<string>('POKEMONPRICETRACKER_PARTIAL_MIN_PRICE');
    return raw && String(raw).trim() !== '' ? String(raw).trim() : null;
  }

  /** Dial `POKEMONPRICETRACKER_FETCH_PRINTINGS=true` → barrido por impresión (reverse holo). */
  private fetchPrintingsEnabled(): boolean {
    return String(this.config.get<string>('POKEMONPRICETRACKER_FETCH_PRINTINGS') ?? '').toLowerCase() === 'true';
  }

  /**
   * Resuelve la carta local (§4.15d): externalId (PRIMARIO) → `(set, number)` (FALLBACK).
   * Sin resolución → null (la fila se OMITE en el llamador, no se crea referencia huérfana).
   *
   * P-6 (2026-08-18): el fallback tolera las VARIANTES de formato del número del proveedor de
   * paga (`"104/159"` o `"004"` contra nuestro `"104"`, ver `cardNumberVariants`). El número
   * EXACTO manda; solo si no casa se prueban las variantes, y únicamente se acepta si casan con
   * UNA sola carta del set (money-safe: ante ambigüedad se omite en vez de adivinar la carta).
   */
  private async resolveCardId(row: BulkPriceRow, set: CardSet): Promise<string | null> {
    if (row.externalId) {
      const byExt = await this.prisma.card.findUnique({
        where: { externalId: row.externalId },
        select: { id: true },
      });
      if (byExt) return byExt.id;
    }
    if (row.number) {
      // El ingest está acotado a ESTE set → el fallback busca por (set.id, number).
      const byNumber = await this.prisma.card.findFirst({
        where: { setId: set.id, number: row.number },
        select: { id: true },
      });
      if (byNumber) return byNumber.id;

      const variants = cardNumberVariants(row.number);
      if (variants.length > 0) {
        const matches = await this.prisma.card.findMany({
          where: { setId: set.id, number: { in: variants } },
          select: { id: true },
          take: 2,
        });
        if (matches.length === 1) return matches[0].id;
        if (matches.length > 1) {
          this.logger.warn(
            `price-ingest: el número "${row.number}" del proveedor casa con ${matches.length} cartas ` +
              `del set ${set.externalId} → se OMITE (no se adivina la carta).`,
          );
        }
      }
    }
    return null;
  }

  /**
   * v1.50.2 (§4.38h) — **INGEST AUTOMÁTICO DE ESTIMADOS PSA (fase 2).** Deja de ser manual.
   *
   * ### Alcance: SOLO cartas con INVENTARIO PUBLICADO (y por qué eso resuelve la cuota)
   * `includeEbay=true` cuesta **2 créditos por carta**. Barrer el catálogo entero sería insostenible;
   * pedir precio de gradeo **solo de lo que efectivamente estamos vendiendo** hace el coste
   * proporcional al inventario real, que es el único conjunto donde el estimado tiene superficie donde
   * mostrarse (una carta sin publicar no tiene teja ni ficha). Encima va el tope DURO
   * `graded_estimate_ingest_max_cards_per_run` (seed 250): un error de alcance no puede quemar la
   * cuota del día.
   *
   * ### Fail-closed en tres puntos, todos deliberados
   *  1. **`grading_hook_enabled` (seed `off`) — EL dial, v1.51 (M-46, §4.38r).** Ya no hay dial propio
   *     del ingest: el mismo interruptor gobierna exhibición y obtención, así que `off` significa
   *     literalmente **ni una petición al proveedor y ni una fila escrita**. ~~Se puede rodar el ingest
   *     en observación con la vitrina apagada~~ ⛔ eso dejó de ser expresable (§4.38r.6.4); quien
   *     quiera observar sin escribir usa la **sonda** (`POKEMONPRICETRACKER_GRADED_PROBE`), que es
   *     solo-lectura por construcción.
   *  2. `ingestConfigInvalid` — con `minSampleCount`/`sourceStat` corruptos NO sabemos *cuánta* muestra
   *     exigimos ni *qué número* es el precio. Adivinar eso es escribir dinero a ciegas.
   *  3. El parser solo escribe lo que identifica POSITIVAMENTE como monto (§4.38h.1).
   *
   * ### INV-D (§4.38l): la MISMA guarda que el override manual
   * Si la carta tiene un **slab publicado** de ese grado, esa fila **es el precio real** de esa pieza:
   * el job **la salta** y deja `AuditLog`. Es la misma regla que hace que
   * `POST /admin/pricing/override` con `intent:"graded_estimate"` devuelva `409`.
   *
   * ### ⛔ Escalada (regla 9)
   * Si el proveedor revela que `includeEbay=true` **no** combina con `fetchAllInSet=true`, el job
   * **PARA** y lo reporta: NO se degrada a «una petición por carta». Eso multiplicaría el coste por el
   * nº de cartas e invalidaría el modelo de barrido por set — rediseño de arquitectura y de costo, no
   * decisión de implementación.
   */
  async ingestGradedEstimates(fx: FxSnapshot): Promise<GradedIngestResult> {
    const result: GradedIngestResult = {
      enabled: false,
      sets: 0,
      cardsInScope: 0,
      written: 0,
      skippedManual: 0,
      skippedSlabPublished: 0,
      skippedSample: 0,
      unrecognized: 0,
      skippedNoGradedBlock: 0,
      skippedEvidence: 0,
      skippedShapeS2: 0,
      dailyLimited: false,
      probe: false,
      verdict: 'INDETERMINADO',
      escalation: null,
    };
    // v1.50.3-g (§4.38h.1-quater) — TODO lo que el veredicto de la fase 2 necesita, acumulado a escala
    // de CORRIDA. Se declara aquí arriba, junto al resultado, porque el veredicto se emite en TODAS las
    // salidas —incluidas las tempranas—: «el dial estaba en off» es una respuesta perfectamente válida
    // a «¿por qué no pasó nada?», y era una de las que hoy había que deducir leyendo el log entero.
    const ev = {
      probe: false,
      requestOk: false,
      cardsReturned: 0,
      creditsBefore: null as number | null,
      creditsAfter: null as number | null,
    };
    // Config COMPLETA (no la del storefront). v1.51 (M-46, §4.38r.7): el gate lee **`cfg.enabled` — el
    // DIAL CRUDO—, NUNCA `estimatesEnabled`/`highlightEnabled`**. Esos dos doblan la validez de claves
    // de CURADURÍA (`minUpsidePct`, `highlightGrades`, `maxRawMultiple`), y colgar de ellos la
    // obtención significaría que **un dedazo en un umbral de vitrina congela la llegada de datos**
    // (§4.38h.3). La variante `ForAdmin` es justo la que no apaga `enabled` por clave corrupta.
    const cfg = await this.pricing.loadGradedEstimateConfigForAdmin();
    if (!cfg.enabled) {
      this.logger.log(
        'graded-estimate-ingest: dial `grading_hook_enabled` = off → no se pide NADA al proveedor ' +
          '(cero créditos) y no se escribe NINGUNA fila. Es el dial ÚNICO del gancho (v1.51, §4.38r): ' +
          'se enciende con PUT /admin/settings { "gradingHookEnabled": "on" }, y encenderlo también ' +
          'PUBLICA las cifras.',
      );
      return this.emitGradedVerdict(result, ev, { s1: 0, s2: 0 }, 'auto');
    }
    if (cfg.ingestConfigInvalid) {
      this.logger.warn(
        'graded-estimate-ingest: config del INGEST presente-pero-INVÁLIDA (minSampleCount/sourceStat/' +
          'ingestMaxCardsPerRun) → NO se escribe nada. Corrige con PUT /admin/pricing/graded-estimates.',
      );
      return this.emitGradedVerdict(result, ev, { s1: 0, s2: 0 }, 'auto');
    }
    result.enabled = true;

    // ALCANCE: cartas con inventario RAW publicado. Orden DETERMINISTA (cardId asc) para que el tope
    // por corrida sea reproducible y no dependa del orden que devuelva la BD.
    const published = await this.prisma.inventoryItem.findMany({
      where: { ownerType: 'platform', status: 'listed', productType: 'raw' },
      select: { cardId: true },
      distinct: ['cardId'],
      orderBy: { cardId: 'asc' },
    });
    const cardIds = published.map((r) => r.cardId).slice(0, cfg.ingestMaxCardsPerRun);
    if (cardIds.length === 0) {
      this.logger.log(
        'graded-estimate-ingest: NINGUNA carta con inventario RAW publicado → no se pide nada (cero créditos).',
      );
      return this.emitGradedVerdict(result, ev, { s1: 0, s2: 0 }, 'auto');
    }
    result.cardsInScope = cardIds.length;

    const cards = await this.prisma.card.findMany({
      where: { id: { in: cardIds } },
      // `externalId`/`number` se traen AQUÍ para poder resolver carta↔fila del proveedor EN MEMORIA
      // (BE-GE3): son los dos identificadores que usa `resolveCardId`, y el conjunto ya está acotado.
      select: { id: true, setId: true, set: true, externalId: true, number: true },
    });
    const bySet = new Map<string, { set: CardSet; allowed: Set<string> }>();
    const cardsById = new Map<string, { id: string; externalId: string | null; number: string | null }>();
    for (const c of cards) {
      cardsById.set(c.id, { id: c.id, externalId: c.externalId, number: c.number });
      if (!c.set) continue;
      const entry = bySet.get(c.setId) ?? { set: c.set, allowed: new Set<string>() };
      entry.allowed.add(c.id);
      bySet.set(c.setId, entry);
    }
    // INV-D — una sola query batcheada para TODO el alcance (jamás una por carta).
    const slabsByCard = await this.pricing.getPublishedSlabGradesBatch(cardIds);

    // Fecha de negocio de la corrida: UNA sola para todo el run. El gate de EVIDENCIA (§4.38m.2) mide
    // contra ella, y una corrida larga que cruzara la medianoche no puede cambiar de criterio a medias.
    const today = businessDateCdmx();

    // ⛔ ESCALADA silenciosa, evaluada A ESCALA DE CORRIDA (v1.50.2, techlead). Ver el bloque tras el
    // bucle: un set sin bloque PSA es un estado de datos NORMAL; la hipótesis «el proveedor ignoró
    // includeEbay» solo es indistinguible si NINGÚN set del run vio el bloque.
    let anySetSawGradedBlock = false;
    const setsWithoutGradedBlock: { setExternalId: string; detail: string }[] = [];
    /** Sets ya barridos EN MODO SONDA (los que costaron créditos sin poder escribir). */
    let probedSets = 0;
    // ⛔ (§4.38h.1-bis) — insumo de la ESCALADA POR SHAPE, también a escala de CORRIDA. Se cuentan las
    // CARTAS por shape servido, no las filas escritas: la pregunta es «¿qué está sirviendo PPT?», y esa
    // pregunta es independiente de los gates de dinero (una carta S1 descartada por muestra corta NO es
    // evidencia de que el proveedor haya cambiado de shape).
    const shapeCounts = { s1: 0, s2: 0 };
    // ⛔ (§4.38h.1-bis, v1.50.3-c) — ¿el conteo de shapes es una OBSERVACIÓN o un ECO de lo que pedimos?
    // `POKEMONPRICETRACKER_GRADED_FORMAT` viaja en el resultado de cada set; basta con que UNA llamada
    // de la corrida haya ido forzada para que el conteo global deje de ser evidencia sobre el proveedor.
    let forcedFormatSeen: GradedFormat = 'auto';

    for (const { set, allowed } of bySet.values()) {
      // ── ACOTA EL GASTO DE LA SONDA (§4.38h.5) ────────────────────────────────────────────────────
      // Se evalúa ANTES de pedir el siguiente set —o sea antes de gastar— y no después. La sonda no
      // ingesta: solo contesta «¿qué shape sirve PPT?». En cuanto UN set trae bloque PSA, la pregunta
      // está contestada y seguir barriendo sets solo compra la misma respuesta con el crédito del dueño.
      // Si ningún set lo trae, sí conviene insistir un poco (un set sin ventas PSA es normal), pero con
      // tope: `GRADED_PROBE_MAX_SETS`. El tope se LOGUEA al aplicarse — un límite silencioso sería el
      // mismo error que el aviso inalcanzable de §4.38h.1-ter.
      if (ev.probe && (anySetSawGradedBlock || probedSets >= GRADED_PROBE_MAX_SETS)) {
        this.logger.warn(
          `graded-estimate-ingest: SONDA — se para tras ${probedSets} set(s) ` +
            (anySetSawGradedBlock
              ? 'porque uno ya trajo bloque PSA: la pregunta está contestada y cada set extra cuesta créditos.'
              : `por el tope de sonda (${GRADED_PROBE_MAX_SETS}): ninguno trajo bloque PSA y no se sigue ` +
                'quemando cuota. Vuelve a correr con otro inventario publicado si quieres más evidencia.'),
        );
        break;
      }
      // BE-GE3 (techlead) — índice EN MEMORIA de las cartas de ESTE set que están en alcance. El
      // resolver por fila hacía 1-3 queries DENTRO del bucle del ingest (externalId → (set,number) →
      // variantes de número) sobre un conjunto que ya teníamos materializado: con 250 cartas por
      // corrida eso son hasta 750 round-trips para responder algo que es un `Map.get`. Se resuelve
      // contra las cartas EN ALCANCE a propósito: la línea de abajo ya descarta todo lo que no esté
      // en `allowed`, así que acotar el índice no cambia ni una decisión.
      const index = this.buildGradedCardIndex(cardsById, allowed);
      const map = await this.pptSetMapper.resolveForSets([set]);
      const providerSetId = map.get(set.id) ?? null;
      const res = await this.pptBulk.fetchGradedEstimatesForSet({
        set,
        providerSetId,
        grades: cfg.grades,
        minSampleCount: cfg.minSampleCount,
        sourceStat: cfg.sourceStat,
        // v1.50.3 (§4.38m.2) — GATE DE EVIDENCIA: el MISMO `freshnessDays` que aplica la lectura, pero
        // aplicado en la ESCRITURA contra la fecha de la ÚLTIMA VENTA del proveedor. Sin él, cada
        // corrida reescribía `capturedDate = hoy` sobre una mediana congelada y la cifra parecía fresca
        // PARA SIEMPRE: el feed rancio disfrazado de fresco por nuestro propio job.
        freshnessDays: cfg.freshnessDays,
        today,
      });
      result.sets += 1;
      // Insumos del VEREDICTO (§4.38h.1-quater). `cardsReturned` es el denominador del coste medido:
      // lo que el proveedor DEVOLVIÓ, que con `fetchAllInSet=true` puede ser el set entero y no nuestro
      // inventario — la premisa que hay que verificar con crédito real, no discutir.
      if (res.probe) {
        ev.probe = true;
        result.probe = true;
        probedSets += 1;
      }
      if (res.requestOk) ev.requestOk = true;
      ev.cardsReturned += res.fetchedRaw;
      if (ev.creditsBefore == null) ev.creditsBefore = res.dailyRemainingBefore;
      if (res.dailyRemaining != null) ev.creditsAfter = res.dailyRemaining;
      result.unrecognized += res.drops.filter((d) => d.reason === 'unrecognized_shape').length;
      result.skippedSample += res.drops.filter((d) => d.reason === 'sample_too_small').length;
      result.skippedEvidence += res.drops.filter(
        (d) => d.reason === 'evidence_too_old' || d.reason === 'evidence_unknown',
      ).length;
      // Contador PROPIO (§4.38h.1-bis): NO se suma a `skippedSample` ni a `skippedEvidence`. Fundirlos
      // haría invisible la única señal que dice «este proveedor no sirve para la fase 2».
      result.skippedShapeS2 += res.drops.filter((d) => d.reason === 'shape_not_persistible_s2').length;
      shapeCounts.s1 += res.shapeCounts.s1;
      shapeCounts.s2 += res.shapeCounts.s2;
      if (res.forcedFormat !== 'auto') forcedFormatSeen = res.forcedFormat;

      if (res.sawGradedBlock) anySetSawGradedBlock = true;

      // ⚠️ AMBIGÜEDAD SILENCIOSA — se evalúa a escala de CORRIDA, no de set (v1.50.2, techlead).
      //
      // Antes, el primer set que devolvía entradas sin bloque PSA PARABA la corrida entera. La condición
      // es ambigua por naturaleza («no hay ventas PSA de este set» vs «el proveedor ignoró includeEbay»)
      // —eso no cambió—, pero la CONSECUENCIA estaba mal calibrada: **un set sin ventas PSA es un estado
      // de datos normal**, así que un set inocente abortaba el run habiendo gastado ya sus créditos, y
      // encima le entregaba al arquitecto un veredicto que la evidencia no sostenía.
      //
      // La ambigüedad es real solo si NINGÚN set del run vio el bloque. En cuanto uno lo ve, el shape
      // queda CONFIRMADO y los demás son un `skip` con traza. Por eso aquí solo se acumula.
      if (res.escalate?.reason === 'no_graded_block_in_response') {
        result.skippedNoGradedBlock += 1;
        setsWithoutGradedBlock.push({ setExternalId: set.externalId, detail: res.escalate.detail });
        this.logger.warn(
          `graded-estimate-ingest: set ${set.externalId} devolvió entradas SIN bloque PSA → se SALTA ` +
            '(un set sin ventas PSA es normal). Si NINGÚN set del run lo trae, se escala al cierre.',
        );
        await this.auditGradedSkip('graded_estimate.ingest.skipped', null, {
          setExternalId: set.externalId,
          reason: 'no_graded_block_in_response',
          detail: res.escalate.detail,
        });
        continue;
      }

      // ⛔ ESCALADA DURA — se PARA y se devuelve; no se intenta ninguna vía alternativa. Aquí el
      // proveedor RECHAZÓ el parámetro (no es ambiguo: lo dijo con un 4xx), así que seguir barriendo
      // solo quemaría créditos para obtener el mismo rechazo set tras set.
      if (res.escalate) {
        result.escalation = res.escalate;
        this.logger.error(
          `⛔ graded-estimate-ingest ESCALADA AL ARQUITECTO (regla 9, §4.38h.4): ${res.escalate.reason}. ` +
            `${res.escalate.detail} — el job PARA. NO se implementa el modo «una petición por carta»: ` +
            'cambia el modelo de coste (2 créditos × carta) y obliga a un ingest CURADO POR LISTA, que ' +
            'es decisión de arquitectura y de presupuesto.',
        );
        await this.auditGradedSkip('graded_estimate.ingest.escalated', null, {
          setExternalId: set.externalId,
          ...res.escalate,
        });
        // El veredicto se emite TAMBIÉN aquí: ésta es la salida en la que el dueño más necesita leer,
        // sin bucear, qué pasó y que la decisión es del arquitecto.
        return this.emitGradedVerdict(result, ev, shapeCounts, forcedFormatSeen);
      }

      // La traza de los DESCARTES del parser es obligatoria: sin ella, el descarte por muestra baja es
      // invisible para el operador (la fila sencillamente no existe y el preview dice `NO_PSA10`).
      for (const d of res.drops) {
        this.logger.warn(
          d.reason === 'shape_not_persistible_s2'
            ? // (§4.38h.1-bis) — este motivo NO es «una carta menos»: es la señal de que el proveedor
              // no está dando lo que la fase 2 necesita. Se nombra distinto en el log para que no se
              // lea como un descarte de rutina cuando alguien greppee la corrida.
              `graded-estimate-ingest: SHAPE NO PERSISTIBLE (S2, gradedPrices escalar) set=` +
                `${set.externalId} card=${d.externalId ?? 'n/d'} — el escalar no trae count ni fecha ` +
                'de última venta, así que NO puede pasar el gate de confianza por construcción. ' +
                `NO se escribe. muestra=${d.sample}`
            : `graded-estimate-ingest: DESCARTADA entrada (${d.reason}) set=${set.externalId} ` +
                `card=${d.externalId ?? 'n/d'} count=${d.count ?? 'DESCONOCIDO'} muestra=${d.sample}`,
        );
        await this.auditGradedSkip('graded_estimate.ingest.skipped', null, {
          setExternalId: set.externalId,
          providerCardId: d.externalId,
          reason: d.reason,
          count: d.count,
          sample: d.sample,
        });
      }

      for (const row of res.rows) {
        // BE-GE3: resolución EN MEMORIA — cero queries dentro del bucle (antes: 1-3 por fila).
        const cardId = resolveGradedCardId(index, row.externalId, row.number, (n, matches) =>
          this.logger.warn(
            `graded-estimate-ingest: el número "${n}" del proveedor casa con ${matches} cartas del set ` +
              `${set.externalId} → se OMITE (no se adivina la carta).`,
          ),
        );
        if (!cardId || !allowed.has(cardId)) continue; // fuera del alcance publicado ⇒ no se escribe.
        // INV-D: con slab publicado de ese grado, esa fila es DINERO de una pieza real.
        if ((slabsByCard.get(cardId) ?? []).includes(row.gradeValue)) {
          result.skippedSlabPublished += 1;
          this.logger.warn(
            `graded-estimate-ingest: SALTADA card=${cardId} PSA ${row.gradeValue} — hay slab PUBLICADO ` +
              'de ese grado (INV-D, §4.38l): esa fila es su precio de mercado REAL, no un estimado.',
          );
          await this.auditGradedSkip('graded_estimate.ingest.skipped', cardId, {
            reason: 'slab_published',
            gradeValue: row.gradeValue,
          });
          continue;
        }
        // INV-FX: `currency` viaja tal cual del proveedor; el escritor decide dónde cae el numeral.
        const wrote = await this.pricing.persistGradedEstimateReference(
          cardId,
          row.gradeValue,
          { amountCents: row.amountCents, currency: row.currency, source: 'pokemonpricetracker' },
          fx,
        );
        if (wrote) result.written += 1;
        // El escritor NO pisó la fila del día. Dos motivos posibles, ambos «hay algo mejor ahí y no se
        // toca»: (a) override MANUAL (§O.6) — el caso normal —, y desde v1.50.3-f (M-43, §4.38l.4.3
        // regla 2) (b) la fila ya es `refKind='market'`, o sea DINERO de una pieza real, que el ingest
        // jamás degrada a estimado. El contador se comparte a propósito: es «saltadas por respetar lo
        // que ya había», y el motivo exacto queda en la traza del escritor (warn con card/grado). (b)
        // es hoy inalcanzable —no existe escritor automático de mercado `graded` (§4.38l.4.6, candado
        // 4) y toda captura humana con `intent:"market"` deja `isManualOverride=true`, que cae en (a).
        else result.skippedManual += 1;
      }

      if (res.dailyLimited) {
        result.dailyLimited = true;
        this.logger.warn('graded-estimate-ingest: 429 DAILY → PARADA (lo ya escrito se conserva).');
        break;
      }
    }

    // ⛔ ESCALADA SILENCIOSA — el veredicto se emite AQUÍ, con la corrida entera delante.
    //
    // La regla: se escala **solo si NINGÚN set del run vio bloque PSA**. Ése es el único estado en que
    // «el proveedor ignoró includeEbay» y «ninguno de estos sets tiene ventas PSA» son de verdad
    // indistinguibles, y por tanto el único en que la decisión le toca a un humano. Si al menos un set
    // lo vio, el shape está CONFIRMADO por observación y los sets sin bloque quedan como `skip` con
    // traza (ya auditados arriba, uno por uno). Es la diferencia entre un veredicto que la evidencia
    // sostiene y uno que dispara un rediseño de arquitectura y presupuesto sin motivo.
    if (!anySetSawGradedBlock && setsWithoutGradedBlock.length > 0) {
      result.escalation = {
        reason: 'no_graded_block_in_response',
        detail:
          `NINGUNO de los ${setsWithoutGradedBlock.length} set(s) barridos con includeEbay=true trajo un ` +
          'bloque PSA reconocible en toda la corrida. Con cero observaciones positivas no se puede ' +
          'distinguir «estos sets no tienen ventas PSA» de «el proveedor IGNORÓ el parámetro». Sets: ' +
          `${setsWithoutGradedBlock.map((x) => x.setExternalId).join(', ')}. Muestra del primero: ` +
          `${setsWithoutGradedBlock[0].detail}`,
      };
      this.logger.error(
        `⛔ graded-estimate-ingest ESCALADA AL ARQUITECTO (regla 9, §4.38h.4): ${result.escalation.reason}. ` +
          `${result.escalation.detail}`,
      );
      await this.auditGradedSkip('graded_estimate.ingest.escalated', null, {
        ...result.escalation,
        setsWithoutGradedBlock: setsWithoutGradedBlock.map((x) => x.setExternalId),
      });
    }

    // ⛔ ESCALADA POR SHAPE (v1.50.3-a, §4.38h.1-bis) — «PPT sirve mayoritariamente S2».
    //
    // Qué significa y por qué NO se parchea aquí: `gradedPrices.psaN` es un ESCALAR y por construcción
    // no trae ni `count` ni fecha de última venta, o sea **ninguna** de las dos piezas de evidencia con
    // las que se calculan las pruebas 1 y 2 del gate de confianza (§O.7). No es un S1 degradado que se
    // arregle con un dial: **no hay nada que configurar**. Si es lo que el proveedor sirve de forma
    // dominante, lo que el hallazgo dice no es «hay un bug» sino **«la fase 2 no es viable con este
    // proveedor»**, y elegir entre degradar a manual de forma permanente, buscar un segundo proveedor o
    // pagar el plan que exponga `salesByGrade` es decisión de **producto y de costo** ⇒ vuelve al
    // ARQUITECTO (regla 9). Diseñar el parche antes de tener la evidencia sería reincidir en P-6.
    //
    // **No hay acantilado detrás**: la degradación a manual ya está diseñada, aceptada y funcionando
    // (es el estado de v1.50). No se pierde la feature, se pierde su AUTOMATIZACIÓN — por eso el job no
    // aborta ni destruye nada: deja el veredicto, con la cuenta que lo sostiene, y sigue.
    //
    // El umbral de la vía (B) es **mayoría estricta** (`s2 > s1`) y no «≥ 1 carta con S2», por la misma
    // lección que dejó el 401/403 tratado como «no admite el parámetro»: una escalada dispara una
    // decisión de arquitectura y de presupuesto, así que **tiene que poder sostener su veredicto**. Una
    // carta suelta en S2 conviviendo con S1 mayoritario no es un cambio de shape del proveedor; queda
    // contada en `skippedShapeS2` y auditada carta por carta, que es donde se ve.
    //
    // ── v1.50.3-c (techlead) — DOS FORMAS DE AUTOINDUCIR EL VEREDICTO, ambas cerradas ──────────────
    // Mismo criterio declarado («una escalada tiene que poder sostener su veredicto»), aplicado a la
    // corrida entera y no solo al umbral:
    //
    //  (a) **Formato FORZADO por el operador.** Con `POKEMONPRICETRACKER_GRADED_FORMAT=graded_prices`,
    //      `parseGradedEntry` fija `useS1 = false` y TODA carta con bloque `gradedPrices` se cuenta
    //      como S2 — aunque la misma entrada traiga `ebay.salesByGrade` perfectamente persistible. El
    //      conteo resultante no habla del proveedor: habla de **lo que nosotros le pedimos mirar**, y
    //      §4.38h.1-bis declara ese forzado explícitamente LEGAL (es la vía para inspeccionar un shape).
    //      Escalar ahí es el mismo falso positivo que el `jsonb` reordenado del inventario: gritar por
    //      algo que hicimos nosotros. ⇒ con `forcedFormat !== 'auto'` **no se escala**; se deja `warn`
    //      con el conteo, para que el operador vea que su override es lo que está tapando la señal.
    //  (b) **Sin SUELO DE MUESTRA, `1 > 0` satisface la mayoría estricta.** Una corrida con UNA sola
    //      carta con bloque PSA bastaba para disparar una decisión de arquitectura y presupuesto. Con
    //      el alcance acotado por diseño (curaduría manual en fase 1, `ingestMaxCardsPerRun` por
    //      corrida) los denominadores diminutos son **normales**, no excepcionales. El suelo no
    //      pretende dar significancia estadística —para eso haría falta un muestreo que este job no
    //      hace—, solo evitar que el ruido de una o dos observaciones se presente como el shape
    //      dominante del proveedor. Por debajo del suelo **se informa y no se escala**: la evidencia no
    //      se pierde, se acumula en el log y en `skippedShapeS2`, y la siguiente corrida con más cartas
    //      la sostendrá o la desmentirá.
    //
    // En los dos casos el job hace exactamente lo mismo que antes con las cartas (S2 sigue siendo NO
    // PERSISTIBLE y se sigue saltando carta por carta): lo único que cambia es que **no se emite un
    // veredicto que la evidencia no sostiene**.
    //
    // ── v1.50.3-c (ARQUITECTO, §4.38h.1-ter / GU-A25) — el suelo de (b) se AJUSTA, y hay una vía (A) ──
    // El arquitecto ratificó la exigencia de muestra mínima y **corrigió su forma**: un suelo ABSOLUTO
    // de 5 era él mismo un aviso inalcanzable (ver el bloque de `shapeFloor`, abajo). Queda:
    //   (A) `s1 == 0 && s2 >= 1`  ⇒ escala SIEMPRE, sin suelo.
    //   (B) `s2 > s1`             ⇒ escala con suelo `min(5, cartas en alcance de la corrida)`.
    // La guarda del formato forzado (a) **se mantiene y aplica a las dos vías**: un conteo inducido por
    // nuestro propio override no es evidencia sobre el proveedor, venga por (A) o por (B) — con
    // `GRADED_FORMAT=graded_prices` el «cero S1» es literalmente lo que ordenamos que pasara.
    const shapeObservations = shapeCounts.s1 + shapeCounts.s2;
    const shapeVerdictInduced = forcedFormatSeen !== 'auto';
    // ⚠️ SUELO **RELATIVO** (§4.38h.1-ter, GU-A25). El suelo absoluto de 5 que propuse tenía **el mismo
    // bug que acabábamos de arreglar con `STALE`**: un aviso INALCANZABLE. El alcance del ingest es
    // «solo cartas con inventario publicado» (§4.38h.3), así que una tienda con **3 cartas** en las que
    // las 3 devuelvan S2 nunca llegaría a 5 ⇒ la fase 2 quedaría muerta **en silencio**, con su propio
    // detector apagado. `min(5, cartasDeLaCorrida)` deja al 5 gobernando la operación normal (catálogo
    // real) y le quita la capacidad de **bloquear el aviso** justo donde más desapercibido pasaría.
    //
    // El denominador del suelo es `cardsInScope` —las cartas que la corrida MIRÓ— y no `shapeObservations`
    // (las que trajeron bloque PSA): con `min(5, observadas)` la condición sería `observadas >= observadas`,
    // o sea siempre verdadera, y el suelo no existiría. El suelo tiene que hablar del TAMAÑO DE LA CORRIDA.
    const shapeFloor = Math.min(GRADED_SHAPE_ESCALATION_MIN_CARDS, result.cardsInScope);
    // (A) NUNCA hemos visto un S1 ⇒ escala **sin suelo**. «Cero S1» es cualitativamente distinto de «una
    //     mezcla en la que S2 gana»: sugiere que el campo que necesitamos **no existe en este plan o en
    //     esta cuenta**, y ahí una sola observación ya es informativa. El coste de escalar de más es una
    //     conversación; el de no escalar es una feature muerta sin que nadie se entere.
    const neverSawS1 = shapeCounts.s1 === 0 && shapeCounts.s2 >= 1;
    // (B) MAYORÍA ESTRICTA con suelo relativo. Sin porcentajes mágicos: el criterio es «S2 gana».
    const s2DominantWithFloor = shapeCounts.s2 > shapeCounts.s1 && shapeObservations >= shapeFloor;
    const shapeTriggered = neverSawS1 || s2DominantWithFloor;
    if (!result.escalation && shapeCounts.s2 > shapeCounts.s1 && (shapeVerdictInduced || !shapeTriggered)) {
      this.logger.warn(
        `graded-estimate-ingest: S2 mayoritario (${shapeCounts.s2} S2 / ${shapeCounts.s1} S1 sobre ` +
          `${shapeObservations} carta(s) con bloque PSA, ${result.cardsInScope} en alcance) pero NO se ` +
          'escala — ' +
          (shapeVerdictInduced
            ? `la corrida fue con POKEMONPRICETRACKER_GRADED_FORMAT="${forcedFormatSeen}" (formato ` +
              'FORZADO, §4.38h.1-bis): el conteo refleja lo que le pedimos mirar al proveedor, no lo ' +
              'que sirve, así que no puede sostener «la fase 2 no es viable». Vuelve a correr con ' +
              'GRADED_FORMAT=auto para obtener un veredicto sobre el PROVEEDOR.'
            : `la corrida vio ${shapeObservations} carta(s) con bloque PSA y el suelo de esta corrida ` +
              `es ${shapeFloor} (= min(${GRADED_SHAPE_ESCALATION_MIN_CARDS}, ${result.cardsInScope} en ` +
              'alcance)): una mayoría sobre un denominador diminuto no sostiene una decisión de ' +
              'arquitectura y presupuesto. Amplía el alcance (más inventario publicado / ' +
              'graded_estimate_ingest_max_cards_per_run) y vuelve a correr.') +
          ' Las cartas S2 se siguieron saltando como NO PERSISTIBLES (skippedShapeS2), nada se escribió.',
      );
    }
    if (!result.escalation && shapeTriggered && !shapeVerdictInduced) {
      result.escalation = {
        reason: 'shape_not_persistible_s2_dominant',
        detail:
          `De las ${shapeObservations} carta(s) con bloque PSA en esta corrida, ` +
          `${shapeCounts.s2} vinieron en el shape S2 (gradedPrices.psaN, ESCALAR) y solo ` +
          `${shapeCounts.s1} en S1 (ebay.salesByGrade.psaN). S2 está declarado NO PERSISTIBLE ` +
          '(§4.38h.1-bis): el escalar no trae `count` ni fecha de última venta, así que es ' +
          'ESTRUCTURALMENTE incapaz de pasar las pruebas 1 y 2 del gate de confianza y ninguna ' +
          'configuración lo arregla. Si esto se sostiene, la fase 2 NO es viable con este proveedor. ' +
          // La procedencia del veredicto viaja CON el veredicto: quien lo reciba tiene que poder ver,
          // sin abrir el log, POR QUÉ vía se disparó y que el conteo es una observación (formato
          // `auto`), no un eco de un override nuestro. Las dos vías piden lecturas distintas: (A) dice
          // «el campo puede que no exista en este plan»; (B) dice «lo hay, pero domina el malo».
          `Evidencia: GRADED_FORMAT=auto (autodetección, sin override) y ` +
          (neverSawS1
            ? `CERO observaciones S1 en toda la corrida (regla A, §4.38h.1-ter): no se escala por ` +
              'mayoría sino porque **nunca hemos visto el shape bueno**, lo que sugiere que ' +
              '`ebay.salesByGrade` no existe en este plan/cuenta. Una sola observación basta aquí.'
            : `${shapeObservations} observación(es) ≥ el suelo de ${shapeFloor} (regla B, ` +
              `§4.38h.1-ter = min(${GRADED_SHAPE_ESCALATION_MIN_CARDS}, ${result.cardsInScope} ` +
              'carta(s) en alcance)).'),
      };
      this.logger.error(
        `⛔ graded-estimate-ingest ESCALADA AL ARQUITECTO (regla 9, §4.38h.1-bis): ` +
          `${result.escalation.detail} — NO se improvisa (ni escotilla, ni dial nuevo, ni «escribimos ` +
          'con count inventado»): la decisión (degradar a manual de forma permanente, buscar otro ' +
          'proveedor o pagar el plan que exponga salesByGrade) es de PRODUCTO y de COSTO. Mientras ' +
          'tanto la feature sigue viva por la vía MANUAL, que es el estado de v1.50 y funciona.',
      );
      await this.auditGradedSkip('graded_estimate.ingest.escalated', null, {
        ...result.escalation,
        shapeCounts,
        shapeObservations,
        forcedFormat: forcedFormatSeen,
        // El SUELO EFECTIVO de esta corrida (no la constante), la vía que disparó y el alcance: es lo
        // que hace auditable el veredicto meses después, cuando `cardsInScope` ya sea otro.
        shapeFloor,
        cardsInScope: result.cardsInScope,
        rule: neverSawS1 ? 'A_no_s1_observed' : 'B_s2_majority',
      });
    }

    this.logger.log(
      `graded-estimate-ingest: ${result.sets} set(s), ${result.cardsInScope} carta(s) en alcance, ` +
        `${result.written} referencia(s) escritas, ${result.skippedManual} respetando override manual, ` +
        `${result.skippedSlabPublished} con slab publicado, ${result.skippedSample} por muestra ` +
        `insuficiente, ${result.skippedEvidence} por evidencia vieja/desconocida, ` +
        // Los tres motivos van SEPARADOS en la misma línea a propósito (§4.38h.4): cada uno pide una
        // reacción distinta, y un total de «saltadas» los volvería indistinguibles.
        `${result.skippedShapeS2} en shape S2 NO PERSISTIBLE (shapes vistos: ${shapeCounts.s1} S1 / ` +
        `${shapeCounts.s2} S2), ${result.unrecognized} con forma no reconocida, ` +
        `${result.skippedNoGradedBlock} set(s) sin bloque PSA.`,
    );
    return this.emitGradedVerdict(result, ev, shapeCounts, forcedFormatSeen);
  }

  /**
   * v1.50.3-g (§4.38h.1-quater) — **imprime EL VEREDICTO de la fase 2 y lo devuelve en el resultado.**
   *
   * Por qué existe como paso propio y se llama en TODAS las salidas (incluidas las tempranas): la línea
   * de resumen ya existía (`shapes vistos: N S1 / M S2`), pero para saber si eso significa «la fase 2
   * funciona» había que conocer §4.38h.1-bis de memoria y encontrar la línea entre ~2 000 del barrido de
   * precios. Un dato que hay que interpretar con el diseño delante no es un veredicto. Aquí se emite la
   * CONCLUSIÓN —qué shape llegó, cuántas cartas, qué significa en una frase y qué hacer— bajo una marca
   * fija: `grep "VEREDICTO-PSA"` (ver `GRADED_VERDICT_TAG`).
   *
   * El NIVEL de log es parte del mensaje: `error` cuando la fase 2 no es viable (hay una decisión humana
   * pendiente), `warn` cuando no se pudo concluir, `log` cuando funciona. Así el veredicto también se ve
   * en un dashboard que solo muestre errores.
   */
  private emitGradedVerdict(
    result: GradedIngestResult,
    ev: { probe: boolean; requestOk: boolean; cardsReturned: number; creditsBefore: number | null; creditsAfter: number | null },
    shapeCounts: { s1: number; s2: number },
    forcedFormat: GradedFormat,
  ): GradedIngestResult {
    const report = gradedPhase2Verdict({
      probe: ev.probe,
      enabled: result.enabled,
      requestOk: ev.requestOk,
      sets: result.sets,
      cardsInScope: result.cardsInScope,
      cardsReturned: ev.cardsReturned,
      shapeCounts,
      written: result.written,
      dailyLimited: result.dailyLimited,
      escalationReason: result.escalation?.reason ?? null,
      forcedFormat,
      creditsBefore: ev.creditsBefore,
      creditsAfter: ev.creditsAfter,
    });
    result.verdict = report.verdict;
    for (const line of report.lines) {
      if (report.verdict === 'NO_VIABLE') this.logger.error(line);
      else if (report.verdict === 'INDETERMINADO') this.logger.warn(line);
      else this.logger.log(line);
    }
    return result;
  }

  /**
   * BE-GE3 (v1.50.2, techlead) — índice EN MEMORIA para resolver carta↔fila del proveedor **sin tocar
   * la BD dentro del bucle del ingest**.
   *
   * Mismas dos claves que `resolveCardId` (`externalId` primario, `number` fallback) y la misma regla
   * de desempate por variantes de número (`cardNumberVariants`): una sola coincidencia resuelve, dos o
   * más **se omiten** (no se adivina la carta). Lo único que cambia es de dónde sale la respuesta.
   */
  private buildGradedCardIndex(
    cardsById: Map<string, { id: string; externalId: string | null; number: string | null }>,
    allowed: Set<string>,
  ): GradedCardIndex {
    const byExternalId = new Map<string, string>();
    const byNumber = new Map<string, string[]>();
    for (const id of allowed) {
      const c = cardsById.get(id);
      if (!c) continue;
      if (c.externalId) byExternalId.set(c.externalId, c.id);
      if (c.number) {
        const arr = byNumber.get(c.number);
        if (arr) arr.push(c.id);
        else byNumber.set(c.number, [c.id]);
      }
    }
    return { byExternalId, byNumber };
  }

  /** Traza obligatoria en `AuditLog` (§4.38h.4). Nunca revienta el job por un fallo de bitácora. */
  private async auditGradedSkip(
    action: string,
    cardId: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.audit) return;
    try {
      await this.audit.log({
        action,
        entityType: 'PriceReference',
        ...(cardId ? { entityId: cardId } : {}),
        after: payload,
      });
    } catch (e) {
      this.logger.warn(`graded-estimate-ingest: no se pudo escribir la bitácora: ${(e as Error).message}`);
    }
  }

  private emptyResult(setId: string, externalId: string | null, provider: string): IngestSetResult {
    return { setId, setExternalId: externalId, provider, cardCount: 0, priced: 0, unresolved: 0, skipped: 0 };
  }
}
