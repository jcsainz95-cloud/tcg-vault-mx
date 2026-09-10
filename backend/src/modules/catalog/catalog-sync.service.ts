import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { ErrorCode } from '../../common/error-codes';
import {
  SetSweepTally,
  deprecatedSetsOk,
  emptySetSweepTally,
  recordSweepAttempt,
  recordSweepFailure,
} from './set-sweep-tally';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { PokemonTcgIoClient, RemoteCard, RemoteCardSet } from './pokemontcg-io.client';
import { yearFromReleaseDate } from './catalog.service';
import { deriveAvailableFinishes } from '../pricing/pricing.types';
import { deriveNumberParts } from '../../common/card-order';
import { normalizeRarity, isRarityMapped } from '../../common/rarity-catalog';
import { FinishReconciler } from './finish-reconciler.service';
import { CardProductResolverService } from './card-product-resolver.service';

/** Guardarraíl anti-inyección del `setId` antes de interpolarlo en `q=set.id:<setId>`. */
export const SET_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * D1 (v1.64) — RESULTADO REAL de importar UN set. Tres hechos DISTINTOS que antes viajaban
 * fundidos en un `imported: true` **literal** (`importSet`/`importSetByExternalId` lo devolvían
 * escrito a mano, así que el llamador contaba «1 set importado» hubiera importado uno, ninguno o
 * nada en absoluto; la pantalla de M2 lo pintaba en verde igual).
 *
 * Los tres hechos, y por qué NO son el mismo:
 *  - **`imported`** — el set NO tenía ninguna carta local antes de esta corrida y ahora sí.
 *    Es «cuántos sets importé».
 *  - **`refreshed`** — el set YA tenía cartas; esta corrida las re-upserteó (re-sync). NO es un
 *    import: es «cuántos ya estaban».
 *  - **`noop`** — esta corrida no escribió NINGUNA carta (el remoto no devolvió datos). No se
 *    importó ni se refrescó nada; contarlo como cualquiera de los dos anteriores es la mentira
 *    exacta que motivó D1.
 *
 * `cardsUpserted` es lo que ESTA corrida escribió (no lo que hay en el set). `cardsBefore` es el
 * universo previo, y es `null` cuando no se llegó a consultar (ausente ⇒ «—»; nunca un 0 de
 * relleno, misma norma que los precios sin mercado).
 */
export type SetImportOutcome = {
  outcome: 'imported' | 'refreshed' | 'noop';
  cardsUpserted: number;
  cardsBefore: number | null;
};

/** Conteo agregado de una corrida de import sobre N sets (D1). Sin literales: todo se cuenta. */
export type SetImportTally = {
  /**
   * ⭐ sets en los que esta corrida escribió cartas. **«Cuántos toqué», con el ÚNICO nombre que
   * §M2-CS.0 permite para ese hecho.** Existe para que la fórmula viva en UN sitio: antes se
   * recalculaba a mano como `setsImported + setsRefreshed` en tres llamadores distintos.
   */
  setsWritten: number;
  /** desglose de `setsWritten` — sets que NO tenían cartas y ahora sí (import nuevo REAL). */
  setsImported: number;
  /** desglose de `setsWritten` — sets que YA estaban (con cartas) y se re-upsertearon. */
  setsRefreshed: number;
  /** sets en los que esta corrida no escribió ninguna carta. */
  setsNoop: number;
  /** cartas escritas por ESTA corrida (≠ cartas que existen en los sets). */
  cardsUpserted: number;
};

/**
 * ⭐ PREDICADO «¿ESTE SET ENTRA POR FECHA?» — el corte del catálogo (`catalog_sync_from_date`,
 * dial editable en M10). FUENTE ÚNICA del criterio: lo llaman `sync()` (modo from_date) y
 * `syncAll()`. No se copia la comparación en ningún otro sitio (§0-B.3 regla 8 llevada al código:
 * el día que el corte deje de ser «>= por string» hay UNA línea que cambiar, no dos que se
 * desincronizan en silencio).
 *
 * Detalle que NO es accidental: un set **sin `releaseDate`** queda FUERA (`'' >= '2024/01/01'` es
 * falso). Es el comportamiento que `sync()` ya tenía; no se adivina una fecha para colar un set de
 * fecha desconocida. Para lo viejo o lo sin fecha está `backfill` (explícito, por lotes).
 *
 * El formato `yyyy/MM/dd` hace que la comparación lexicográfica sea la cronológica — por eso se
 * compara como string y no se parsea (mismo formato en que lo emite pokemontcg.io y en que lo
 * valida el dial).
 */
export function isWithinCatalogFromDate(
  set: { releaseDate?: string | null },
  fromReleaseDate: string,
): boolean {
  return (set.releaseDate ?? '') >= fromReleaseDate;
}

/**
 * ⭐ PREDICADO «¿ESTE SET ENTRA AL BARRIDO `sync-all`?» — fuente ÚNICA de la selección del barrido
 * (D3). Reúne en un solo sitio las dos preguntas que antes vivían sueltas en `syncAll()`:
 * «¿ya lo tengo?» y «¿cae dentro del corte?».
 *
 * Reglas, y por qué cada una:
 *  - **Set NUEVO (sin cartas locales) dentro del corte ⇒ ENTRA.** Es literalmente el botón
 *    «Importar sets nuevos» de M2.
 *  - **Set NUEVO fuera del corte ⇒ NO ENTRA** (`outOfRange`). Es el arreglo de D3: antes el
 *    barrido se traía *todo* lo que faltara, de cualquier año. La vía para lo viejo sigue siendo
 *    `backfill` (explícita, por lotes, con `untilYear`).
 *  - **Set YA IMPORTADO con `force` ⇒ ENTRA, sin mirar el corte.** `force` NO es «importar»: es
 *    **reparar lo que ya tenemos** (re-upsert de metadata + resolver estructural TCGCSV). Aplicarle
 *    el corte encogería la reparación justo donde más falta hace —los sets viejos son los del
 *    `normal` fantasma— y un set ya importado no puede «traer catálogo viejo»: ya está aquí.
 *    Lo que `force` deja de hacer es arrastrar sets viejos que NO teníamos, que era el susto real.
 *  - **Set YA IMPORTADO sin `force` ⇒ NO ENTRA** (comportamiento de siempre: no reprocesar).
 */
export function selectSyncAllCandidates(
  remote: RemoteCardSet[],
  opts: { importedWithCards: ReadonlySet<string>; force: boolean; fromReleaseDate: string },
): { queue: RemoteCardSet[]; outOfRange: RemoteCardSet[]; unknownDate: RemoteCardSet[] } {
  const queue: RemoteCardSet[] = [];
  const outOfRange: RemoteCardSet[] = [];
  const unknownDate: RemoteCardSet[] = [];
  for (const s of remote) {
    const alreadyImported = opts.importedWithCards.has(s.id);
    if (alreadyImported) {
      if (opts.force) queue.push(s); // reparación de lo que YA tenemos: el corte no aplica
      continue;
    }
    // Set SIN `releaseDate`: NO se decide aquí qué hacer con él (nadie lo ha decidido). Lo único
    // que cambia respecto de antes es que deja de ser INVISIBLE: sale en su propio cubo y el
    // llamador lo reporta y lo loguea. Sigue quedando fuera del barrido, como hasta hoy.
    if (s.releaseDate == null || s.releaseDate === '') {
      unknownDate.push(s);
      continue;
    }
    if (isWithinCatalogFromDate(s, opts.fromReleaseDate)) queue.push(s);
    else outOfRange.push(s); // set nuevo pero anterior al corte ⇒ es trabajo de `backfill`
  }
  return { queue, outOfRange, unknownDate };
}

/**
 * Resumen agregado de un barrido `sync-all` (lo lee `GET /admin/catalog/sync-status`).
 *
 * El **reparto** (`setsTotal`/`setsWritten`/`setsNoop`/`setsFailed`/`failures`) NO se declara aquí:
 * se hereda de `SetSweepTally`, la fuente única de §M2-CS.0 que comparte con `refresh-variants-all`.
 * Lo propio de este barrido son sus cifras de ESCRITURA —cartas—, el desglose de `setsWritten` y
 * las **cifras de SELECCIÓN** (§M2-CS.1).
 *
 * ⭐ **Las tres cifras de SELECCIÓN viven AQUÍ, no sueltas en el `202`.** §M2-CS.1 las declara
 * dentro de `summary` y dice por qué: *«la fuente canónica del registro de la corrida es este
 * `summary`»* — el `202` de `sync-all` las **hace eco** al arrancar, este objeto las guarda al
 * terminar; **un solo cálculo, dos momentos**. Emitirlas sólo en el `202` dejaba el registro de la
 * corrida sin el corte que la rigió: quien lee `sync-status` no podía saber **desde cuándo** se
 * barrió ni **qué quedó fuera**, que es justo lo que explica un `setsTotal: 0`.
 *
 * ⛔ **No son cifras de escritura** (§M2-CS.1): no abren la frase de un aviso (H3) y **no entran en
 * `setsTotal`** —esos sets nunca se encolaron—.
 */
export type SyncAllSummary = SetSweepTally & {
  /** desglose de `setsWritten` — set que NO tenía cartas y ahora sí (`I-CS5`). */
  setsImported: number;
  /** desglose de `setsWritten` — set que YA tenía cartas y se re-escribió (`I-CS5`). */
  setsRefreshed: number;
  /** cartas escritas por ESTA corrida (≠ cartas que existen en los sets). */
  cardsUpserted: number;
  /** SELECCIÓN — corte VIGENTE en esta corrida, `yyyy/MM/dd` (§M2-CS.4). */
  fromReleaseDate: string;
  /** SELECCIÓN — remotos descartados por el corte (para ésos: `backfill`). */
  setsSkippedOutOfRange: number;
  /** SELECCIÓN — remotos SIN `releaseDate`: no entran, pero **se cuentan** (§M2-CS.4). */
  setsSkippedUnknownDate: number;
};

/**
 * Las tres cifras de SELECCIÓN de una corrida, calculadas **una sola vez** en `syncAll()` y
 * emitidas en dos sitios: el `202` (eco, al arrancar) y `summary` (canónico, al terminar).
 * Que sea **un tipo** y no tres parámetros sueltos es lo que impide que los dos sitios se
 * desincronicen (§0-B.3 regla 8).
 */
export type SyncAllSelection = {
  fromReleaseDate: string;
  setsSkippedOutOfRange: number;
  setsSkippedUnknownDate: number;
};

/**
 * Resumen agregado de un barrido `refresh-variants-all` (lo lee
 * `GET /admin/catalog/refresh-variants-status`). §M2-CS.2.
 *
 * Mismo reparto que el hermano —heredado de `SetSweepTally`, no reescrito— y cifras de escritura
 * propias: `cardProductsUpserted`/`pricesUpserted` cuentan **variantes** y **precios**, no cartas.
 * ⛔ No se igualan con `cardsUpserted` del otro barrido: un nombre común para dos hechos distintos
 * es el error simétrico al de `setsOk` (§M2-CS.2).
 *
 * ⚠️ `setsOk` NO vive aquí: está DEPRECADO y se emite **derivado** en el getter
 * (`deprecatedSetsOk`), para que su significado congelado no pueda desviarse.
 */
