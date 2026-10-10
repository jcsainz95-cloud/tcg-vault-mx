import { Injectable } from '@nestjs/common';
import {
  AccessoryCategory,
  Card,
  CardSet,
  EnergyType,
  MetaCardGroup,
  MetaDeckSource,
  MetaMatchStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService, DeckMetaUnitDTO } from '../catalog/catalog.service';
import { BusinessException } from '../../common/business.exception';
import { PiiCryptoService } from '../../common/crypto/pii-crypto.service';
import { SETTING_DEFAULTS, SettingKey } from '../settings/settings.constants';
import { signPullToken, verifyPullToken } from './deck-pull-token';
import {
  DeckFact,
  DeckListFact,
  DeckPullEvaluation,
  DeckPullInput,
  EnergyProduct,
  accessoryPhotoOf,
  computeEnergyBundleOffer,
  evaluateDeckPulls,
} from './energy-bundle';
import { energyTypeOf } from './energy-type';
import { parseDeckList } from './deck-list.parser';
import { imageOf, pickDeckImage } from './deck-image';
import { DeckMatcherService, MatchedLine } from './deck-matcher.service';
import {
  AUTOFETCH_DIAL_VALUES,
  AutofetchDial,
  DIAL_AUTOFETCH,
  DIAL_AUTOPUBLISH,
  normalizeAutofetchDial,
  normalizeAutopublishDial,
} from './limitless.config';
import {
  MetaDeckDetailDTO,
  MetaDeckGroupsDTO,
  MetaBasicEnergyDTO,
  MetaDeckLineDTO,
  MetaDeckListResponseDTO,
  MetaDeckCardTileDTO,
  MetaPasteResponseDTO,
} from './decks-meta.dto';

/** Cita de fuente del meta. El ranking del meta procede de Limitless aunque la lista sea curada. */
const META_SOURCE_LABEL = 'Datos de Limitless TCG';
const MANUAL_SOURCE_LABEL = 'Curado por el equipo TCG HUNT';

/**
 * §AC.2 (2) — dial del precio del paquete (IVA dentro). Clave y default de `settings.constants` (una sola fuente; la
 * validación del `PUT /admin/settings` es 1..100_000, la misma que aquí).
 */
export const ENERGY_BUNDLE_PRICE_KEY = SettingKey.ENERGY_BUNDLE_PRICE_CENTS;
export const ENERGY_BUNDLE_PRICE_DEFAULT_CENTS = SETTING_DEFAULTS[SettingKey.ENERGY_BUNDLE_PRICE_CENTS] as number;
const ENERGY_BUNDLE_PRICE_MAX_CENTS = 100_000;

/** Lector de BD que sirve igual con `PrismaService` que con el cliente de una transacción. */
type Db = Prisma.TransactionClient | PrismaService;

/** Normaliza el dial: entero en 1..100_000 ⇒ ese; cualquier otra cosa (ausente, corrupto) ⇒ el default. */
export function normalizeEnergyBundlePrice(raw: unknown): number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 1 && raw <= ENERGY_BUNDLE_PRICE_MAX_CENTS
    ? raw
    : ENERGY_BUNDLE_PRICE_DEFAULT_CENTS;
}

/** Estado del dial de auto-fetch (leído fail-closed desde `ConfigSetting`). */
export type DialState = { autofetch: AutofetchDial; autopublish: boolean };

/** Una línea persistida de una lista, con la carta casada (o null) para valorar. */
type StoredLine = {
  rawName: string;
  rawSetCode: string;
  rawNumber: string;
  quantity: number;
  group: MetaCardGroup;
  matchStatus: MetaMatchStatus;
  matchedCard: (Card & { set: CardSet }) | null;
};

