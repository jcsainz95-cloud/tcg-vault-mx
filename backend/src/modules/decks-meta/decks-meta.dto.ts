import { MetaCardGroup, MetaMatchStatus } from '@prisma/client';

/**
 * DECKS-META §13 (Fase 1) — DTOs PÚBLICOS. Las FORMAS son contrato: el frontend de Fase 1 (ya
 * entregado en `origin/claude/fe-decksmeta-f1`) las consume al pie de la letra. NO cambiar sin pasar
 * por el arquitecto (CLAUDE.md regla 9). Referencia: `docs/API_CONTRACT.md §13`.
 */

/** Carta casada, mínima para pintar la línea. `null` cuando la línea no casó. */
export interface MetaLineCardDTO {
  cardId: string;
  name: string;
  imageUrl: string | null;
}

/** El sustituto legal (Fase 3). En Fase 1 el campo se OMITE; se contempla su FORMA aquí. */
export interface MetaSubstituteDTO {
  cardId: string;
  name: string;
  setCode: string | null;
  number: string | null;
  availableQty: number;
  unitPriceMxnCents: number | null;
  unitInventoryItemIds: string[];
}

/** Una línea del deck con su disponibilidad. `API_CONTRACT §13 MetaDeckLineDTO`. */
export interface MetaDeckLineDTO {
  rawName: string;
  setCode: string | null;
  number: string | null;
  quantity: number;
  group: MetaCardGroup;
  matchStatus: MetaMatchStatus;
  /** `null` si no casó (NUNCA se inventa). */
  card: MetaLineCardDTO | null;
  /** `min(quantity, stockNM)`; `0` si falta o no es ofrecible. */
  availableQty: number;
  /** «desde» de la carta (`displayPriceCents`, con IVA); `null` si pending/faltante/no ofrecible. */
  unitPriceMxnCents: number | null;
  /** hasta `availableQty`, cheapest-first — el add-to-cart «de jalón». Vacío si no es ofrecible. */
  unitInventoryItemIds: string[];
  /** OPCIONAL (Fase 3): otra impresión LEGAL de la misma carta en stock. Ausente en Fase 1. */
  substitute?: MetaSubstituteDTO;
}

export interface MetaDeckGroupsDTO {
  pokemon: MetaDeckLineDTO[];
  trainer: MetaDeckLineDTO[];
  energy: MetaDeckLineDTO[];
}

/** Detalle: `GET /decks-meta/:slug`. */
export interface MetaDeckDetailDTO {
  slug: string;
  name: string;
  rank: number | null;
  sharePct: number | null;
  trend: number | null;
  source: string;
  sourceUrl?: string;
  sourceTournament?: string;
  groups: MetaDeckGroupsDTO;
}

/** Teja del top-10: `GET /decks-meta` (envelope `data[]`). */
export interface MetaDeckCardTileDTO {
  slug: string;
  name: string;
  rank: number | null;
  sharePct?: number;
  trend?: number;
  fromPriceMxnCents?: number;
  availableCount: number;
  totalCount: number;
  imageUrl: string | null;
}

export interface MetaDeckListResponseDTO {
  data: MetaDeckCardTileDTO[];
  updatedAt: string | null;
  source: string;
}

/** `POST /decks-meta/paste` — misma forma de `groups` que el detalle. */
export interface MetaPasteResponseDTO {
  groups: MetaDeckGroupsDTO;
}