export type RefreshVariantsSummary = SetSweepTally & {
  /** variantes (`CardProduct`) escritas por ESTA corrida. */
  cardProductsUpserted: number;
  /** precios de referencia escritos por ESTA corrida. */
  pricesUpserted: number;
  /**
   * variantes que quedaron SIN precio (TCGCSV no lo trajo) ⇒ «—»/`PRICE_PENDING`, jamás 0.
   * ⛔ NO entra al reparto de sets: cuenta **variantes**, no sets (§M2-CS.2). Dos unidades
   * distintas nunca comparten prefijo en este contrato.
   */
  pending: number;
};

/** Suma los resultados por-set en el agregado que se reporta al operador (D1). */
export function tallyImports(results: SetImportOutcome[]): SetImportTally {
  const tally: SetImportTally = {
    setsWritten: 0,
    setsImported: 0,
    setsRefreshed: 0,
    setsNoop: 0,
    cardsUpserted: 0,
  };
  for (const r of results) {
    if (r.outcome === 'imported') tally.setsImported += 1;
    else if (r.outcome === 'refreshed') tally.setsRefreshed += 1;
    else tally.setsNoop += 1;
    // `setsWritten` sale del MISMO predicado que usan los dos barridos («¿escribió algo?»), no de
    // una suma repetida en cada llamador. `I-CS5`: setsImported + setsRefreshed === setsWritten.
    if (r.outcome !== 'noop') tally.setsWritten += 1;
    tally.cardsUpserted += r.cardsUpserted;
  }
  return tally;
}
/** Formato de fecha de pokemontcg.io (`yyyy/MM/dd`). */
const DATE_PATTERN = /^\d{4}\/\d{2}\/\d{2}$/;
/**
 * v1.52-set-logos (M-47, §4.39.4) — CONJUNTO CERRADO de hosts admitidos para las imágenes de set.
 * v1.52-a (M47-H2, 2026-09-05): pasó de **un** host a **dos**. Lee esto antes de tocarlo.
 *
 * ## Por qué hay DOS hosts (evidencia, no afirmación)
 *
 * El proveedor **mudó su CDN de imágenes a mitad de catálogo**: los sets viejos siguen sirviéndose
 * desde `images.pokemontcg.io` y los nuevos llegan desde `images.scrydex.com`. Dos hechos duros:
 *
 *  1. **Log de producción (2026-09-05, 07:56–07:59)** — ocho líneas, logo y símbolo de los cuatro sets
 *     más recientes (`me2pt5`, `me3`, `me4`, `me5`), TODAS de esta misma función:
 *
 *         WARN [CatalogSyncService] upsertSet(me2pt5): images.logo fuera del guardarraíl
 *         https://images.pokemontcg.io (https://images.scrydex.com); NO se persiste (M-47, §4.39.4).
 *
 *     Es decir: el guardarraíl estaba haciendo su trabajo, pero contra un host **legítimo**, y por la
 *     regla «rechazada ≡ ausente» (§4.39.4) esos cuatro sets se quedaron **sin logo** en la retícula.
 *  2. **Conteo sobre la BD de producción** (`Card.imageSmallUrl`, agrupado por host):
 *
 *         images.pokemontcg.io | 19818
 *         images.scrydex.com   |   661
 *
 *     661 cartas de la tienda **ya sirven su arte desde `images.scrydex.com` hoy, en producción**, y las
 *     carga cada visitante. Entraron por `upsertCards`, que no valida NADA (deuda **M47-R1**). O sea: el
 *     host nuevo no es un dominio desconocido — es, de facto, el CDN vigente del proveedor. Admitirlo
 *     para los logos de set **no abre superficie nueva**: la iguala a la que el sitio ya tiene abierta.
 *
 * ## Cómo se añade un TERCER host el día que el proveedor vuelva a mudarse
 *
 * NO se «arregla» aflojando la comparación (ver abajo). El procedimiento es:
 *  1. **Evidencia primero.** El síntoma es exactamente el de arriba: `warn` «fuera del guardarraíl» con
 *     un host nuevo repetido en varios sets. Confirmarlo contra la BD (¿ese host ya sirve arte de carta
 *     en producción?, `SELECT split_part(split_part("imageSmallUrl",'//',2),'/',1), count(*) …`).
 *  2. **Se añade el host EXACTO a esta lista** (una línea), con la fecha y la evidencia en el comentario
 *     de la entrada. Nunca un dominio raíz, nunca un comodín.
 *  3. **Backend NO lo hace por su cuenta**: lo reporta al arquitecto, que decide (§4.39.7 describe el
 *     acoplamiento con `remotePatterns` del frontend, §5.3.4). `remotePatterns` se amplía DETRÁS del
 *     backend, nunca por delante.
 *  4. **Re-sync forzado** para repoblar los logos que la regla «rechazada ≡ ausente» dejó vacíos: este
 *     escritor está diseñado para no limpiar nunca, así que un host nuevo no repara nada por sí solo
 *     (deuda **M47-D1**).
 *
 * ## Lo que NO se puede relajar al ampliar (es la mitad del valor de este guardarraíl)
 *
 *  - **Conjunto CERRADO, comparación por host EXACTO** (`Set.has`), **NO** una allowlist de dominios raíz
 *    con comodín de subdominio. Verificado por MUTACIÓN (se mutó, se corrió la suite, se revirtió):
 *      · `has` → `includes` o `startsWith` ⇒ pasa `images.pokemontcg.io.evil.com` (sufijo que controla
 *        el ATACANTE). Ponen en rojo el vector `subdominio parecido`, que existe desde M-47.
 *      · `has` → `endsWith` (o allowlist de dominio raíz) ⇒ pasa `cdn.images.pokemontcg.io`: cualquier
 *        subdominio que el proveedor —o quien tome uno suyo— levante, sin que nadie verifique ese
 *        endpoint. Pone en rojo el vector `subdominio del host admitido`.
 *    Las tres formas de «aflojar» están cubiertas por tests; ninguna es un atajo aceptable para admitir
 *    un host nuevo. Para eso está el procedimiento de arriba.
 *  - **`host`, no `hostname`**: incluye el puerto. Como las entradas no lo llevan, solo empatan con el
 *    puerto https por defecto (el WHATWG URL elide `:443`); `images.scrydex.com:8443` es OTRO endpoint.
 *  - **`https:` obligatorio**, **userinfo rechazado**, y se persiste **`parsed.href`** (normalizado).
 *
 * Cada entrada, con su procedencia:
 */
export const SET_IMAGE_HOSTS: ReadonlySet<string> = new Set([
  // CDN histórico: sirve el arte de ~19 818 cartas y los logos de todos los sets hasta 2026-08.
  'images.pokemontcg.io',
  // CDN vigente desde 2026-09 (sets `me2pt5`/`me3`/`me4`/`me5` en adelante). Ya servía el arte de 661
  // cartas EN PRODUCCIÓN antes de admitirse aquí — ver evidencia (2) arriba.
  'images.scrydex.com',
]);

/** Forma legible del conjunto para el `warn` de rechazo (M47-D1: estos logs son contrato operativo). */
const SET_IMAGE_HOSTS_LABEL = [...SET_IMAGE_HOSTS].map((h) => `https://${h}`).join(' | ');

/**
 * CatalogSyncService — Ingesta de METADATA de catálogo desde pokemontcg.io (M2, ARCHITECTURE §4.8).
 * super_admin, auditado (el controller registra en AuditLog). Upsert idempotente por `externalId`.
 * `Card.rarity` se persiste como String libre (taxonomía abierta → captura rarezas modernas).
 *
 * WS-A (v1.14-price-ingest, §4.15g / DEV-5): `catalog-sync` vuelve a ser **SOLO metadata**
 * (nombres/imágenes/sets/números/rareza + import de sets nuevos). Se **quitó** el poblado de
 * `PriceReference` (`persistMarketReferences`) y las deps `PricingService`/`FxService` que v1.12 le
 * inyectó: el PRICING lo hace ahora **solo** `price-ingest` (proveedor de paga, bulk por set, mucho
 * más barato). El job `catalog-price-sync` queda DEPRECADO en su rol de pricing.
 *
 * v1.22-variantes-orden (§4.22a): este servicio es la **AUTORIDAD ÚNICA** de
 * `Card.availableFinishes` — ya no es un «bootstrap» que el `price-ingest` sobre-escriba (§4.15e
 * DEROGADA). También escribe las claves de orden natural `numberSort`/`numberPrefix` (M-26).
 */
@Injectable()
export class CatalogSyncService {
  private readonly logger = new Logger(CatalogSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PokemonTcgIoClient,
    private readonly settings: SettingsService,
    // v1.22-1 (§4.22g): `upsertCards` escribe `catalogFinishes` y DELEGA la escritura de
    // `availableFinishes` al ÚNICO escritor (FinishReconciler); ya no la escribe inline.
    private readonly finishReconciler: FinishReconciler,
    // v1.29 (§4.27d): resolver de «1 carta ↔ N productos» desde TCGCSV, invocado como paso de
    // `importSet` (first-import/`--force`). @Optional: los tests unitarios que ejercitan solo el
    // sync single/metadata pueden construir el servicio sin él (no se invoca en esa ruta).
    @Optional() private readonly cardProductResolver?: CardProductResolverService,
  ) {}

  /**
   * POST /admin/catalog/unify-rarities — backfill LOCAL de `Card.rarityCanonical` (§4.28c). Re-deriva
   * `rarityCanonical = normalizeRarity(rarity)` para TODA carta con `rarity != null`. Cierra la
   * regresión de la migración M-31 (sembró `rarityCanonical = rarity` CRUDO), que fragmentaba el
   * agrupado `groupBy(['rarityCanonical'])` del editor de reglas.
   *
   * Money-safe: NUNCA llama a pokemontcg.io ni a TCGCSV (es un UPDATE derivado de la columna LOCAL
   * `rarity`); NO toca `PriceReference`, precios, ni composición de variantes — SOLO reescribe
   * `rarityCanonical`. El pricing ya re-normaliza al vuelo (money.ts), así que los montos no cambian:
   * esto solo repara la UX del editor.
   *
   * Síncrono e idempotente: agrega el estado por `groupBy(['rarity','rarityCanonical'])` (el universo
   * de rarezas distintas es de decenas), escribe SOLO las rarezas crudas con al menos una fila
   * divergente y en la segunda corrida no hace ningún UPDATE. `unmapped` lista las rarezas cuya forma
   * cruda NO tiene entrada en el catálogo canónico (`CANONICAL_RARITIES`) → candidatas a añadir.
   */
  async unifyRarities(): Promise<{
    ok: boolean;
    cardsProcessed: number;
    cardsUpdated: number;
    distinctCanonical: number;
    unmapped: { raw: string; canonical: string; count: number }[];
  }> {
    const groups = await this.prisma.card.groupBy({
      by: ['rarity', 'rarityCanonical'],
      where: { rarity: { not: null } },
      _count: { _all: true },
    });

    let cardsProcessed = 0;
    let cardsUpdated = 0;
    const canonicalSet = new Set<string>();
    // raw → { canonical, count, needsUpdate }: agrega los conteos por rareza cruda y marca si alguna
    // fila difiere del canónico esperado (para escribir SOLO donde haga falta).
    const byRaw = new Map<string, { canonical: string; count: number; needsUpdate: boolean }>();
    const unmappedByRaw = new Map<string, { canonical: string; count: number }>();

    for (const g of groups) {
      const raw = g.rarity;
      if (raw == null) continue; // filtrado por el where, defensivo
      const count = g._count._all;
      cardsProcessed += count;
      // `rarity` no vacía ⇒ normalizeRarity nunca devuelve null; el guard es defensivo.
      const canonical = normalizeRarity(raw);
      if (canonical == null) continue;
      canonicalSet.add(canonical);

      const acc = byRaw.get(raw) ?? { canonical, count: 0, needsUpdate: false };
      acc.count += count;
      if (g.rarityCanonical !== canonical) {
        acc.needsUpdate = true;
        cardsUpdated += count;
      }
      byRaw.set(raw, acc);

      if (!isRarityMapped(raw)) {
        const u = unmappedByRaw.get(raw) ?? { canonical, count: 0 };
        u.count += count;
        unmappedByRaw.set(raw, u);
      }
    }

    // Escribe SOLO las rarezas crudas divergentes. El `NOT` filtra las filas ya correctas (e incluye
    // las de `rarityCanonical = null`); NO toca ninguna otra columna → money-safe.
    for (const [raw, info] of byRaw) {
      if (!info.needsUpdate) continue;
      await this.prisma.card.updateMany({
        where: { rarity: raw, NOT: { rarityCanonical: info.canonical } },
        data: { rarityCanonical: info.canonical },
      });
    }

    const unmapped = [...unmappedByRaw.entries()]
      .map(([raw, u]) => ({ raw, canonical: u.canonical, count: u.count }))
      .sort((a, b) => b.count - a.count);

    this.logger.log(
      `unify-rarities: ${cardsProcessed} cartas, ${cardsUpdated} actualizadas, ` +
        `${canonicalSet.size} canónicas distintas, ${unmapped.length} rarezas unmapped.`,
    );
    return { ok: true, cardsProcessed, cardsUpdated, distinctCanonical: canonicalSet.size, unmapped };
  }