@Injectable()
export class DecksMetaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly matcher: DeckMatcherService,
    private readonly pii: PiiCryptoService,
  ) {}


  // ────────────────────────────────────────────────────────────────────────────────────────────
  // El constructor de disponibilidad por línea — REUSA precio/disponibilidad. NO reinventa precio
  // (regla dura del dueño). Money-adjacent. FUENTE-CONFIABLE (SUP-LEG): NO re-filtra por legalidad
  // (Limitless ya publica solo listas Standard-legal); toda carta casada con stock se ofrece.
  // ────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Construye las líneas agrupadas (pokemon/trainer/energy) a partir de líneas ya casadas.
   * - Una carta casada SIEMPRE ofrece su stock (`unitInventoryItemIds`); no hay compuerta de legalidad.
   * - `availableQty = min(quantity, stockNM)`; sin stock ⇒ 0 y sin piezas.
   * - `unitPriceMxnCents` = «desde» (displayPriceCents de la pieza más barata); `null` si faltante/pending.
   * - Lo NO casado NO aporta `unitInventoryItemIds` propios (§13).
   */
  async buildGroups(
    lines: StoredLine[],
    energyProducts: ReadonlyMap<EnergyType, EnergyProduct> = new Map(),
  ): Promise<MetaDeckGroupsDTO> {
    // Piezas RAW NM vendibles de todas las cartas casadas, EN LOTE (una lectura, sin N+1).
    const cardIds = lines
      .filter((l) => l.matchStatus === MetaMatchStatus.matched && l.matchedCard)
      .map((l) => l.matchedCard!.id);
    const unitsByCard = await this.catalog.getSellableRawUnitsByCardIds(cardIds);

    const groups: MetaDeckGroupsDTO = { pokemon: [], trainer: [], energy: [] };
    for (const line of lines) {
      const dto = this.buildLine(line, unitsByCard);
      // §AC.8: ADITIVO. No toca `unitInventoryItemIds`/`availableQty`/`unitPriceMxnCents` (criterio 747).
      dto.basicEnergy = basicEnergyOf(line, energyProducts);
      groups[groupKey(line.group)].push(dto);
    }
    return groups;
  }

  private buildLine(
    line: StoredLine,
    unitsByCard: Map<string, DeckMetaUnitDTO[]>,
  ): MetaDeckLineDTO {
    const base = {
      rawName: line.rawName,
      setCode: line.rawSetCode || null,
      number: line.rawNumber || null,
      quantity: line.quantity,
      group: line.group,
      matchStatus: line.matchStatus,
    };

    const card = line.matchStatus === MetaMatchStatus.matched ? line.matchedCard : null;
    if (!card) {
      // No casó (o energía básica): se muestra «no identificada», sin carta/precio/piezas (§13).
      return {
        ...base,
        card: null,
        availableQty: 0,
        unitPriceMxnCents: null,
        unitInventoryItemIds: [],
      };
    }

    const cardDto = {
      cardId: card.id,
      name: card.name,
      imageUrl: imageOf(card),
    };

    // FUENTE-CONFIABLE (SUP-LEG): sin compuerta de legalidad. Una carta casada ofrece su stock.
    const units = unitsByCard.get(card.id) ?? [];
    const availableQty = Math.min(line.quantity, units.length);
    const offered = units.slice(0, availableQty);
    return {
      ...base,
      card: cardDto,
      availableQty,
      // «desde» = la pieza más barata ofrecida; null si no hay stock (faltante).
      unitPriceMxnCents: offered.length > 0 ? offered[0].priceMxnCents : null,
      unitInventoryItemIds: offered.map((u) => u.inventoryItemId),
    };
  }

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // Endpoints públicos
  // ────────────────────────────────────────────────────────────────────────────────────────────

  /** `GET /decks-meta` — top-10 publicado, por `rank` asc. */
  async listPublished(): Promise<MetaDeckListResponseDTO> {
    const decks = await this.prisma.metaDeck.findMany({
      where: { published: true, pausedByOperator: false },
      orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
      // `coverCard` = portada de Limitless casada por el job (rev `decks-portada`, §13): regla 2 de la teja.
      include: {
        currentList: {
          include: {
            coverCard: true,
            cards: { include: { matchedCard: { include: { set: true } } } },
          },
        },
      },
    });

    // Piezas de TODAS las cartas casadas de TODOS los decks, en UN lote (sin N+1 por deck).
    const allCardIds = decks.flatMap((d) =>
      (d.currentList?.cards ?? [])
        .filter((c) => c.matchStatus === MetaMatchStatus.matched && c.matchedCard)
        .map((c) => c.matchedCard!.id),
    );
    const unitsByCard = await this.catalog.getSellableRawUnitsByCardIds(allCardIds);

    let latestFetchedAt: Date | null = null;
    const data: MetaDeckCardTileDTO[] = decks.map((deck) => {
      const cards = deck.currentList?.cards ?? [];
      if (deck.currentList && (!latestFetchedAt || deck.currentList.fetchedAt > latestFetchedAt)) {
        latestFetchedAt = deck.currentList.fetchedAt;
      }
      let availableCount = 0;
      let totalCount = 0;
      let fromPriceMxnCents = 0;
      for (const c of cards) {
        totalCount += c.quantity;
        if (c.matchStatus !== MetaMatchStatus.matched || !c.matchedCard) continue;
        const units = unitsByCard.get(c.matchedCard.id) ?? [];
        const availableQty = Math.min(c.quantity, units.length);
        availableCount += availableQty;
        for (const u of units.slice(0, availableQty)) fromPriceMxnCents += u.priceMxnCents ?? 0;
      }
      return {
        slug: deck.slug,
        name: deck.name,
        rank: deck.rank,
        ...(deck.sharePct != null ? { sharePct: deck.sharePct } : {}),
        ...(deck.trend != null ? { trend: deck.trend } : {}),
        ...(fromPriceMxnCents > 0 ? { fromPriceMxnCents } : {}),
        availableCount,
        totalCount,
        imageUrl: pickDeckImage({
          deckName: deck.name,
          imageCardId: deck.imageCardId,
          coverCard: deck.currentList?.coverCard ?? null,
          cards,
        }),
      };
    });

    return {
      data,
      updatedAt: latestFetchedAt ? (latestFetchedAt as Date).toISOString() : null,
      source: META_SOURCE_LABEL,
    };
  }

  /** `GET /decks-meta/:slug` — detalle con disponibilidad por línea. Slug desconocido ⇒ 404. */
  async getBySlug(slug: string): Promise<MetaDeckDetailDTO> {
    const deck = await this.prisma.metaDeck.findFirst({
      where: { slug, published: true, pausedByOperator: false },
      include: { currentList: { include: { cards: { include: { matchedCard: { include: { set: true } } } } } } },
    });
    if (!deck || !deck.currentList) {
      throw BusinessException.notFound('DECK_NOT_FOUND', `deck '${slug}' no encontrado`);
    }
    const stored = deck.currentList.cards.map(toStoredLine);
    const [energyProducts, priceCents] = await Promise.all([
      this.loadEnergyProducts(this.prisma),
      this.loadEnergyBundlePriceCents(this.prisma),
    ]);
    const groups = await this.buildGroups(stored, energyProducts);

    // §AC.8 pullToken: la unión que «Agregar de jalón» mete HOY (todas las piezas ofrecidas), firmada con la lista
    // VIGENTE. Siempre presente, aunque no se ofrezca el paquete.
    const jalon = [...groups.pokemon, ...groups.trainer, ...groups.energy].flatMap((l) => l.unitInventoryItemIds);
    const pullToken = signPullToken(this.pii, {
      slug: deck.slug,
      listId: deck.currentList.id,
      ids: jalon,
      iat: Math.floor(Date.now() / 1000),
    });
    const offer = computeEnergyBundleOffer({
      lines: stored,
      signedIdsCount: new Set(jalon).size,
      products: energyProducts,
      priceCents,
    });
    return {
      slug: deck.slug,
      name: deck.name,
      rank: deck.rank,
      sharePct: deck.sharePct,
      trend: deck.trend,
      source: deck.source === MetaDeckSource.manual ? MANUAL_SOURCE_LABEL : META_SOURCE_LABEL,
      ...(deck.currentList.sourceUrl ? { sourceUrl: deck.currentList.sourceUrl } : {}),
      ...(deck.currentList.sourceTournament ? { sourceTournament: deck.currentList.sourceTournament } : {}),
      groups,
      energyBundle: {
        offered: offer.offered,
        reason: offer.reason,
        priceCents: offer.priceCents,
        looseTotalCents: offer.looseTotalCents,
        energies: offer.energies,
        pullToken,
      },
    };
  }

  /** `POST /decks-meta/paste` — mismo motor, en memoria, sin persistir. Sin líneas ⇒ 422. */
  async paste(text: string): Promise<MetaPasteResponseDTO> {
    const { lines } = parseDeckList(text ?? '');
    if (lines.length === 0) {
      throw BusinessException.validation('DECK_LIST_UNPARSEABLE', 'la lista no tiene ninguna línea de carta válida');
    }
    const matched = await this.matcher.matchLines(lines);
    const stored: StoredLine[] = matched.map(fromMatchedLine);
    // §AC.8 / P-EN-7: «Pegar lista» liga las energías por línea, pero ⛔ NO emite `pullToken` ni `energyBundle`.
    const groups = await this.buildGroups(stored, await this.loadEnergyProducts(this.prisma));
    return { groups };
  }

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // 💰 §AC.8 — energías del deck y paquete. El validador que el stream B llama en quote/session.
  // ────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Productos «Energía <tipo>» ACTIVOS, por tipo, con `availableQty = stockQty − reservedQty` (+ `extra` por id: lo
   * apartado por la PROPIA reserva cuando B cotiza con `retryOfCheckoutToken`, §AC.4). El índice parcial
   * `accessory_energy_type_active_key` garantiza a lo más uno por tipo.
   */
  async loadEnergyProducts(
    db: Db,
    extraAvailableByAccessoryId?: ReadonlyMap<string, number>,
  ): Promise<Map<EnergyType, EnergyProduct>> {
    const rows = await db.accessory.findMany({
      where: { active: true, category: AccessoryCategory.energy, energyType: { not: null } },
      select: { id: true, energyType: true, priceCents: true, stockQty: true, reservedQty: true, photoVersion: true },
    });
    const out = new Map<EnergyType, EnergyProduct>();
    for (const r of rows) {
      if (!r.energyType || r.priceCents == null) continue; // activo ⇒ precio (CHECK); defensa
      const extra = Math.max(0, extraAvailableByAccessoryId?.get(r.id) ?? 0);
      out.set(r.energyType, {
        accessoryId: r.id,
        energyType: r.energyType,
        priceCents: r.priceCents,
        availableQty: Math.max(0, r.stockQty - r.reservedQty) + extra,
        photoVersion: r.photoVersion,
      });
    }
    return out;
  }

  /** El dial `energy_bundle_price_cents`, normalizado (ausente o fuera de rango ⇒ 2000). */
  async loadEnergyBundlePriceCents(db: Db): Promise<number> {
    const row = await db.configSetting.findUnique({ where: { key: ENERGY_BUNDLE_PRICE_KEY } });
    return normalizeEnergyBundlePrice(row?.valueJson);
  }

  /**
   * 💰 §AC.8 «En quote/session» — lo que llama el stream B, una vez por petición, con TODOS los `deckPulls`.
   * Carga de la BD (con `db` = la transacción de B si la hay) los decks por slug firmado, las listas FIRMADAS, los
   * productos de energía activos con su disponible y el dial, y delega en el validador puro `evaluateDeckPulls`.
   *
   * - `requestInventoryItemIds`: las piezas de la petición, después de la poda en `quote` (P-EN-4).
   * - `extraAvailableByAccessoryId`: lo apartado por la propia reserva (reintento), que cuenta como disponible.
   * - `now`: reloj (pruebas). Default: `new Date()`.
   * ⛔ No aparta nada: el apartado por tipo (sumado con las sueltas) es de B, con su `UPDATE … WHERE` (§AC.4 paso 2).
   */
  async evaluateDeckPulls(
    pulls: readonly DeckPullInput[],
    opts: {
      requestInventoryItemIds: readonly string[];
      db?: Db;
      now?: Date;
      extraAvailableByAccessoryId?: ReadonlyMap<string, number>;
    },
  ): Promise<DeckPullEvaluation[]> {
    if (pulls.length === 0) return [];
    const db = opts.db ?? this.prisma;
    const nowSec = Math.floor((opts.now ?? new Date()).getTime() / 1000);

    // Solo se lee de la BD lo que una firma BUENA nombra: un token forjado no dispara consultas con datos suyos.
    const slugs = new Set<string>();
    const listIds = new Set<string>();
    for (const p of pulls) {
      const v = verifyPullToken(this.pii, p.pullToken, nowSec);
      if (v.ok) {
        slugs.add(v.payload.slug);
        listIds.add(v.payload.listId);
      }
    }

    const [decks, lists, products, bundlePriceCents] = await Promise.all([
      slugs.size
        ? db.metaDeck.findMany({
            where: { slug: { in: [...slugs] } },
            select: { id: true, slug: true, name: true, published: true, pausedByOperator: true },
          })
        : Promise.resolve([] as DeckFact[]),
      listIds.size
        ? db.metaDeckList.findMany({
            where: { id: { in: [...listIds] } },
            select: { id: true, deckId: true, cards: { select: { rawName: true, quantity: true, matchStatus: true } } },
          })
        : Promise.resolve([] as { id: string; deckId: string; cards: DeckListFact['lines'] }[]),
      this.loadEnergyProducts(db, opts.extraAvailableByAccessoryId),
      this.loadEnergyBundlePriceCents(db),
    ]);

    return evaluateDeckPulls(pulls, {
      signer: this.pii,
      nowSec,
      requestInventoryItemIds: opts.requestInventoryItemIds,
      decksBySlug: new Map(decks.map((d) => [d.slug, d])),
      listsById: new Map(lists.map((l) => [l.id, { id: l.id, deckId: l.deckId, lines: l.cards }])),
      products,
      bundlePriceCents,
    });
  }

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // Admin — curaduría manual (fallback), reporte de no-mapeadas
  // ────────────────────────────────────────────────────────────────────────────────────────────

  /** `GET /admin/decks-meta` — lista con estado (para curaduría). */
  async adminList() {
    const decks = await this.prisma.metaDeck.findMany({
      orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
      include: {
        currentList: { include: { _count: { select: { cards: true } }, cards: { select: { matchStatus: true } } } },
      },
    });
    return {
      data: decks.map((d) => ({
        id: d.id,
        slug: d.slug,
        name: d.name,
        source: d.source,
        rank: d.rank,
        published: d.published,
        pausedByOperator: d.pausedByOperator,
        currentListFetchedAt: d.currentList?.fetchedAt?.toISOString() ?? null,
        unmatchedCount:
          d.currentList?.cards.filter((c) => c.matchStatus !== MetaMatchStatus.matched).length ?? 0,
      })),
    };
  }

  /**
   * `POST /admin/decks-meta` — CURADURÍA MANUAL (fallback, §3.3): pega un top-10 con el mismo formato
   * y motor. Crea el deck (o reusa por slug), una `MetaDeckList` NUEVA e INMUTABLE, sus líneas casadas
   * y fija `currentListId`. Registra `MetaFetchRun{source:manual, applied:true}`.
   */
  async adminCreateOrCurate(input: {
    slug: string;
    name: string;
    listText: string;
    rank?: number;
    sharePct?: number;
    trend?: number;
    formatLabel?: string;
    sourceUrl?: string;
    sourceTournament?: string;
    imageCardId?: string;
    published?: boolean;
  }) {
    const { lines } = parseDeckList(input.listText ?? '');
    if (lines.length === 0) {
      throw BusinessException.validation('DECK_LIST_UNPARSEABLE', 'la lista pegada no tiene líneas válidas');
    }
    const matched = await this.matcher.matchLines(lines);
    const deckId = await this.prisma.$transaction(async (tx) => {
      const deck = await tx.metaDeck.upsert({
        where: { slug: input.slug },
        create: {
          slug: input.slug,
          name: input.name,
          source: MetaDeckSource.manual,
          rank: input.rank ?? null,
          sharePct: input.sharePct ?? null,
          trend: input.trend ?? null,
          imageCardId: input.imageCardId ?? null,
          published: input.published ?? false,
        },
        update: {
          name: input.name,
          rank: input.rank ?? undefined,
          sharePct: input.sharePct ?? undefined,
          trend: input.trend ?? undefined,
          imageCardId: input.imageCardId ?? undefined,
          ...(input.published != null ? { published: input.published } : {}),
        },
      });
      const list = await tx.metaDeckList.create({
        data: {
          deckId: deck.id,
          formatLabel: input.formatLabel ?? 'Standard',
          // FUENTE-CONFIABLE (SUP-LEG): ya no hay ventana de marcas; se persiste vacío (columna inerte).
          activeMarksSnapshot: [] as unknown as Prisma.InputJsonValue,
          sourceUrl: input.sourceUrl ?? null,
          sourceTournament: input.sourceTournament ?? null,
          cards: {
            create: matched.map((m) => ({
              rawName: m.rawName,
              rawSetCode: m.rawSetCode,
              rawNumber: m.rawNumber,
              quantity: m.quantity,
              group: m.group,
              matchStatus: m.matchStatus,
              matchedCardId: m.matchedCard?.id ?? null,
            })),
          },
        },
      });
      // La lista anterior queda marcada como reemplazada (inmutable: no se edita, se supersede).
      if (deck.currentListId && deck.currentListId !== list.id) {
        await tx.metaDeckList.update({ where: { id: deck.currentListId }, data: { supersededById: list.id } });
      }
      await tx.metaDeck.update({ where: { id: deck.id }, data: { currentListId: list.id } });
      await tx.metaFetchRun.create({
        data: {
          source: MetaDeckSource.manual,
          formatVersion: 'manual',
          deckCount: 1,
          applied: true,
          note: `curaduría manual: ${input.slug}`,
        },
      });
      return deck.id;
    });
    return { id: deckId, slug: input.slug };
  }

  /** `PUT /admin/decks-meta/:id` — fija rank/published/pausedByOperator (curaduría ligera). */
  async adminUpdate(
    id: string,
    patch: { rank?: number; published?: boolean; pausedByOperator?: boolean; sharePct?: number; trend?: number },
  ) {
    const deck = await this.prisma.metaDeck.findUnique({ where: { id } });
    if (!deck) throw BusinessException.notFound('DECK_NOT_FOUND', `deck '${id}' no encontrado`);
    await this.prisma.metaDeck.update({
      where: { id },
      data: {
        ...(patch.rank !== undefined ? { rank: patch.rank } : {}),
        ...(patch.published !== undefined ? { published: patch.published } : {}),
        ...(patch.pausedByOperator !== undefined ? { pausedByOperator: patch.pausedByOperator } : {}),
        ...(patch.sharePct !== undefined ? { sharePct: patch.sharePct } : {}),
        ...(patch.trend !== undefined ? { trend: patch.trend } : {}),
      },
    });
    return { id, ok: true };
  }

  /** `GET /admin/decks-meta/unmatched` — reporte de líneas no mapeadas de listas publicadas, para curar. */
  async adminUnmatched() {
    const rows = await this.prisma.metaDeckCard.findMany({
      where: {
        matchStatus: { not: MetaMatchStatus.matched },
        list: { currentOf: { isNot: null } },
      },
      select: { rawName: true, rawSetCode: true, rawNumber: true, quantity: true, matchStatus: true, listId: true },
    });
    // Agrega por (setCode, número, status): en cuántas listas aparece y cantidad total.
    const agg = new Map<string, { rawName: string; setCode: string; number: string; matchStatus: MetaMatchStatus; deckCount: number; totalQuantity: number; lists: Set<string> }>();
    for (const r of rows) {
      const key = `${r.rawSetCode}::${r.rawNumber}::${r.matchStatus}`;
      const cur = agg.get(key);
      if (cur) {
        cur.totalQuantity += r.quantity;
        cur.lists.add(r.listId);
        cur.deckCount = cur.lists.size;
      } else {
        agg.set(key, {
          rawName: r.rawName,
          setCode: r.rawSetCode,
          number: r.rawNumber,
          matchStatus: r.matchStatus,
          deckCount: 1,
          totalQuantity: r.quantity,
          lists: new Set([r.listId]),
        });
      }
    }
    return {
      data: [...agg.values()].map((v) => ({
        rawName: v.rawName,
        setCode: v.setCode || null,
        number: v.number || null,
        matchStatus: v.matchStatus,
        deckCount: v.deckCount,
        totalQuantity: v.totalQuantity,
      })),
    };
  }

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // DECKS-META Fase 2 — CONTROL DEL DIAL (auto-fetch). Los diales viven en `ConfigSetting` y se leen
  // fail-closed (off/false) vía los normalizadores de `limitless.config`. Encenderlos causa egress
  // real a un tercero + publicación ⇒ el PUT es super_admin + auditado. Money-adjacent.
  // ────────────────────────────────────────────────────────────────────────────────────────────

  /** Lee el estado actual del dial (fail-closed: ausente ⇒ `off`/`false`). */
  async loadDialState(): Promise<DialState> {
    const rows = await this.prisma.configSetting.findMany({
      where: { key: { in: [DIAL_AUTOFETCH, DIAL_AUTOPUBLISH] } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.valueJson]));
    return {
      autofetch: normalizeAutofetchDial(byKey.get(DIAL_AUTOFETCH)),
      autopublish: normalizeAutopublishDial(byKey.get(DIAL_AUTOPUBLISH)),
    };
  }

  /**
   * Escribe el dial (parcial permitido). VALIDA estricto (autofetch ∈ off/dryrun/on; autopublish
   * boolean; cualquier otra cosa ⇒ 400), es ATÓMICO (una transacción si escribe ambas keys) y
   * devuelve `{ before, after }` para que el caller AUDITE el old→new.
   */
  async adminSetDial(
    patch: { autofetch?: unknown; autopublish?: unknown },
    actor: string,
  ): Promise<{ before: DialState; after: DialState }> {
    if (patch.autofetch !== undefined && !AUTOFETCH_DIAL_VALUES.includes(patch.autofetch as AutofetchDial)) {
      throw BusinessException.badRequest('VALIDATION_ERROR', `autofetch inválido: ${String(patch.autofetch)} (esperado off/dryrun/on)`);
    }
    if (patch.autopublish !== undefined && typeof patch.autopublish !== 'boolean') {
      throw BusinessException.badRequest('VALIDATION_ERROR', `autopublish inválido: ${String(patch.autopublish)} (esperado boolean)`);
    }
    const before = await this.loadDialState();
    await this.prisma.$transaction(async (tx) => {
      if (patch.autofetch !== undefined) {
        const value = patch.autofetch as unknown as Prisma.InputJsonValue;
        await tx.configSetting.upsert({
          where: { key: DIAL_AUTOFETCH },
          create: { key: DIAL_AUTOFETCH, valueJson: value, updatedBy: actor },
          update: { valueJson: value, updatedBy: actor },
        });
      }
      if (patch.autopublish !== undefined) {
        const value = patch.autopublish as unknown as Prisma.InputJsonValue;
        await tx.configSetting.upsert({
          where: { key: DIAL_AUTOPUBLISH },
          create: { key: DIAL_AUTOPUBLISH, valueJson: value, updatedBy: actor },
          update: { valueJson: value, updatedBy: actor },
        });
      }
    });
    const after = await this.loadDialState();
    return { before, after };
  }
}

