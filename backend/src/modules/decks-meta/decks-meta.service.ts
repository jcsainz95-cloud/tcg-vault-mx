import { Injectable } from '@nestjs/common';
import {
  Card,
  CardSet,
  MetaCardGroup,
  MetaDeckSource,
  MetaMatchStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService, DeckMetaUnitDTO } from '../catalog/catalog.service';
import { BusinessException } from '../../common/business.exception';
import {
  isLegalStandardNow,
  StandardLegalityConfig,
} from '../../common/standard-legality';
import { parseDeckList } from './deck-list.parser';
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
  MetaDeckLineDTO,
  MetaDeckListResponseDTO,
  MetaDeckCardTileDTO,
  MetaPasteResponseDTO,
} from './decks-meta.dto';

/** Cita de fuente del meta. El ranking del meta procede de Limitless aunque la lista sea curada. */
const META_SOURCE_LABEL = 'Datos de Limitless TCG';
const MANUAL_SOURCE_LABEL = 'Curado por el equipo TCG HUNT';

const LEGALITY_KEY_ACTIVE = 'standard.active_regulation_marks';
const LEGALITY_KEY_BANLIST = 'standard.banlist_card_ids';

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
  ) {}

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // Legalidad: la ventana vigente de `ConfigSetting`, leída UNA vez por request (§2.3).
  // ────────────────────────────────────────────────────────────────────────────────────────────

  async loadLegalityConfig(): Promise<StandardLegalityConfig> {
    const rows = await this.prisma.configSetting.findMany({
      where: { key: { in: [LEGALITY_KEY_ACTIVE, LEGALITY_KEY_BANLIST] } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.valueJson]));
    return {
      activeMarks: asStringArray(byKey.get(LEGALITY_KEY_ACTIVE)),
      banlistCardIds: asStringArray(byKey.get(LEGALITY_KEY_BANLIST)),
    };
  }

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // El constructor de disponibilidad por línea — REUSA precio/disponibilidad y la compuerta de
  // legalidad. NO reinventa precio (regla dura del dueño). Money-adjacent.
  // ────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Construye las líneas agrupadas (pokemon/trainer/energy) a partir de líneas ya casadas.
   * - `legal` = `isLegalStandardNow(card, cfg)`; sólo lo LEGAL + en stock se ofrece (`unitInventoryItemIds`).
   * - `availableQty = min(quantity, stockNM)`; sin stock ⇒ 0 y sin piezas.
   * - `unitPriceMxnCents` = «desde» (displayPriceCents de la pieza más barata); `null` si faltante/pending.
   * - Lo NO casado o NO legal NO aporta `unitInventoryItemIds` propios (§13).
   */
  async buildGroups(lines: StoredLine[], cfg: StandardLegalityConfig): Promise<MetaDeckGroupsDTO> {
    // Piezas RAW NM vendibles de todas las cartas casadas, EN LOTE (una lectura, sin N+1).
    const cardIds = lines
      .filter((l) => l.matchStatus === MetaMatchStatus.matched && l.matchedCard)
      .map((l) => l.matchedCard!.id);
    const unitsByCard = await this.catalog.getSellableRawUnitsByCardIds(cardIds);

    const groups: MetaDeckGroupsDTO = { pokemon: [], trainer: [], energy: [] };
    for (const line of lines) {
      const dto = this.buildLine(line, cfg, unitsByCard);
      groups[groupKey(line.group)].push(dto);
    }
    return groups;
  }

  private buildLine(
    line: StoredLine,
    cfg: StandardLegalityConfig,
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
        legal: false,
        availableQty: 0,
        unitPriceMxnCents: null,
        unitInventoryItemIds: [],
      };
    }

    const legal = isLegalStandardNow(
      { regulationMark: card.regulationMark, legalStandardRaw: card.legalStandardRaw, externalId: card.externalId },
      cfg,
    );
    const cardDto = {
      cardId: card.id,
      name: card.name,
      imageUrl: card.imageLargeUrl ?? card.imageSmallUrl ?? null,
    };

    // Compuerta de legalidad: sólo lo LEGAL se ofrece. Lo rotado se MARCA (legal:false) sin piezas.
    if (!legal) {
      return {
        ...base,
        card: cardDto,
        legal: false,
        availableQty: 0,
        unitPriceMxnCents: null,
        unitInventoryItemIds: [],
        // substitute (Fase 3) se OMITE en Fase 1.
      };
    }

    const units = unitsByCard.get(card.id) ?? [];
    const availableQty = Math.min(line.quantity, units.length);
    const offered = units.slice(0, availableQty);
    return {
      ...base,
      card: cardDto,
      legal: true,
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
      include: { currentList: { include: { cards: { include: { matchedCard: { include: { set: true } } } } } } },
    });
    const cfg = await this.loadLegalityConfig();

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
        const legal = isLegalStandardNow(
          {
            regulationMark: c.matchedCard.regulationMark,
            legalStandardRaw: c.matchedCard.legalStandardRaw,
            externalId: c.matchedCard.externalId,
          },
          cfg,
        );
        if (!legal) continue;
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
        imageUrl: pickDeckImage(deck.imageCardId, cards),
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
    const cfg = await this.loadLegalityConfig();
    const stored = deck.currentList.cards.map(toStoredLine);
    const groups = await this.buildGroups(stored, cfg);
    return {
      slug: deck.slug,
      name: deck.name,
      rank: deck.rank,
      sharePct: deck.sharePct,
      trend: deck.trend,
      source: deck.source === MetaDeckSource.manual ? MANUAL_SOURCE_LABEL : META_SOURCE_LABEL,
      ...(deck.currentList.sourceUrl ? { sourceUrl: deck.currentList.sourceUrl } : {}),
      ...(deck.currentList.sourceTournament ? { sourceTournament: deck.currentList.sourceTournament } : {}),
      // La legalidad es DERIVADA en lectura: «verificado» = el instante de esta evaluación.
      legalityVerifiedAt: new Date().toISOString(),
      groups,
    };
  }

  /** `POST /decks-meta/paste` — mismo motor, en memoria, sin persistir. Sin líneas ⇒ 422. */
  async paste(text: string): Promise<MetaPasteResponseDTO> {
    const { lines } = parseDeckList(text ?? '');
    if (lines.length === 0) {
      throw BusinessException.validation('DECK_LIST_UNPARSEABLE', 'la lista no tiene ninguna línea de carta válida');
    }
    const matched = await this.matcher.matchLines(lines);
    const cfg = await this.loadLegalityConfig();
    const stored: StoredLine[] = matched.map(fromMatchedLine);
    const groups = await this.buildGroups(stored, cfg);
    return { groups };
  }

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // Admin — curaduría manual (fallback), reporte de no-mapeadas, rotación de legalidad
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
    const cfg = await this.loadLegalityConfig();
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
          activeMarksSnapshot: cfg.activeMarks as unknown as Prisma.InputJsonValue,
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

  /**
   * `PUT /admin/config/standard-legality` — EDITA la ventana (`active_regulation_marks`) y la banlist.
   * Es el mecanismo de ROTACIÓN (§12.1): editar la ventana recalcula la legalidad DERIVADA sin re-sync.
   * Money-adjacent: gobierna qué se ofrece como jugable. Escribe `ConfigSetting` directamente (upsert).
   */
  async adminUpdateStandardLegality(
    patch: { activeMarks?: string[]; banlistCardIds?: string[] },
    actor: string,
  ) {
    // SEG-DMF1-1: ATÓMICO. Los dos upserts (ventana + banlist) van en UNA transacción para que una
    // falla parcial NO deje las marcas actualizadas con la banlist vieja (o viceversa) — un estado
    // que ofrecería como jugable algo que el operador ya rotó/baneó. Money-adjacent.
    await this.prisma.$transaction(async (tx) => {
      if (patch.activeMarks !== undefined) {
        const value = patch.activeMarks as unknown as Prisma.InputJsonValue;
        await tx.configSetting.upsert({
          where: { key: LEGALITY_KEY_ACTIVE },
          create: { key: LEGALITY_KEY_ACTIVE, valueJson: value, updatedBy: actor },
          update: { valueJson: value, updatedBy: actor },
        });
      }
      if (patch.banlistCardIds !== undefined) {
        const value = patch.banlistCardIds as unknown as Prisma.InputJsonValue;
        await tx.configSetting.upsert({
          where: { key: LEGALITY_KEY_BANLIST },
          create: { key: LEGALITY_KEY_BANLIST, valueJson: value, updatedBy: actor },
          update: { valueJson: value, updatedBy: actor },
        });
      }
    });
    return this.loadLegalityConfig();
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

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function groupKey(g: MetaCardGroup): 'pokemon' | 'trainer' | 'energy' {
  return g; // MetaCardGroup es exactamente ese dominio
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

/** Arte del deck: la carta configurada, o la primera Pokémon casada con imagen. Nunca arte externo. */
function pickDeckImage(
  imageCardId: string | null,
  cards: { matchStatus: MetaMatchStatus; group: MetaCardGroup; matchedCard: (Card & { set: CardSet }) | null }[],
): string | null {
  if (imageCardId) {
    const configured = cards.find((c) => c.matchedCard?.id === imageCardId)?.matchedCard;
    if (configured) return configured.imageLargeUrl ?? configured.imageSmallUrl ?? null;
  }
  const firstPokemon = cards.find(
    (c) => c.matchStatus === MetaMatchStatus.matched && c.group === MetaCardGroup.pokemon && c.matchedCard,
  )?.matchedCard;
  if (firstPokemon) return firstPokemon.imageLargeUrl ?? firstPokemon.imageSmallUrl ?? null;
  return null;
}