  /**
   * GET /admin/catalog/remote-sets — lista remota + estado local (imported/cardCount).
   *
   * ROBUSTEZ (bug prod): si pokemontcg.io falla o rate-limitea, NO tiramos 500 crudo. Se
   * **degrada con gracia** usando la lista LOCAL de sets (`CardSet` en BD) como fallback, para
   * que M2 siga operable durante un rate-limit/sync. El shape del contrato se mantiene
   * (`{ data: [...] }`); se añaden banderas opcionales `degraded`/`source` (no rompen el shape).
   */
  async remoteSets() {
    const counts = await this.localCardCountsByExternalSetId();
    let remote: RemoteCardSet[];
    try {
      remote = await this.client.getSets();
    } catch (e) {
      this.logger.warn(
        `remote-sets: pokemontcg.io no disponible (${(e as Error).message}); fallback a sets locales.`,
      );
      const localSets = await this.prisma.cardSet.findMany();
      const data = localSets
        .map((s) => ({
          id: s.externalId,
          name: s.name,
          series: s.series ?? null,
          releaseDate: s.releaseDate ?? null,
          printedTotal: s.printedTotal ?? null,
          imported: true, // si está local, ya fue importado
          cardCount: counts.get(s.externalId) ?? 0,
        }))
        .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
      return { data, degraded: true, source: 'local' as const };
    }

    const localSets = await this.prisma.cardSet.findMany({ select: { externalId: true } });
    const localExternalIds = new Set(localSets.map((s) => s.externalId));

    const data = remote
      .map((s) => ({
        id: s.id,
        name: s.name,
        series: s.series ?? null,
        releaseDate: s.releaseDate ?? null,
        printedTotal: s.printedTotal ?? null,
        imported: localExternalIds.has(s.id),
        cardCount: counts.get(s.id) ?? 0,
      }))
      .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
    return { data, degraded: false, source: 'remote' as const };
  }

  /**
   * POST /admin/catalog/sync — importa/actualiza cartas (set puntual o desde fecha).
   *
   * v1.27 (P-12, §4.25c): gana `force` (default `false`). Con `force:true` se corre TAMBIÉN el
   * resolver estructural TCGCSV para CADA set procesado por la llamada (single o from_date), aunque
   * el set no sea first-import — misma semántica y mismo best-effort/money-safe que el `force` de
   * `sync-all` (cierra la asimetría: el botón por set de M2 nunca refrescaba variantes). Auditado
   * con `force` en el detalle por el controller.
   */
  async sync(setId?: string, fromReleaseDate?: string, force = false) {
    if (setId != null) {
      if (!SET_ID_PATTERN.test(setId)) {
        throw BusinessException.validation('VALIDATION_ERROR', 'Invalid setId format');
      }
      const res = await this.importSetByExternalId(setId, { force });
      const tally = tallyImports([res]);
      return {
        jobId: `catalog-sync-${Date.now()}`,
        // Sets que esta llamada REALMENTE procesó (escribió cartas). Antes era `res.imported ? 1 : 0`
        // con `imported` literal `true` ⇒ SIEMPRE 1. Ahora sale de lo que se contó (D1).
        setsQueued: tally.setsWritten,
        mode: 'single' as const,
        // Desglose HONESTO (aditivo): «importé» y «ya estaba» son hechos distintos y viajan
        // separados. La UI de M2 lee hoy `setsQueued` y lo rotula «set(s) importado(s)»: con un
        // re-sync eso es falso, y sólo se puede arreglar leyendo `setsImported`.
        ...tally,
      };
    }

    // Corte por la fuente ÚNICA (dial o `fromReleaseDate` explícito del request).
    const from = await this.resolveCatalogFromDate(fromReleaseDate);
    const remote = await this.client.getSets();
    const toImport = remote.filter((s) => isWithinCatalogFromDate(s, from));
    const results: SetImportOutcome[] = [];
    for (const s of toImport) {
      results.push(await this.importSet(s, { force }));
    }
    const tally = tallyImports(results);
    return {
      jobId: `catalog-sync-${Date.now()}`,
      // Sets REALMENTE procesados (los que dejaron cartas escritas). Los que el remoto devolvió
      // vacíos son `setsNoop` y NO se cuentan como procesados (D1).
      setsQueued: tally.setsWritten,
      mode: 'from_date' as const,
      ...tally,
    };
  }

  /**
   * POST /admin/catalog/refresh-variants (M-34) — refresca VARIANTES (finishes) + PRECIO POR
   * VARIANTE de un set **YA IMPORTADO** usando **SOLO TCGCSV**. NUNCA llama a pokemontcg.io.
   *
   * Motivo (regresión de composición): el "Sync completo" encadena el re-fetch de cartas
   * (pokemontcg.io) con el resolver de variantes/precios (TCGCSV); cuando pokemontcg.io está caído
   * (502), no se puede reparar el `normal` fantasma de un set que YA tenemos en BD. Este camino
   * ROMPE ese acoplamiento: opera sobre las `Card` existentes (no trae payload nuevo) y solo habla
   * con TCGCSV.
   *
   * Pasos (reusa el MISMO `CardProductResolverService` del sync, §4.27d):
   *   1. resuelve `CardProduct` por productId EXACTO desde TCGCSV (jamás funde por número);
   *   2. reconcilia `Card.availableFinishes` desde `CardProduct` (`FinishReconciler`);
   *   3. ingiere precio por variante (`tcgcsv_singles`, FX Banxico, money-safe: sin precio ⇒
   *      PRICE_PENDING/«—», jamás 0).
   *
   * Errores:
   *   - set no en BD (o sin cartas) ⇒ `SET_NOT_IMPORTED` (409 CONFLICT) accionable — NO se intenta
   *     importar. Se usa 409 (no 404) a propósito: el front trata 404/405 como "endpoint no
   *     desplegado" (`isEndpointMissing`) y confundiría un SET_NOT_IMPORTED real con eso (ver :208).
   *   - TCGCSV caído (401/403/5xx/red/parse) ⇒ `UPSTREAM_ERROR` (502) accionable, money-safe
   *     (el resolver hace TODO el fetch ANTES de cualquier escritura ⇒ un fallo remoto no borra ni
   *     escribe nada; se conserva lo previo). Nunca un 500 crudo.
   *
   * `force` se acepta por SIMETRÍA con `/sync` (y para el mismo botón del front). Este camino ES,
   * por definición, un refresco forzado de variantes: SIEMPRE re-resuelve por completo, así que
   * `force` no altera el comportamiento hoy (queda registrado en auditoría).
   */
  async refreshVariants(
    setId: string,
    force = false,
  ): Promise<{
    ok: boolean;
    setId: string;
    /**
     * D2 — cartas que ESTA corrida tocó de verdad (`Card` distintas con `CardProduct` upserteado y
     * `availableFinishes` recomputado), tal como las contó el resolver. `null` = **no se pudo
     * saber** ⇒ la UI pinta «—». JAMÁS el total del set (era el bug: un set de 191 cartas del que
     * no se resolvió nada reportaba «191 cartas procesadas · 0 precios», en verde) y jamás un 0 de
     * relleno para tapar un dato ausente — la misma norma que ya rige para los precios sin mercado.
     */
    cardsProcessed: number | null;
    /** Universo local del set (cuántas cartas HAY). El otro predicado, con su propio nombre. */
    cardsInSet: number;
    cardProductsUpserted: number;
    pricesUpserted: number;
    pending: number;
    tcgcsvReachable: boolean;
  }> {
    void force; // aceptado por simetría con /sync; este camino siempre re-resuelve (ver doc arriba)
    if (!SET_ID_PATTERN.test(setId)) {
      throw BusinessException.validation('VALIDATION_ERROR', 'Invalid setId format');
    }
    // El set DEBE existir en BD y tener cartas: este camino NO importa desde pokemontcg.io.
    const localSet = await this.prisma.cardSet.findUnique({
      where: { externalId: setId },
      select: { id: true },
    });
    // Universo local por la fuente ÚNICA del predicado (`countLocalCardsInSet`), no por un
    // `_count` paralelo: la cuenta de «cartas del set» vive en un solo sitio (§0-B.3 regla 8).
    const cardsInSet = localSet == null ? 0 : await this.countLocalCardsInSet(localSet.id);
    if (!localSet || cardsInSet === 0) {
      // 409 (no 404) a propósito: el front trata 404/405 como "endpoint no desplegado"
      // (`isEndpointMissing`); un SET_NOT_IMPORTED real con 404 se confundiría con eso.
      throw new BusinessException(
        ErrorCode.SET_NOT_IMPORTED,
        HttpStatus.CONFLICT,
        `El set "${setId}" no está importado en BD (sin cartas). Impórtalo primero con ` +
          `POST /admin/catalog/sync; este camino NO llama a pokemontcg.io.`,
      );
    }
    if (this.cardProductResolver == null) {
      // No debería pasar en prod (el resolver está cableado en CatalogModule). @Optional es solo
      // para los tests de metadata que construyen el sync sin él.
      throw new BusinessException(
        ErrorCode.INTERNAL,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'CardProductResolver no está cableado; no se puede refrescar variantes.',
      );
    }

    // TODO el fetch a TCGCSV ocurre DENTRO del resolver ANTES de cualquier escritura (Promise.all de
    // products+prices / listGroups). Un fallo remoto sube como excepción ⇒ el guard lo remapea a 502
    // UPSTREAM_ERROR y NADA se escribió (money-safe). Nunca un 500 crudo.
    const result = await this.withTcgcsvGuard(() =>
      this.cardProductResolver!.resolveCardProductsForSet(localSet.id),
    );

    if (result == null) {
      // TCGCSV respondió, pero no se resolvió un groupId ÚNICO ⇒ no se tocó nada (money-safe).
      this.logger.warn(
        `refresh-variants: set ${setId} sin groupId TCGCSV ÚNICO; no se tocó ningún CardProduct ` +
          `(cardsProcessed=0 de ${cardsInSet} cartas del set).`,
      );
      return {
        ok: true,
        setId,
        // 0 MEDIDO, no de relleno: se sabe con certeza que no se tocó ninguna carta.
        cardsProcessed: 0,
        cardsInSet,
        cardProductsUpserted: 0,
        pricesUpserted: 0,
        pending: 0,
        tcgcsvReachable: true,
      };
    }
    // `cardsTouched` lo cuenta el resolver (fuente única de ese hecho). Si un resolver no lo
    // reporta, el dato es DESCONOCIDO ⇒ `null` («—»): no se sustituye por el universo del set
    // (D2) ni por un 0 que afirmaría, falsamente, que se sabe que no se tocó nada.
    const cardsTouched: number | undefined = (result as { cardsTouched?: number }).cardsTouched;
    return {
      ok: true,
      setId,
      cardsProcessed: cardsTouched ?? null,
      cardsInSet,
      cardProductsUpserted: result.joined,
      pricesUpserted: result.pricesWritten,
      pending: result.pricesPending,
      tcgcsvReachable: true,
    };
  }