// ── helpers puros ──────────────────────────────────────────────────────────────────────────────

function groupKey(g: MetaCardGroup): 'pokemon' | 'trainer' | 'energy' {
  return g; // MetaCardGroup es exactamente ese dominio
}

/**
 * §AC.8 `basicEnergy`: no nulo ⇔ línea `unmatched_basic_energy` ∧ tipo reconocido ∧ producto ACTIVO de ese tipo.
 * `soldOut` = disponible 0 (§AC.3); ⛔ el disponible exacto no se expone aquí.
 */
function basicEnergyOf(line: StoredLine, products: ReadonlyMap<EnergyType, EnergyProduct>): MetaBasicEnergyDTO | null {
  if (line.matchStatus !== MetaMatchStatus.unmatched_basic_energy) return null;
  const t = energyTypeOf(line.rawName);
  if (!t) return null;
  const p = products.get(t);
  if (!p || !p.photoVersion) return null;
  return {
    energyType: t,
    accessoryId: p.accessoryId,
    unitPriceCents: p.priceCents,
    soldOut: p.availableQty <= 0,
    photo: accessoryPhotoOf(p.accessoryId, p.photoVersion),
  };
}

/** Convierte una fila persistida (`MetaDeckCard` con `matchedCard`) a `StoredLine`. */
function toStoredLine(c: {
  rawName: string;
  rawSetCode: string;
  rawNumber: string;
  quantity: number;
  group: MetaCardGroup;
  matchStatus: MetaMatchStatus;
  matchedCard: (Card & { set: CardSet }) | null;
}): StoredLine {
  return {
    rawName: c.rawName,
    rawSetCode: c.rawSetCode,
    rawNumber: c.rawNumber,
    quantity: c.quantity,
    group: c.group,
    matchStatus: c.matchStatus,
    matchedCard: c.matchedCard,
  };
}

/** Convierte una `MatchedLine` (paste, en memoria) a `StoredLine`. */
function fromMatchedLine(m: MatchedLine): StoredLine {
  return {
    rawName: m.rawName,
    rawSetCode: m.rawSetCode,
    rawNumber: m.rawNumber,
    quantity: m.quantity,
    group: m.group,
    matchStatus: m.matchStatus,
    matchedCard: m.matchedCard,
  };
}
