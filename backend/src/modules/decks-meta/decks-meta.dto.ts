import { EnergyType, MetaCardGroup, MetaMatchStatus } from '@prisma/client';
import type { AccessoryPhotoDTO, EnergyBundleOfferReason } from './energy-bundle';

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
  /**
   * 💰 §AC.8 (v1.86, aditivo): la energía básica ligada a su producto «Energía <tipo>». No nulo ⇔
   * `matchStatus = unmatched_basic_energy` ∧ `energyTypeOf(rawName) ≠ null` ∧ hay producto ACTIVO de ese tipo. El
   * servidor lo manda `null` en toda otra línea. ⛔ No toca `unitInventoryItemIds`/`availableQty`/`unitPriceMxnCents`.
   */
  basicEnergy?: MetaBasicEnergyDTO | null;
}

/** §AC.8 — la energía suelta que se puede agregar por línea. */
export interface MetaBasicEnergyDTO {
  energyType: EnergyType;
  accessoryId: string;
  unitPriceCents: number;
  soldOut: boolean;
  photo: AccessoryPhotoDTO;
}

/** §AC.8 — el paquete de energías del deck (solo en `GET /decks-meta/:slug`; ⛔ nunca en `paste`). */
export interface MetaEnergyBundleDTO {
  offered: boolean;
  /** `null` ⇔ `offered`. */
  reason: EnergyBundleOfferReason | null;
  priceCents: number;
  looseTotalCents: number;
  energies: { energyType: EnergyType; quantity: number; accessoryId: string | null }[];
  /** SIEMPRE presente: firma la unión que «Agregar de jalón» mete HOY. ⛔ Nunca en URL. */
  pullToken: string;
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
  /** 💰 §AC.8 (v1.86, aditivo, en la raíz). */
  energyBundle: MetaEnergyBundleDTO;
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