  /**
   * M-34 — degradado elegante del fallo upstream de **TCGCSV** (hermano de `withUpstreamGuard`, que
   * es para pokemontcg.io). Un fallo remoto/parse (401/403/5xx/red) se remapea a un **502
   * BAD_GATEWAY** accionable (`UPSTREAM_ERROR`, mismo patrón del explorador de sellado), NO un 500
   * crudo. Una `BusinessException` ya formada (p. ej. `SET_NOT_IMPORTED`, `VALIDATION_ERROR`) se
   * PRESERVA. Money-safe: el resolver hace todo el fetch antes de escribir ⇒ nada se tocó.
   */
  private async withTcgcsvGuard<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (e) {
      if (e instanceof BusinessException) throw e;
      throw new BusinessException(
        ErrorCode.UPSTREAM_ERROR,
        HttpStatus.BAD_GATEWAY,
        `Fuente TCGCSV no disponible; reintenta en unos minutos (${(e as Error).message})`,
      );
    }
  }

  /**
   * POST /admin/catalog/backfill — importa el siguiente lote de sets más antiguos no importados.
   *
   * `force:true` (v1.6-finish) NO filtra los sets ya importados: los reprocesa (re-upsert por
   * `externalId`) para refrescar `availableFinishes`. `force:false` (default) mantiene el
   * comportamiento de hoy (solo sets no importados).
   */
  async backfill(batchSize = 10, untilYear?: number, force = false) {
    const size = batchSize > 0 ? batchSize : 10;
    const remote = await this.client.getSets();
    // Predicado «el set existe localmente» (fila CardSet, con o sin cartas) — el criterio
    // histórico de los candidatos de backfill; se conserva TAL CUAL (cambiarlo es una decisión de
    // alcance, no de honestidad de contadores).
    const importedIds = await this.localSetExternalIds();

    // Candidatos = sets remotos (con force NO se filtran los importados; sin force, solo los NO
    // importados), opcionalmente acotados por untilYear (no más antiguos que ese año), ordenados
    // de más ANTIGUO a más nuevo.
    const candidates = remote
      .filter((s) => (force ? true : !importedIds.has(s.id)))
      .filter((s) => (untilYear == null ? true : (yearFromReleaseDate(s.releaseDate) ?? 0) >= untilYear))
      .sort((a, b) => (a.releaseDate ?? '').localeCompare(b.releaseDate ?? ''));

    const batch = candidates.slice(0, size);
    // D1: `imported` son SOLO los sets que de verdad se importaron por primera vez. Antes entraba
    // aquí todo lote procesado (porque `res.imported` era el literal `true`), así que un backfill
    // `force:true` sobre sets ya importados los listaba como recién importados.
    const imported: { id: string; name: string; releaseDate: string | null; cardCount: number }[] = [];
    /** Aditivo: sets que YA estaban y esta corrida sólo re-upserteó (no son imports). */
    const refreshed: { id: string; name: string; releaseDate: string | null; cardCount: number }[] = [];
    const results: SetImportOutcome[] = [];
    for (const s of batch) {
      // v1.26 (§4.24a): con force se re-resuelve también la composición estructural (repara).
      const res = await this.importSet(s, { force });
      results.push(res);
      const row = {
        id: s.id,
        name: s.name,
        releaseDate: s.releaseDate ?? null,
        // cartas que ESTA corrida escribió para el set (no las que tiene).
        cardCount: res.cardsUpserted,
      };
      if (res.outcome === 'imported') imported.push(row);
      else if (res.outcome === 'refreshed') refreshed.push(row);
    }
    const tally = tallyImports(results);

    // newBoundary = releaseDate del set más ANTIGUO ya importado tras el lote.
    const allImported = await this.prisma.cardSet.findMany({
      where: { releaseDate: { not: null } },
      select: { releaseDate: true },
      orderBy: { releaseDate: 'asc' },
      take: 1,
    });
    const newBoundary = allImported[0]?.releaseDate ?? null;
    // Candidatos que siguen sin atender: los que no entraron en el lote MÁS los que se intentaron
    // y no dejaron nada escrito (`noop`). Antes se restaba `imported.length`, que con el literal
    // `imported:true` era siempre el tamaño del lote — la resta salía bien por accidente.
    const remaining = candidates.length - tally.setsWritten;
    return { imported, refreshed, newBoundary, remaining, ...tally };
  }

  /**
   * Estado observable del barrido `sync-all` (para `GET /admin/catalog/sync-status`).
   *
   * Vive en memoria del proceso (no persistido; ver límite conocido en `syncAll`). Da un
   * progreso HONESTO `done/total` en SETS y un momento claro de "terminó" (`running=false` +
   * `finishedAt`), SIN llamar a pokemontcg.io en cada poll (no consume rate-limit). `running`
   * también sirve de single-flight: mientras es `true` no se lanza un segundo barrido.
   */
  private syncAllStatus: {
    running: boolean;
    jobId: string | null;
    total: number;
    done: number;
    startedAt: string | null;
    finishedAt: string | null;
    /**
     * D1 — RESULTADO del barrido, que antes se tiraba a la basura: `runSyncAll` llamaba a
     * `importSet` y descartaba lo que devolvía, así que del barrido sólo se sabía «cuántos
     * intenté», nunca «cuántos importé de verdad». `null` hasta que arranca el primer barrido
     * (mismo criterio que `refreshVariantsAllStatus.summary`: sin barrido no se pinta un
     * «Listo — 0/0» falso).
     */
    summary: SyncAllSummary | null;
  } = {
    running: false,
    jobId: null,
    total: 0,
    done: 0,
    startedAt: null,
    finishedAt: null,
    summary: null,
  };

  /** Resumen agregado en ceros (arranque de un barrido `sync-all`). */
  /**
   * Resumen en ceros para ARRANCAR un barrido, con la **selección ya decidida** dentro.
   *
   * La selección no se «suma» durante el barrido: se conoce **antes** de encolar nada, así que
   * entra aquí de una vez y no vuelve a tocarse. Los ceros del reparto sí son ceros que el barrido
   * va a contar (§M2-CS.1: «⛔ Nunca un `summary` en ceros para rellenar»; el «no lo medí» se dice
   * con `summary: null`, y esa decisión la toma `syncAll`).
   */
  private static emptySyncAllSummary(selection?: SyncAllSelection): SyncAllSummary {
    return {
      ...emptySetSweepTally(),
      setsImported: 0,
      setsRefreshed: 0,
      cardsUpserted: 0,
      // Camino sin selección: `runSyncAll` invocado DIRECTAMENTE (job interno / test), nunca desde
      // el endpoint —`syncAll` siempre publica el summary con su selección antes de lanzar—. Ahí no
      // hubo fase de selección que reportar, y `''` lo dice sin inventar una fecha (§M2-CS.4:
      // ⛔ no se adivina un corte).
      fromReleaseDate: selection?.fromReleaseDate ?? '',
      setsSkippedOutOfRange: selection?.setsSkippedOutOfRange ?? 0,
      setsSkippedUnknownDate: selection?.setsSkippedUnknownDate ?? 0,
    };
  }

  /**
   * GET /admin/catalog/sync-status — progreso del barrido en curso (o del último).
   *
   * El `202` de `sync-all` NO puede decir cuántos sets se importaron (el barrido acaba de
   * arrancar): ese hecho es DESCONOCIDO en ese instante y por eso no se inventa allí. Vive aquí,
   * en `summary`, y aparece conforme el barrido avanza.
   */
  getSyncStatus() {
    const { summary } = this.syncAllStatus;
    return {
      ...this.syncAllStatus,
      summary: summary == null ? null : { ...summary, failures: [...summary.failures] },
    };
  }

  /**
   * M-35 — estado observable del barrido `refresh-variants-all` (para
   * `GET /admin/catalog/refresh-variants-status`). MISMO patrón que `syncAllStatus`: vive en
   * memoria del proceso, da progreso HONESTO `done/total` en SETS y un momento claro de "terminó"
   * (`running=false` + `finishedAt`), SIN llamar a NINGÚN upstream en cada poll. `running` sirve de
   * single-flight contra sí mismo. Además acumula el RESUMEN agregado del barrido
   * (`summary`), que el front lee al terminar.
   *
   * `summary` es **null hasta que arranca el primer barrido** (contrato
   * `RefreshVariantsStatusResponse.summary: RefreshVariantsSummary | null`): con el backend recién
   * levantado y NINGÚN batch disparado, el front NO debe pintar un banner "Listo — 0/0" falso. En
   * cuanto un barrido arranca (`refreshVariantsAll`) o corre (`runRefreshVariantsAll`) se
   * inicializa a ceros y se va poblando; ya no vuelve a null (expone el último barrido).
   */
  private refreshVariantsAllStatus: {
    running: boolean;
    jobId: string | null;
    total: number;
    done: number;
    startedAt: string | null;
    finishedAt: string | null;
    summary: RefreshVariantsSummary | null;
  } = {
    running: false,
    jobId: null,
    total: 0,
    done: 0,
    startedAt: null,
    finishedAt: null,
    summary: null,
  };

  /** Resumen agregado en ceros (arranque de un barrido). Reparto por §M2-CS.0. */
  private static emptyRefreshVariantsSummary(): RefreshVariantsSummary {
    return {
      ...emptySetSweepTally(),
      cardProductsUpserted: 0,
      pricesUpserted: 0,
      pending: 0,
    };
  }

  /**
   * GET /admin/catalog/refresh-variants-status — progreso + resumen agregado del barrido
   * `refresh-variants-all` en curso (o del último). Pensado para POLLING desde el front (igual que
   * `sync-status`): NO se audita (evita inundar AuditLog) y NO llama a ningún upstream.
   */
  getRefreshVariantsAllStatus() {
    const { summary } = this.refreshVariantsAllStatus;
    return {
      ...this.refreshVariantsAllStatus,
      // null hasta que arranca el primer barrido (contrato): sin batch disparado NO se expone un
      // summary en ceros (evita el banner "Listo — 0/0" falso en M2 con el backend recién levantado).
      summary:
        summary == null
          ? null
          : {
              ...summary,
              // ⛔ `setsOk` DEPRECADO (§M2-CS.2), significado CONGELADO: `setsWritten + setsNoop`.
              // Se emite DERIVADO y no como contador propio: un campo que se calcula no puede
              // desviarse de su definición congelada, por mucho que el barrido cambie. Sigue
              // sumando los `noop` a los buenos —congelar no es arreglar—, así que ⛔ ningún
              // consumidor lo usa para un veredicto. Se retira del shape en la rev siguiente,
              // cuando frontend confirme cero consumidores.
              setsOk: deprecatedSetsOk(summary),
              failures: [...summary.failures],
            },
    };
  }

  /**
   * POST /admin/catalog/sync-all (v1.3, NUEVO) — importa TODO el catálogo (todos los sets
   * remotos, sin frontera de fecha) para la Opción 1 del cotizador. API_CONTRACT §M2.
   *
   * **NO bloqueante (resuelve DEV-1):** calcula los sets pendientes con UNA llamada rápida a
   * `/sets`, lanza el barrido en **segundo plano** (fire-and-forget) y retorna `202` de
   * inmediato — a diferencia del `sync` from-date, que importa síncrono en el request y da
   * timeout con catálogos grandes.
   *
   * **Resumible + idempotente:** los sets ya importados (con cartas) se saltan; los que se
   * (re)importan usan upsert por `externalId` (no duplican). Re-llamar `sync-all` reanuda los
   * pendientes que quedaran de un barrido interrumpido.
   *
   * **Modo `force` (v1.6-finish, bug availableFinishes):** con `force:true` NO se saltan los
   * sets ya poblados: se reprocesan TODOS los sets remotos y se re-upsertan sus cartas vía
   * `upsertCards` (idempotente por `externalId`). Esto **refresca `Card.availableFinishes`**
   * (bootstrap) que en sets viejos se quedó en `['normal']`. Con `force:false` (default) el
   * comportamiento es el de siempre: salta importados.
   *
   * **WS-A (§4.15g):** este barrido ya NO puebla precios (eso lo hace `price-ingest`). Refresca
   * SOLO metadata + `availableFinishes` (bootstrap). El job `catalog-price-sync` (force:true)
   * queda deprecado en su rol de pricing; se conserva para importar metadata de sets nuevos.
   *
   * **Límite conocido (sin BullMQ cableado para catálogo, ver BACKEND_NOTES / DEV-1):** el
   * barrido corre en memoria del proceso; si el proceso se reinicia a mitad, los sets no
   * importados quedan pendientes y se reanudan re-llamando `sync-all`.
   */
  async syncAll(
    options: { force?: boolean } = {},
  ): Promise<{ jobId: string; setsQueued: number; remaining: number } & SyncAllSelection> {
    const force = options.force ?? false;
    // D3 — CORTE DE FECHA: el barrido honra el dial `catalog_sync_from_date` (el mismo que ya
    // honraba `sync()` en modo from_date), a través del predicado ÚNICO `selectSyncAllCandidates`.
    // El dial es la manija «movible» del dueño: se edita en M10 sin redeploy.
    const fromReleaseDate = await this.resolveCatalogFromDate();
    const remote = await this.client.getSets();
    // "Importado" = set local con al menos una carta (evita reprocesar sets ya poblados).
    const importedWithCards = new Set(await this.localSetExternalIdsWithCards());
    const {
      queue: pending,
      outOfRange,
      unknownDate,
    } = selectSyncAllCandidates(remote, { importedWithCards, force, fromReleaseDate });
    // ⭐ UN SOLO CÁLCULO de la selección, DOS momentos (§M2-CS.1): el `202` la hace eco al
    // arrancar y `summary` la guarda al terminar. Se arma aquí, una vez, y ambos la copian: es lo
    // que impide que el eco y el registro canónico se desincronicen (§0-B.3 regla 8).
    const selection: SyncAllSelection = {
      fromReleaseDate,
      setsSkippedOutOfRange: outOfRange.length,
      setsSkippedUnknownDate: unknownDate.length,
    };
    if (unknownDate.length > 0) {
      // Caso que nadie ha decidido: un set remoto sin `releaseDate` cae fuera del corte por
      // comparación de cadena vacía. Se sigue quedando fuera, pero ahora se VE.
      this.logger.warn(
        `sync-all: ${unknownDate.length} set(s) remotos NO importados vienen SIN releaseDate y quedan ` +
          `fuera del corte (${unknownDate.map((s) => s.id).join(', ')}). Nadie ha decidido este caso: ` +
          `hoy sólo entran por backfill.`,
      );
    }
    const jobId = `catalog-sync-all-${Date.now()}`;

    if (this.syncAllStatus.running) {
      // Ya hay un barrido en curso → no lanzamos otro; reportamos lo que falta.
      return { jobId, setsQueued: 0, remaining: pending.length, ...selection };
    }

    const batch = [...pending];
    // Publica el estado observable del barrido ANTES de lanzarlo: jobId/total/startedAt se
    // fijan aquí; `done` avanza por set en runSyncAll; `running`/`finishedAt` se cierran en el
    // finally. Así el front puede pintar una barra honesta done/total y saber cuándo terminó.
    this.syncAllStatus = {
      running: true,
      jobId,
      total: batch.length,
      done: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      // Arranca el resumen (ya no null): `setsTotal` y las TRES cifras de selección se fijan aquí
      // (se conocen ya); el resto lo suma `runSyncAll` con lo que cada import REALMENTE hizo. El
      // 202 de abajo no anticipa ninguno de esos números.
      summary: { ...CatalogSyncService.emptySyncAllSummary(selection), setsTotal: batch.length },
    };
    // Fire-and-forget: el request NO espera a que se importen todos los sets.
    void this.runSyncAll(batch, force).finally(() => {
      this.syncAllStatus.running = false;
      this.syncAllStatus.finishedAt = new Date().toISOString();
    });
    this.logger.log(
      `sync-all: ${batch.length} sets encolados (corte ${fromReleaseDate}, force=${force}); ` +
        `${outOfRange.length} sets remotos NO importados quedan fuera por ser anteriores al corte ` +
        `(para esos, backfill).`,
    );
    // `setsQueued` = sets encolados en esta llamada; `remaining` = sets aún sin importar que
    // NO se encolaron (0: encolamos todos los pendientes).
    // `setsSkippedOutOfRange` (aditivo, D3) = sets remotos que NO tenemos y que el corte dejó
    // fuera: sin este número, "0 sets encolados" no distingue "ya está todo al día" de "hay 200
    // sets que no te traje porque son viejos". `fromReleaseDate` es el corte que se aplicó.
    // Ninguno de estos campos anticipa cuántos sets se importarán: eso no se sabe todavía y vive
    // en el `summary` de `sync-status` cuando el barrido avanza.
    // ⚠️ Las tres de `selection` son ECO (§M2-CS.1): la fuente canónica del registro de la corrida
    // es `summary` (arriba), que lleva las MISMAS tres por construcción — aquí se copian, no se
    // recalculan.
    return { jobId, setsQueued: batch.length, remaining: 0, ...selection };
  }

  /** Barrido en segundo plano de `sync-all`: importa cada set secuencialmente (rate-limit). */
  async runSyncAll(sets: RemoteCardSet[], force = false): Promise<void> {
    // Normalmente lo arranca `syncAll`; si se invoca el barrido directamente (tests, job interno)
    // se inicializa en ceros para no operar sobre null.
    const summary = (this.syncAllStatus.summary ??= CatalogSyncService.emptySyncAllSummary());
    for (const s of sets) {
      try {
        const res = await this.importSet(s, { force });
        // D1: lo que el import devuelve YA NO se descarta — es la única forma de saber cuántos
        // sets se importaron de verdad y cuántos sólo se re-sincronizaron.
        //
        // El reparto lo hace la fuente única (§M2-CS.0): `imported`/`refreshed` son DESGLOSE de
        // `setsWritten` (`I-CS5`), no un vocabulario paralelo, así que se suman aparte y el
        // «¿escribió?» lo decide `recordSweepAttempt` con el mismo criterio que el otro barrido.
        if (res.outcome === 'imported') summary.setsImported += 1;
        else if (res.outcome === 'refreshed') summary.setsRefreshed += 1;
        recordSweepAttempt(summary, res.outcome !== 'noop');
        summary.cardsUpserted += res.cardsUpserted;
      } catch (e) {
        recordSweepFailure(summary, s.id, e);
        this.logger.warn(`sync-all: set ${s.id} falló: ${(e as Error).message}`);
      } finally {
        // Avanza el progreso por set intentado (éxito o fallo) → barra honesta done/total.
        this.syncAllStatus.done += 1;
      }
    }
    this.logger.log(
      `sync-all: barrido de ${sets.length} sets completado (escritos=${summary.setsWritten} ` +
        `[importados=${summary.setsImported}, re-sync=${summary.setsRefreshed}], ` +
        `sin escribir=${summary.setsNoop}, fallidos=${summary.setsFailed}, ` +
        `cartas escritas=${summary.cardsUpserted}).`,
    );
  }

  /**
   * Delay (ms) entre sets del barrido `refresh-variants-all` — respeto a tcgcsv.com (no martillear).
   * Configurable por env `CATALOG_REFRESH_VARIANTS_BATCH_DELAY_MS`; default 250ms. El User-Agent ya
   * lo pone el cliente TCGCSV.
   */
  private readonly refreshVariantsBatchDelayMs =
    Number(process.env.CATALOG_REFRESH_VARIANTS_BATCH_DELAY_MS ?? '') || 250;

  /** setTimeout-based sleep aislado (protected) para poder neutralizarlo/espiarlo en tests. */
  protected async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((r) => setTimeout(r, ms));
  }

  /**
   * POST /admin/catalog/refresh-variants-all (M-35) — versión BATCH del `refresh-variants`: corre,
   * sobre TODOS los sets YA IMPORTADOS (los que tienen cartas en BD), el MISMO refresh solo-TCGCSV
   * por-set (`refreshVariants`). Backfillea el catálogo viejo (fantasma pre-M-31) SIN tocar
   * pokemontcg.io — ni siquiera para LISTAR sets: la lista sale de BD local.
   *
   * NO bloqueante (MISMO modelo que `sync-all`): calcula los sets importados con una consulta local
   * rápida, lanza el barrido en SEGUNDO PLANO (fire-and-forget) y retorna 202 de inmediato con
   * `{ jobId, setsQueued, remaining }`. El progreso + resumen agregado se observan por
   * `GET /admin/catalog/refresh-variants-status` (keep-alive del front, igual que `sync-status`).
   *
   * Single-flight: mientras `running` es true no se lanza otro barrido (reporta lo que hay).
   *
   * `force` se acepta por SIMETRÍA con `refresh-variants`/`sync-all`; este camino SIEMPRE re-resuelve
   * por completo (queda registrado en auditoría). No altera el comportamiento hoy.
   */
  async refreshVariantsAll(
    options: { force?: boolean } = {},
  ): Promise<{ jobId: string; setsQueued: number; remaining: number }> {
    const force = options.force ?? false;
    // Lista de sets IMPORTADOS desde BD LOCAL (jamás pokemontcg.io): set con ≥1 carta.
    const importedExternalIds = await this.localSetExternalIdsWithCards();
    const jobId = `catalog-refresh-variants-all-${Date.now()}`;

    if (this.refreshVariantsAllStatus.running) {
      // Ya hay un barrido en curso → no lanzamos otro; reportamos lo que falta.
      return { jobId, setsQueued: 0, remaining: importedExternalIds.length };
    }

    const batch = [...importedExternalIds];
    // Publica el estado observable ANTES de lanzar: jobId/total/startedAt se fijan aquí; `done` y el
    // `summary` avanzan por set en runRefreshVariantsAll; `running`/`finishedAt` se cierran en el
    // finally. Así el front pinta una barra honesta done/total y ve el resumen al terminar.
    this.refreshVariantsAllStatus = {
      running: true,
      jobId,
      total: batch.length,
      done: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      // Arranca el summary (ya no null): setsTotal fijo aquí; el resto lo suma runRefreshVariantsAll.
      summary: { ...CatalogSyncService.emptyRefreshVariantsSummary(), setsTotal: batch.length },
    };
    // Fire-and-forget: el request NO espera a que se refresquen todos los sets.
    void this.runRefreshVariantsAll(batch, force).finally(() => {
      this.refreshVariantsAllStatus.running = false;
      this.refreshVariantsAllStatus.finishedAt = new Date().toISOString();
    });
    return { jobId, setsQueued: batch.length, remaining: 0 };
  }

  /**
   * Barrido en segundo plano de `refresh-variants-all`: refresca cada set secuencialmente reusando
   * el MISMO `refreshVariants` por-set (SOLO TCGCSV), con delay entre sets (respeto a tcgcsv.com).
   *
   * RESILIENTE POR-SET: el fallo de UN set (502 UPSTREAM_ERROR de TCGCSV, grupo no espejado,
   * SET_NOT_IMPORTED por carrera, etc.) NO aborta el barrido — se captura, se acumula en
   * `summary.failures` y se sigue con el siguiente. Money-safe intacto: `refreshVariants` hace TODO
   * el fetch TCGCSV ANTES de escribir; un fallo remoto no borra ni escribe nada.
   */
  async runRefreshVariantsAll(setExternalIds: string[], force = false): Promise<void> {
    // Asegura el summary (normalmente lo arranca `refreshVariantsAll`; si se invoca este barrido
    // directamente —p. ej. en tests— lo inicializa en ceros para no operar sobre null).
    const summary = (this.refreshVariantsAllStatus.summary ??=
      CatalogSyncService.emptyRefreshVariantsSummary());
    for (let i = 0; i < setExternalIds.length; i++) {
      const setId = setExternalIds[i];
      try {
        const res = await this.refreshVariants(setId, force);
        // ⭐ EL REPARTO (§M2-CS.0, fuente única en `set-sweep-tally.ts`).
        //
        // Aquí vivía el defecto: `summary.setsOk += 1` para TODO set que no lanzara. El set que no
        // empareja con TCGCSV corre limpio y escribe cero variantes y cero precios ⇒ sumaba a los
        // buenos y NO aparecía en `failures`. En un lote de cien, el resumen decía «todo bien» y
        // había sets sin tocar. Ahora la pregunta se hace SIEMPRE y el cero es MEDIDO: `setsNoop`.
        //
        // Predicado de escritura de ESTE barrido (§M2-CS.2: «sets con ≥1 escritura, variante o
        // precio»). ⛔ `pending` NO cuenta: son variantes que se quedaron SIN precio, es decir
        // justo lo que NO se escribió — meterlo aquí resucitaría el defecto con otro nombre.
        const wrote = res.cardProductsUpserted > 0 || res.pricesUpserted > 0;
        recordSweepAttempt(summary, wrote);
        summary.cardProductsUpserted += res.cardProductsUpserted;
        summary.pricesUpserted += res.pricesUpserted;
        summary.pending += res.pending;
        if (!wrote) {
          this.logger.warn(
            `refresh-variants-all: set ${setId} corrió SIN escribir nada (0 variantes, 0 precios) ` +
              `⇒ setsNoop. No es un fallo (no lanzó) y NO cuenta como set tocado.`,
          );
        }
      } catch (e) {
        recordSweepFailure(summary, setId, e);
        this.logger.warn(
          `refresh-variants-all: set ${setId} falló ` +
            `(${summary.failures[summary.failures.length - 1].code ?? 'sin code'}): ` +
            `${(e as Error).message} — NO aborta el barrido, sigue con el siguiente (money-safe).`,
        );
      } finally {
        // Avanza el progreso por set intentado (éxito o fallo) → barra honesta done/total.
        this.refreshVariantsAllStatus.done += 1;
      }
      // Delay entre sets (no tras el último): respeto a tcgcsv.com.
      if (i < setExternalIds.length - 1) {
        await this.sleep(this.refreshVariantsBatchDelayMs);
      }
    }
    this.logger.log(
      `refresh-variants-all: barrido de ${setExternalIds.length} sets completado ` +
        `(escritos=${summary.setsWritten}, sin escribir=${summary.setsNoop}, ` +
        `fallidos=${summary.setsFailed}).`,
    );
  }

  // ---------------- helpers ----------------

  /**
   * Importa un set del que ya tenemos metadata remota (from_date/backfill/sync-all).
   *
   * v1.26 (§4.24a): tras importar la metadata, RESUELVE la composición ESTRUCTURAL de variantes
   * desde TCGCSV — GATEADO a **first-import** (el set no tenía cartas antes) o **`--force`**. NO se
   * corre en cada re-sync de metadata ni en price-ingest. El paso es best-effort: si TCGCSV falla
   * (egress bloqueado, 502, groupId no resuelto) se LOGUEA y NO se aborta el import (money-safe: las
   * cartas conservan su `structuralFinishes` seed/previo).
   */
  private async importSet(
    rs: RemoteCardSet,
    opts: { force?: boolean } = {},
  ): Promise<SetImportOutcome> {
    const localSet = await this.upsertSet(rs);
    // Universo PREVIO del set (predicado «cartas locales de un set», fuente ÚNICA
    // `countLocalCardsInSet`). Se calcula SIEMPRE porque de él salen DOS hechos distintos: el gate
    // estructural (first-import) y el veredicto import-nuevo vs re-sync (D1). Antes solo se
    // calculaba si el resolver estaba cableado y, si no, se fabricaba un `false`: un valor
    // inventado gobernando una rama.
    const cardsBefore = await this.countLocalCardsInSet(localSet.id);
    const firstImport = cardsBefore === 0;
    const cardsUpserted = await this.importCardsForSet(rs.id, localSet.id);
    if (firstImport || opts.force === true) {
      await this.runCardProductResolver(localSet.id, rs.id);
    }
    return CatalogSyncService.outcomeOf(cardsBefore, cardsUpserted);
  }

  /**
   * D1 — traduce los DOS hechos medidos (universo previo, cartas escritas por esta corrida) al
   * resultado real. No hay ningún literal: si esta corrida no escribió una sola carta, el
   * resultado es `noop` (ni importado ni refrescado), y el llamador NO puede reportar un import.
   */
  private static outcomeOf(cardsBefore: number, cardsUpserted: number): SetImportOutcome {
    if (cardsUpserted === 0) return { outcome: 'noop', cardsUpserted: 0, cardsBefore };
    return {
      outcome: cardsBefore === 0 ? 'imported' : 'refreshed',
      cardsUpserted,
      cardsBefore,
    };
  }

  /**
   * Importa un set puntual por externalId (sync single); deriva la metadata de las cartas.
   *
   * v1.27 (P-12, §4.25c): MISMO gate estructural que `importSet` (`firstImport || force`) — antes
   * esta ruta (el botón por set de M2) JAMÁS corría el resolver TCGCSV y las variantes quedaban
   * stale. Best-effort/money-safe idéntico (fallo TCGCSV ⇒ log, conserva previo, no aborta).
   */
  private async importSetByExternalId(
    setId: string,
    opts: { force?: boolean } = {},
  ): Promise<SetImportOutcome> {
    const first = await this.withUpstreamGuard(() => this.client.getCardsBySet(setId, 1));
    if (!first.data || first.data.length === 0) {
      // El remoto no trae cartas ⇒ no se escribió NADA. `cardsBefore: null` porque ni siquiera se
      // consultó el universo local (dato AUSENTE, no 0 de relleno).
      return { outcome: 'noop', cardsUpserted: 0, cardsBefore: null };
    }
    const localSet = await this.upsertSet(first.data[0].set);
    // Universo PREVIO (mismo predicado y misma fuente ÚNICA que `importSet`): gate estructural
    // (first-import) + veredicto import-nuevo vs re-sync (D1). Se calcula SIEMPRE.
    const cardsBefore = await this.countLocalCardsInSet(localSet.id);
    const firstImport = cardsBefore === 0;
    let cardsUpserted = await this.upsertCards(first.data, localSet.id);
    cardsUpserted += await this.withUpstreamGuard(() =>
      this.importRemainingPages(setId, localSet.id, first),
    );
    if (firstImport || opts.force === true) {
      await this.runCardProductResolver(localSet.id, setId);
    }
    return CatalogSyncService.outcomeOf(cardsBefore, cardsUpserted);
  }

  /**
   * v1.26/§4.24a + v1.27/P-12 — corre el resolver estructural TCGCSV para un set, BEST-EFFORT y
   * money-safe: si TCGCSV falla (egress bloqueado, 502, groupId no resuelto) se LOGUEA y NO se
   * aborta el import (las cartas conservan su `structuralFinishes` seed/previo). No-op si el
   * resolver no está cableado (`@Optional`, tests de metadata).
   */
  /**
   * Degradado elegante del fallo upstream de pokemontcg.io (bug prod): un 500/502 crudo del cliente
   * (`Error: pokemontcg.io ... -> HTTP 5xx`) subía como **500 no manejado** ("Error del servidor"),
   * a diferencia de `remoteSets()` que SÍ degrada. Aquí se remapea a un **502 BAD_GATEWAY**
   * accionable (`UPSTREAM_ERROR`), replicando el patrón del explorador TCGCSV
   * (`sealed-pricing.controller.ts`). Una `BusinessException` que ya venga (p. ej. VALIDATION_ERROR)
   * se PRESERVA (no se re-envuelve). Money-safe: es fase de METADATA, no toca precios.
   */
  private async withUpstreamGuard<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (e) {
      if (e instanceof BusinessException) throw e;
      throw new BusinessException(
        ErrorCode.UPSTREAM_ERROR,
        HttpStatus.BAD_GATEWAY,
        `Fuente pokemontcg.io no disponible (HTTP 5xx); reintenta en unos minutos (${(e as Error).message})`,
      );
    }
  }

  private async runCardProductResolver(localSetId: string, setExternalId: string): Promise<void> {
    if (this.cardProductResolver == null) return;
    try {
      await this.cardProductResolver.resolveCardProductsForSet(localSetId);
    } catch (e) {
      this.logger.warn(
        `importSet: resolver estructural TCGCSV falló para ${setExternalId} (${(e as Error).message}); ` +
          `se conserva structuralFinishes seed/previo (money-safe). NO aborta el import.`,
      );
    }
  }

  private async importCardsForSet(setExternalId: string, localSetId: string): Promise<number> {
    const first = await this.client.getCardsBySet(setExternalId, 1);
    if (!first.data || first.data.length === 0) return 0;
    let count = await this.upsertCards(first.data, localSetId);
    count += await this.importRemainingPages(setExternalId, localSetId, first);
    return count;
  }

  private async importRemainingPages(
    setExternalId: string,
    localSetId: string,
    first: { page: number; pageSize: number; totalCount: number },
  ): Promise<number> {
    const totalPages = Math.max(1, Math.ceil(first.totalCount / (first.pageSize || 250)));
    let count = 0;
    for (let page = 2; page <= totalPages; page++) {
      const next = await this.client.getCardsBySet(setExternalId, page, first.pageSize || 250);
      count += await this.upsertCards(next.data ?? [], localSetId);
    }
    return count;
  }

  /**
   * Upsert idempotente del set por externalId.
   *
   * v1.52-set-logos (M-47, §4.39.4) — persiste también las IMÁGENES DEL SET (`logoUrl`/`symbolUrl`)
   * con DOS reglas que se componen, y equivocarse en cualquiera de las dos falla en silencio:
   *
   *  1. **Guardarraíl de ingesta** (`sanitizeSetImageUrl`): solo se persiste una URL absoluta `https:`
   *     del host que YA sirve el arte de las cartas. Cualquier otra cosa NO se persiste (+ log).
   *  2. **NO-DEGRADACIÓN**: ausente (o rechazada por el guardarraíl) ⇒ **no-op** en el `update`, jamás
   *     `null`; en el `create` (set nuevo) ⇒ `null`. Sin esto, la vía «set anidado en una carta»
   *     borraría lo que la vía `GET /v2/sets` ya escribió, y el logo aparecería y desaparecería según
   *     qué botón de M2 se pulsó último. Misma clase de invariante que M-44 impuso sobre
   *     `PriceReference` (un escritor no degrada lo que otro afirmó), aquí en su versión barata:
   *     cosmética, no dinero, pero con el mismo modo de fallo silencioso.
   *
   * La composición de (1) y (2) es deliberada: una URL rechazada se trata EXACTAMENTE como ausente. Si
   * el `update` la mapeara a `null`, un glitch del proveedor (una URL `http:` un día) BORRARÍA un logo
   * bueno — que es justo lo que la regla 2 existe para impedir. «Nunca se persiste una URL mala» y
   * «nunca se borra una buena» se cumplen las dos a la vez solo así.
   *
   * Money-safe: `CardSet` no entra en ningún cálculo de precio (§4.39.9).
   */
  private async upsertSet(rs: RemoteCardSet) {
    const logoUrl = this.sanitizeSetImageUrl(rs.images?.logo, rs.id, 'logo');
    const symbolUrl = this.sanitizeSetImageUrl(rs.images?.symbol, rs.id, 'symbol');
    // PROJECTION-EXEMPT: helper PRIVADO del sync (`upsertSet`); su resultado se consume dentro del
    // propio job para llavear las cartas. No lo devuelve ningún controller.
    return this.prisma.cardSet.upsert({
      where: { externalId: rs.id },
      create: {
        externalId: rs.id,
        name: rs.name,
        series: rs.series,
        releaseDate: rs.releaseDate,
        printedTotal: rs.printedTotal,
        ptcgoCode: rs.ptcgoCode,
        // Set NUEVO: no hay nada que degradar ⇒ ausente/rechazada = `null` (§4.39.4).
        logoUrl,
        symbolUrl,
      },
      update: {
        name: rs.name,
        series: rs.series,
        releaseDate: rs.releaseDate,
        printedTotal: rs.printedTotal,
        ptcgoCode: rs.ptcgoCode,
        // NO-DEGRADACIÓN: la clave NI SIQUIERA VIAJA cuando no hay valor bueno ⇒ Prisma deja la
        // columna intacta. (`logoUrl: undefined` también sería no-op, pero omitirla lo hace explícito.)
        ...(logoUrl !== null ? { logoUrl } : {}),
        ...(symbolUrl !== null ? { symbolUrl } : {}),
      },
    });
  }

  /**
   * v1.52-set-logos (M-47, §4.39.4) — guardarraíl de ingesta de las **imágenes de SET**. Devuelve la
   * URL **normalizada** (`URL.href`) SOLO si es absoluta, `https:`, **sin credenciales embebidas**, y
   * cuyo **`host` COMPLETO** (hostname + puerto) empata por **igualdad EXACTA** con una de las entradas
   * de `SET_IMAGE_HOSTS` (conjunto CERRADO, hoy **dos** CDNs del proveedor); cualquier otra cosa ⇒
   * `null` + log (nunca se persiste). **El porqué de los dos hosts, con la evidencia de producción, y el
   * procedimiento para añadir un tercero, están en el comentario de `SET_IMAGE_HOSTS`** (arriba del
   * archivo) — no se duplican aquí para que no diverjan.
   *
   * **ALCANCE — leer esto antes de citarlo como postura de seguridad.** Esto cubre **las dos columnas
   * que M-47 introduce** (`CardSet.logoUrl` / `symbolUrl`) y **nada más**. NO es «lo único que hay que
   * mirar»: el **arte de carta** (`upsertCards` → `Card.imageSmallUrl` / `imageLargeUrl`, unas 90
   * líneas más abajo) persiste `images.small`/`images.large` del **mismo proveedor SIN ninguna
   * validación**, y ésas sí se renderizan en todo el sitio. Esa brecha es **anterior a M-47** y este
   * pase **no la cierra a propósito** (unificar los tres criterios vigentes —éste, el del sellado en
   * `inventory/sealed-image-host.ts`, y el ninguno del arte de carta— exige un helper en
   * `backend/src/common/`, **zona compartida** que otra sesión tiene abierta). Registrada como **R1**
   * en `docs/TECH_DEBT.md`, con disparador explícito.
   *
   * Rigor alineado con `sanitizeSealedImageUrl` (`inventory/sealed-image-host.ts`), que es el
   * precedente de la casa para esta misma amenaza:
   *  - **`host`, no `hostname`.** `hostname` DESCARTA el puerto ⇒ `https://images.pokemontcg.io:8443/x`
   *    habría pasado. `host` lo incluye (y el WHATWG URL ya elide el `:443` por defecto).
   *  - **Sin userinfo.** `https://evil@images.pokemontcg.io/logo.png` se rechaza: las credenciales
   *    embebidas existen para confundir sobre quién es el host de verdad.
   *  - **Se persiste `parsed.href`, no la cadena cruda.** `new URL` TOLERA espacios y caracteres de
   *    control (C0) al borde y tabs/saltos interiores: los elimina o los percent-encodea. Guardar el
   *    crudo metería en la BD exactamente lo que el parser acaba de perdonar. Para una URL limpia
   *    `href === raw`, así que esto no reescribe nada legítimo.
   *
   * Si el proveedor empieza a servir imágenes desde OTRO host, backend NO amplía `SET_IMAGE_HOSTS` por
   * su cuenta: lo reporta al arquitecto, y `remotePatterns` del frontend se amplía DETRÁS, nunca por
   * delante (§5.3.4). Y **jamás** se «arregla» aflojando la comparación a sufijo/comodín: eso deja pasar
   * `images.pokemontcg.io.evil.com`, que es el vector que este guardarraíl existe para parar.
   */
  private sanitizeSetImageUrl(
    raw: string | undefined | null,
    setExternalId: string,
    kind: 'logo' | 'symbol',
  ): string | null {
    if (typeof raw !== 'string' || raw.trim() === '') return null;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      // N-3 — POR QUÉ ESTE LOG **NO** INTERPOLA `raw`, y por qué no es un descuido que arreglar
      // devolviéndolo:
      //  · En esta rama el parseo FALLÓ ⇒ no existe ninguna forma normalizada de la cadena. Volcarla
      //    sería escribir en el log, verbatim, exactamente lo que se acaba de declarar NO CONFIABLE.
      //  · Una cadena con `CRLF` puede **forjar líneas de log** (log injection): un atacante que
      //    controle el upstream podría fabricar una línea que parezca de otro subsistema. `raw` viene
      //    de un tercero, y ésta es la ÚNICA rama donde no ha pasado por el parser.
      //  · `M47-D1` (docs/TECH_DEBT.md) se apoya en estos `warn` como **única señal** de que una URL
      //    se está rechazando de forma indefinida ⇒ tienen que ser greppables y NO forjables. Un
      //    prefijo estable (`upsertSet(<setId>): images.<kind>`) vale más que el contenido crudo.
      //  · El diagnóstico queda REDUCIDO, no perdido: set + tipo de imagen + `length` (un número no
      //    puede forjar una línea, y distingue «vino basura larga» de «vino un token corto»). Para ver
      //    la cadena exacta está la respuesta del proveedor, no nuestro log.
      this.logger.warn(
        `upsertSet(${setExternalId}): images.${kind} no es una URL absoluta ` +
          `(longitud=${raw.length}; se OMITE el valor crudo a propósito, ver N-3); NO se persiste (M-47).`,
      );
      return null;
    }
    // Credenciales embebidas: mismo rechazo que `sanitizeSealedImageUrl` (§4.32c) — `https://evil@host/`
    // existe para que el host real pase desapercibido.
    if (parsed.username !== '' || parsed.password !== '') {
      // A DIFERENCIA de la rama de arriba, aquí `parsed` SÍ existe ⇒ sí se puede nombrar contra qué se
      // rechazó. `URL.host` es un componente ya PARSEADO y normalizado: el WHATWG URL prohíbe C0/espacio
      // en el host y elimina tab/CR/LF de la entrada antes de parsear ⇒ **no puede forjar una línea**.
      // Es justo el dato diagnosticable (`…@evil.com` vs `evil@images.pokemontcg.io`), sin volcar la
      // cadena no confiable. El userinfo NO se registra: es el material sensible del caso.
      this.logger.warn(
        `upsertSet(${setExternalId}): images.${kind} trae credenciales embebidas (userinfo) ` +
          `sobre el host ${parsed.host}; NO se persiste (M-47, §4.39.4).`,
      );
      return null;
    }
    // `host` (hostname + puerto) contra el conjunto CERRADO, por igualdad EXACTA (`Set.has`): NO
    // `endsWith`, NO sufijo de dominio raíz. `images.pokemontcg.io.evil.com` debe seguir cayendo aquí.
    if (parsed.protocol !== 'https:' || !SET_IMAGE_HOSTS.has(parsed.host.toLowerCase())) {
      this.logger.warn(
        `upsertSet(${setExternalId}): images.${kind} fuera del guardarraíl ${SET_IMAGE_HOSTS_LABEL} ` +
          `(${parsed.protocol}//${parsed.host}); NO se persiste (M-47, §4.39.4).`,
      );
      return null;
    }
    // Forma NORMALIZADA: lo que entra a la BD es lo que el parser validó, no la cadena cruda.
    return parsed.href;
  }

  /**
   * Upsert idempotente de cartas por externalId. `rarity` = String libre (rarezas modernas).
   *
   * ROBUSTEZ (bug prod: "el sync importaba solo 1 carta por set"): cada carta se aísla en su
   * propio try/catch. Si UNA carta truena (dato inválido del API, colisión inesperada, etc.) se
   * REGISTRA y se CONTINÚA con las demás — nunca aborta la importación del set entero. Los campos
   * requeridos ausentes se manejan con gracia (`number` → ''), y una carta sin `id`/`name` (no
   * persistible) se omite con log en vez de reventar el barrido.
   *
   * v1.22-1 (§4.22g) → v1.27 (P-13, §4.25a) — aquí se deriva **`Card.catalogFinishes`** (la «opinión
   * del catálogo» pokemontcg.io), hoy una columna WRITE-ONLY de señal DÉBIL: desde v1.26 NO alimenta
   * al reconciliador (su entrada es `structuralFinishes`, del resolver TCGCSV) y nadie la lee en
   * producción — se conserva como observabilidad/registro de lo que opinó el payload remoto.
   * `availableFinishes` sigue siendo DERIVADA con ÚNICO escritor `FinishReconciler`. La derivación de
   * `catalogFinishes` usa DOS señales del payload remoto (`tcgplayer.prices` por LLAVE PRESENTE ∪
   * `cardmarket.prices.reverseHolo*` por VALOR > 0) con la MISMA semántica null de §4.22a-4:
   *   - CREATE → `derived ?? ['normal']` (conservador: UNA casilla, jamás relleno);
   *   - UPDATE → la clave `catalogFinishes` se incluye SOLO si `derived !== null`; sin señal se OMITE
   *     y se CONSERVA lo previo (un payload/502 degradado no puede volver a clobbear a `['normal']`).
   * Tras el lote, LLAMA a `FinishReconciler.reconcile(cardIds)` para que recompute
   * `availableFinishes` de las cartas tocadas. v1.29 (§4.27c) DEROGÓ la heurística
   * `composeAvailableFinishes(structuralFinishes, pricedFinishesSnapshot, rarity)`: el reconciliador YA
   * NO une señales ni filtra `normal` por rareza premium. La lista blanca se DERIVA DIRECTO de la unión
   * de `CardProduct.finishes` (kinds `set_base`/`other`) por productId exacto, `|| ['normal']`. Las
   * columnas `structuralFinishes`/`catalogFinishes`/`pricedFinishesSnapshot` quedan MUERTAS (write-only,
   * nadie las lee para componer).
   * Además puebla las claves de ORDEN NATURAL `numberSort`/`numberPrefix` (M-26, §4.22b) con
   * `deriveNumberParts` — la MISMA función que espeja el backfill SQL. Ya NO se puebla
   * `PriceReference` (WS-A §4.15g: este sync es SOLO metadata).
   */
  private async upsertCards(cards: RemoteCard[], localSetId: string): Promise<number> {
    let count = 0;
    // §4.22a-5 — observabilidad en vez de adivinanza: cuántas cartas del lote no trajeron NINGUNA
    // señal de acabado. No se rellena nada; la carencia se hace VISIBLE en el log del sync.
    let noFinishSignal = 0;
    const touchedCardIds: string[] = [];
    for (const c of cards) {
      if (!c?.id || !c?.name) {
        this.logger.warn(
          `sync: carta inválida omitida (id=${c?.id ?? '?'}, name=${c?.name ?? '?'}) — no aborta el set.`,
        );
        continue;
      }
      // v1.22 (§4.22a-3): `null` = el payload NO trae NINGUNA señal de acabado (≠ «solo normal»).
      const derived = deriveAvailableFinishes(c);
      if (derived === null) noFinishSignal += 1;
      const number = c.number ?? '';
      // M-26 (§4.22b): claves persistidas del orden natural, escritas en create Y update.
      const parts = deriveNumberParts(number);
      // v1.26 (§4.24a): puebla `Card.tcgplayerId` parseando el `productId` de `tcgplayer.url`
      // (`.../product/<id>`). Es el ANCLA del join a TCGCSV (resolver estructural) y lo usa P-7. Se
      // incluye SOLO cuando se pudo parsear (null ⇒ se OMITE la clave: no clobbea un ancla previo).
      const tcgplayerId = parseTcgplayerProductId(c.tcgplayer?.url);
      const data = {
        setId: localSetId,
        name: c.name,
        number,
        numberSort: parts.numberSort,
        numberPrefix: parts.prefix,
        rarity: c.rarity ?? null,
        // v1.29 (§4.28c): `rarity` CRUDO se conserva (procedencia); `rarityCanonical` DERIVADO en el
        // ingest empata 1:1 con las keys que el admin edita en las reglas por rareza. Lo consumen
        // precios (lookup) y el `groupBy(['rarityCanonical'])` del admin.
        rarityCanonical: normalizeRarity(c.rarity),
        supertype: c.supertype ?? null,
        subtypes: c.subtypes ?? undefined,
        imageSmallUrl: c.images?.small ?? null,
        imageLargeUrl: c.images?.large ?? null,
        ...(tcgplayerId !== null ? { tcgplayerId } : {}),
      };
      try {
        const upserted = await this.prisma.card.upsert({
          where: { externalId: c.id },
          // CREATE: sin señal → catalogFinishes ['normal'] (una casilla, nunca relleno). v1.26
          // (§4.24a): SEED de `structuralFinishes` con la MISMA señal (`derived ?? ['normal']`),
          // para que la carta no quede en blanco antes de que corra el resolver TCGCSV.
          create: {
            externalId: c.id,
            ...data,
            catalogFinishes: derived ?? ['normal'],
            structuralFinishes: derived ?? ['normal'],
          },
          // UPDATE: sin señal → se OMITE la clave `catalogFinishes` y se conserva lo previo (§4.22a-4).
          // v1.26 (§4.24a): UPDATE **NUNCA** toca `structuralFinishes` (pokemontcg.io no es autoridad
          // estructural; la autoridad de UPDATE es el resolver TCGCSV de `importSet`).
          update: derived === null ? data : { ...data, catalogFinishes: derived },
          select: { id: true },
        });
        touchedCardIds.push(upserted.id);
        count += 1;
      } catch (e) {
        // Una carta mala NO tira el set: se omite y se sigue (importación parcial > 1 carta).
        this.logger.warn(
          `sync: carta ${c.id} falló y se omite (no aborta el set): ${(e as Error).message}`,
        );
      }
    }
    // v1.29 (§4.27c): `availableFinishes` la escribe SOLO el reconciliador, DERIVÁNDOLA de la unión de
    // `CardProduct.finishes` (kinds set_base/other, por productId exacto) — SIN unir señales y SIN
    // filtrar `normal` por rareza premium (la vieja `composeAvailableFinishes` quedó derogada;
    // `catalogFinishes`/`structuralFinishes`/`pricedFinishesSnapshot` son columnas muertas write-only).
    // Aquí solo se garantiza que las cartas tocadas queden recompuestas.
    await this.finishReconciler.reconcile(touchedCardIds);
    if (noFinishSignal > 0) {
      this.logger.warn(
        `sync: cardsWithoutFinishSignal=${noFinishSignal}/${cards.length} en el lote del set ` +
          `${localSetId} — payload sin tcgplayer.prices ni cardmarket.reverseHolo* (§4.22a-5). ` +
          `NO se sobrescribió catalogFinishes de esas cartas (se conservó lo previo).`,
      );
    }
    return count;
  }

  /** Conteo de cartas locales agrupado por externalId del set (para remote-sets). */
  /**
   * ⭐ RESOLVER ÚNICO DEL CORTE DE FECHA — «¿desde qué fecha importa este catálogo?».
   *
   * Hoy el corte sale del dial `catalog_sync_from_date` (editable en M10, seed `2024/01/01`), y
   * ésta es la ÚNICA función que lo lee: la usan `sync()` (modo from_date, donde el request puede
   * pasar un `fromReleaseDate` explícito que manda sobre el dial) y `syncAll()`.
   *
   * ⚠️ **Es una costura deliberada.** El dueño pidió que el corte deje de ser un valor que alguien
   * mueve a mano («estar moviendo cosas manuales deja a que se rompa algo por falta de cuidado o
   * supervisión») y el ARQUITECTO está decidiendo el mecanismo automático (ventana rodante u otro).
   * Cuando ese mecanismo llegue, aterriza **aquí dentro** y ningún llamador cambia. NO se decide
   * aquí: hoy esta función sólo lee el dial y valida su formato.
   *
   * Formato inválido ⇒ `VALIDATION_ERROR` accionable en vez de adivinar: adivinar un corte
   * significa, en la práctica, o barrer el catálogo entero o no barrer nada — dos silencios caros.
   */
  private async resolveCatalogFromDate(explicit?: string): Promise<string> {
    const from =
      explicit ?? (await this.settings.getString(SettingKey.CATALOG_SYNC_FROM_DATE));
    if (!DATE_PATTERN.test(from)) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        explicit != null
          ? 'fromReleaseDate must be yyyy/MM/dd'
          : `El dial catalog_sync_from_date tiene un valor inválido ("${from}"); se espera ` +
            `yyyy/MM/dd. Corrígelo en Ajustes (M10) y reintenta.`,
      );
    }
    return from;
  }

  /**
   * ⭐ PREDICADO «CARTAS LOCALES DE UN SET» — fuente ÚNICA por-set (ARCHITECTURE §0-B.3 regla 8
   * llevada al código: una cuenta vive en UN sitio).
   *
   * Cuenta filas `Card` cuyo `setId` es el set local dado. Es el **universo** del set, y NO tiene
   * nada que ver con «cuántas cartas tocó esta corrida» — ése es otro predicado, con otro nombre
   * (`cardsUpserted` en el import, `cardsProcessed`/`cardsTouched` en `refresh-variants`).
   * Confundirlos es exactamente D2: se reportaba el universo bajo la etiqueta «procesadas».
   *
   * Implementaciones vivas de este MISMO predicado y por qué existen:
   *  - ésta (por-set, la canónica): gate de first-import y universo de `refresh-variants`;
   *  - `localCardCountsByExternalSetId()` (forma EN LOTE, un `groupBy` implícito por set) para
   *    `remote-sets`, donde hace falta el conteo de TODOS los sets en una sola consulta.
   * Si el predicado cambia, cambian las dos — no hay una tercera.
   */
  private async countLocalCardsInSet(localSetId: string): Promise<number> {
    return this.prisma.card.count({ where: { setId: localSetId } });
  }

  /**
   * PREDICADO «EL SET EXISTE LOCALMENTE» — hay fila `CardSet` con ese `externalId`, **con o sin
   * cartas**. Es el criterio de `remote-sets.imported` y el de los candidatos de `backfill`.
   * NO es el mismo que «set importado de verdad» (abajo): un `CardSet` vacío existe pero no tiene
   * ni una carta. Llevan nombres distintos justamente porque son predicados distintos.
   */
  /**
   * PREDICADO «SET IMPORTADO DE VERDAD» — existe fila `CardSet` **y** tiene al menos una `Card`.
   * Fuente ÚNICA: lo usan `sync-all` (qué sets saltar) y `refresh-variants-all` (qué sets barrer),
   * que antes lo calculaban cada uno por su cuenta con el mismo `findMany` copiado.
   * Distinto de `localSetExternalIds()` (existencia a secas) — otro nombre, otro criterio.
   */
  private async localSetExternalIdsWithCards(): Promise<string[]> {
    const sets = await this.prisma.cardSet.findMany({
      select: { externalId: true, _count: { select: { cards: true } } },
    });
    return sets.filter((s) => s._count.cards > 0).map((s) => s.externalId);
  }

  private async localSetExternalIds(): Promise<Set<string>> {
    const sets = await this.prisma.cardSet.findMany({ select: { externalId: true } });
    return new Set(sets.map((s) => s.externalId));
  }

  private async localCardCountsByExternalSetId(): Promise<Map<string, number>> {
    const sets = await this.prisma.cardSet.findMany({
      select: { externalId: true, _count: { select: { cards: true } } },
    });
    const map = new Map<string, number>();
    for (const s of sets) map.set(s.externalId, s._count.cards);
    return map;
  }
}

/**
 * v1.26 (§4.24a) — extrae el `productId` de TCGplayer de una `tcgplayer.url` de pokemontcg.io
 * (`https://www.tcgplayer.com/product/<id>/...` o `.../product/<id>`). Devuelve el id como STRING
 * (el tipo de `Card.tcgplayerId`) o `null` si la url falta o no calza el patrón. Anti-basura: solo
 * acepta un id puramente numérico tras `/product/`.
 */
export function parseTcgplayerProductId(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null;
  const m = url.match(/\/product\/(\d+)(?:[/?#]|$)/);
  return m ? m[1] : null;
}
