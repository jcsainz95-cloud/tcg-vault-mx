import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { ErrorCode } from '../../common/error-codes';
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
/** Formato de fecha de pokemontcg.io (`yyyy/MM/dd`). */
const DATE_PATTERN = /^\d{4}\/\d{2}\/\d{2}$/;
/**
 * v1.52-set-logos (M-47, §4.39.4) — ÚNICO host admitido para las imágenes de set. Es el MISMO que ya
 * sirve el arte de todas las cartas del sitio ⇒ `remotePatterns` del frontend NO cambia (§5.3.4) y no
 * hay superficie nueva para seguridad. NO se amplía sin pasar por arquitecto/frontend.
 *
 * Se compara contra `URL.host` (hostname **+ puerto**), no contra `hostname`: al no llevar puerto, esta
 * constante solo empata con el puerto https por defecto (el WHATWG URL elide `:443`). Un
 * `images.pokemontcg.io:8443` es OTRO endpoint y se rechaza.
 */
export const SET_IMAGE_HOST = 'images.pokemontcg.io';

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
      return {
        jobId: `catalog-sync-${Date.now()}`,
        setsQueued: res.imported ? 1 : 0,
        mode: 'single' as const,
      };
    }

    const from =
      fromReleaseDate ?? (await this.settings.getString(SettingKey.CATALOG_SYNC_FROM_DATE));
    if (!DATE_PATTERN.test(from)) {
      throw BusinessException.validation('VALIDATION_ERROR', 'fromReleaseDate must be yyyy/MM/dd');
    }
    const remote = await this.client.getSets();
    const toImport = remote.filter((s) => (s.releaseDate ?? '') >= from);
    let setsQueued = 0;
    for (const s of toImport) {
      const res = await this.importSet(s, { force });
      if (res.imported) setsQueued += 1;
    }
    return { jobId: `catalog-sync-${Date.now()}`, setsQueued, mode: 'from_date' as const };
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
    cardsProcessed: number;
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
      select: { id: true, _count: { select: { cards: true } } },
    });
    if (!localSet || localSet._count.cards === 0) {
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

    const cardsProcessed = localSet._count.cards;
    if (result == null) {
      // TCGCSV respondió, pero no se resolvió un groupId ÚNICO ⇒ no se tocó nada (money-safe).
      this.logger.warn(
        `refresh-variants: set ${setId} sin groupId TCGCSV ÚNICO; no se tocó ningún CardProduct.`,
      );
      return {
        ok: true,
        setId,
        cardsProcessed,
        cardProductsUpserted: 0,
        pricesUpserted: 0,
        pending: 0,
        tcgcsvReachable: true,
      };
    }
    return {
      ok: true,
      setId,
      cardsProcessed,
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
    const localSets = await this.prisma.cardSet.findMany({ select: { externalId: true } });
    const importedIds = new Set(localSets.map((s) => s.externalId));

    // Candidatos = sets remotos (con force NO se filtran los importados; sin force, solo los NO
    // importados), opcionalmente acotados por untilYear (no más antiguos que ese año), ordenados
    // de más ANTIGUO a más nuevo.
    const candidates = remote
      .filter((s) => (force ? true : !importedIds.has(s.id)))
      .filter((s) => (untilYear == null ? true : (yearFromReleaseDate(s.releaseDate) ?? 0) >= untilYear))
      .sort((a, b) => (a.releaseDate ?? '').localeCompare(b.releaseDate ?? ''));

    const batch = candidates.slice(0, size);
    const imported: { id: string; name: string; releaseDate: string | null; cardCount: number }[] = [];
    for (const s of batch) {
      // v1.26 (§4.24a): con force se re-resuelve también la composición estructural (repara).
      const res = await this.importSet(s, { force });
      if (res.imported) {
        imported.push({ id: s.id, name: s.name, releaseDate: s.releaseDate ?? null, cardCount: res.cardCount });
      }
    }

    // newBoundary = releaseDate del set más ANTIGUO ya importado tras el lote.
    const allImported = await this.prisma.cardSet.findMany({
      where: { releaseDate: { not: null } },
      select: { releaseDate: true },
      orderBy: { releaseDate: 'asc' },
      take: 1,
    });
    const newBoundary = allImported[0]?.releaseDate ?? null;
    const remaining = candidates.length - imported.length;
    return { imported, newBoundary, remaining };
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
  } = { running: false, jobId: null, total: 0, done: 0, startedAt: null, finishedAt: null };

  /** GET /admin/catalog/sync-status — progreso del barrido en curso (o del último). */
  getSyncStatus() {
    return { ...this.syncAllStatus };
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
    summary: {
      setsTotal: number;
      setsOk: number;
      setsFailed: number;
      cardProductsUpserted: number;
      pricesUpserted: number;
      pending: number;
      failures: { setId: string; code: string; message: string }[];
    } | null;
  } = {
    running: false,
    jobId: null,
    total: 0,
    done: 0,
    startedAt: null,
    finishedAt: null,
    summary: null,
  };

  /** Resumen agregado en ceros (arranque de un barrido). */
  private static emptyRefreshVariantsSummary(): {
    setsTotal: number;
    setsOk: number;
    setsFailed: number;
    cardProductsUpserted: number;
    pricesUpserted: number;
    pending: number;
    failures: { setId: string; code: string; message: string }[];
  } {
    return {
      setsTotal: 0,
      setsOk: 0,
      setsFailed: 0,
      cardProductsUpserted: 0,
      pricesUpserted: 0,
      pending: 0,
      failures: [],
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
        summary == null ? null : { ...summary, failures: [...summary.failures] },
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
  ): Promise<{ jobId: string; setsQueued: number; remaining: number }> {
    const force = options.force ?? false;
    const remote = await this.client.getSets();
    const local = await this.prisma.cardSet.findMany({
      select: { externalId: true, _count: { select: { cards: true } } },
    });
    // "Importado" = set local con al menos una carta (evita reprocesar sets ya poblados).
    const importedWithCards = new Set(
      local.filter((s) => s._count.cards > 0).map((s) => s.externalId),
    );
    // force=true → reprocesa TODOS los sets remotos (no filtra los ya poblados) para refrescar
    // availableFinishes; force=false (default) → solo los pendientes (comportamiento hoy).
    const pending = force ? [...remote] : remote.filter((s) => !importedWithCards.has(s.id));
    const jobId = `catalog-sync-all-${Date.now()}`;

    if (this.syncAllStatus.running) {
      // Ya hay un barrido en curso → no lanzamos otro; reportamos lo que falta.
      return { jobId, setsQueued: 0, remaining: pending.length };
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
    };
    // Fire-and-forget: el request NO espera a que se importen todos los sets.
    void this.runSyncAll(batch, force).finally(() => {
      this.syncAllStatus.running = false;
      this.syncAllStatus.finishedAt = new Date().toISOString();
    });
    // `setsQueued` = sets encolados en esta llamada; `remaining` = sets aún sin importar que
    // NO se encolaron (0: encolamos todos los pendientes).
    return { jobId, setsQueued: batch.length, remaining: 0 };
  }

  /** Barrido en segundo plano de `sync-all`: importa cada set secuencialmente (rate-limit). */
  async runSyncAll(sets: RemoteCardSet[], force = false): Promise<void> {
    for (const s of sets) {
      try {
        await this.importSet(s, { force });
      } catch (e) {
        this.logger.warn(`sync-all: set ${s.id} falló: ${(e as Error).message}`);
      } finally {
        // Avanza el progreso por set intentado (éxito o fallo) → barra honesta done/total.
        this.syncAllStatus.done += 1;
      }
    }
    this.logger.log(`sync-all: barrido de ${sets.length} sets completado.`);
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
    const local = await this.prisma.cardSet.findMany({
      select: { externalId: true, _count: { select: { cards: true } } },
    });
    const importedExternalIds = local
      .filter((s) => s._count.cards > 0)
      .map((s) => s.externalId);
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
        summary.setsOk += 1;
        summary.cardProductsUpserted += res.cardProductsUpserted;
        summary.pricesUpserted += res.pricesUpserted;
        summary.pending += res.pending;
      } catch (e) {
        const code =
          e instanceof BusinessException ? String(e.code) : String(ErrorCode.UPSTREAM_ERROR);
        summary.setsFailed += 1;
        summary.failures.push({
          setId,
          code,
          message: (e as Error).message,
        });
        this.logger.warn(
          `refresh-variants-all: set ${setId} falló (${code}): ${(e as Error).message} — ` +
            `NO aborta el barrido, sigue con el siguiente (money-safe).`,
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
        `(ok=${summary.setsOk}, failed=${summary.setsFailed}).`,
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
  ): Promise<{ imported: boolean; cardCount: number }> {
    const localSet = await this.upsertSet(rs);
    // first-import = el set local no tenía NINGUNA carta antes de este import. Solo se calcula
    // cuando el resolver está cableado (los tests de sync/metadata lo construyen sin él).
    const firstImport =
      this.cardProductResolver != null
        ? (await this.prisma.card.count({ where: { setId: localSet.id } })) === 0
        : false;
    const cardCount = await this.importCardsForSet(rs.id, localSet.id);
    if (firstImport || opts.force === true) {
      await this.runCardProductResolver(localSet.id, rs.id);
    }
    return { imported: true, cardCount };
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
  ): Promise<{ imported: boolean; cardCount: number }> {
    const first = await this.withUpstreamGuard(() => this.client.getCardsBySet(setId, 1));
    if (!first.data || first.data.length === 0) {
      return { imported: false, cardCount: 0 };
    }
    const localSet = await this.upsertSet(first.data[0].set);
    // first-import = el set local no tenía NINGUNA carta antes de este import (mismo criterio que
    // `importSet`); solo se calcula cuando el resolver está cableado (tests de metadata sin él).
    const firstImport =
      this.cardProductResolver != null
        ? (await this.prisma.card.count({ where: { setId: localSet.id } })) === 0
        : false;
    let cardCount = await this.upsertCards(first.data, localSet.id);
    cardCount += await this.withUpstreamGuard(() =>
      this.importRemainingPages(setId, localSet.id, first),
    );
    if (firstImport || opts.force === true) {
      await this.runCardProductResolver(localSet.id, setId);
    }
    return { imported: true, cardCount };
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
   * cuyo **`host` COMPLETO** (hostname + puerto) es exactamente el del CDN del proveedor; cualquier
   * otra cosa ⇒ `null` + log (nunca se persiste).
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
   * Si pokemontcg.io empezara a servir imágenes desde OTRO host, backend NO amplía esta lista por su
   * cuenta: lo reporta, y `remotePatterns` del frontend se amplía DETRÁS, nunca por delante (§5.3.4).
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
      this.logger.warn(
        `upsertSet(${setExternalId}): images.${kind} no es una URL absoluta; NO se persiste (M-47).`,
      );
      return null;
    }
    // Credenciales embebidas: mismo rechazo que `sanitizeSealedImageUrl` (§4.32c) — `https://evil@host/`
    // existe para que el host real pase desapercibido.
    if (parsed.username !== '' || parsed.password !== '') {
      this.logger.warn(
        `upsertSet(${setExternalId}): images.${kind} trae credenciales embebidas (userinfo); ` +
          `NO se persiste (M-47, §4.39.4).`,
      );
      return null;
    }
    // `host` (hostname + puerto), NO `hostname`: un puerto no estándar es OTRO endpoint.
    if (parsed.protocol !== 'https:' || parsed.host.toLowerCase() !== SET_IMAGE_HOST) {
      this.logger.warn(
        `upsertSet(${setExternalId}): images.${kind} fuera del guardarraíl https://${SET_IMAGE_HOST} ` +
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
