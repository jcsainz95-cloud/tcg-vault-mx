/**
 * accessory-dto.ts — proyecciones de `Accessory` a los DTO del contrato (API_CONTRACT §AC.3 y §AC.11). PURAS.
 *
 * ⛔ Criterio 730: la lista blanca se arma CAMPO POR CAMPO, nunca con `...row`. Ninguna respuesta pública lleva
 * `unitCostCents`, `stockQty`, `reservedQty`, `suggested` ni medidas; `maxQty` es el único rastro del disponible.
 * ★ `unitCostCents` del panel: AUSENTE (no `null`) para el operador (criterio 720).
 */
import { AccessoryCategory, EnergyType } from '@prisma/client';

export interface AccessoryPhotoDTO {
  url: string;
  thumbUrl: string;
}

export interface AccessoryCardDTO {
  id: string;
  name: string;
  category: AccessoryCategory;
  energyType: EnergyType | null;
  priceCents: number;
  soldOut: boolean;
  photo: AccessoryPhotoDTO;
}

export interface AccessoryDetailDTO extends AccessoryCardDTO {
  description: string | null;
  maxQty: number;
}

export interface AdminAccessoryDTO {
  id: string;
  name: string;
  description: string | null;
  category: AccessoryCategory;
  energyType: EnergyType | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  weightG: number | null;
  priceCents: number | null;
  unitCostCents?: number | null;
  stockQty: number;
  reservedQty: number;
  availableQty: number;
  active: boolean;
  suggested: boolean;
  photo: AccessoryPhotoDTO | null;
  hasSales: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Lo que se lee de la fila (lo mínimo que las proyecciones necesitan). */
export interface AccessoryRow {
  id: string;
  name: string;
  description: string | null;
  category: AccessoryCategory;
  energyType: EnergyType | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  weightG: number | null;
  priceCents: number | null;
  unitCostCents: number | null;
  stockQty: number;
  reservedQty: number;
  active: boolean;
  suggested: boolean;
  photoVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Prefijo global de la API (`main.ts`: `setGlobalPrefix('api/v1')`). Rutas ABSOLUTAS de la API, con versión (§AC.3). */
export const ACCESSORY_PHOTO_PATH_PREFIX = '/api/v1/accessories';
export const MAX_LINE_QTY = 99;

export function photoDTO(id: string, version: string): AccessoryPhotoDTO {
  const base = `${ACCESSORY_PHOTO_PATH_PREFIX}/${encodeURIComponent(id)}/photo/${encodeURIComponent(version)}`;
  return { url: `${base}/full`, thumbUrl: `${base}/thumb` };
}

export const availableOf = (r: Pick<AccessoryRow, 'stockQty' | 'reservedQty'>): number => Math.max(0, r.stockQty - r.reservedQty);

/**
 * Teja pública. Solo se llama con filas ACTIVAS: el CHECK `accessory_active_ready` garantiza precio y foto. Si aun así
 * faltaran, es un defecto de datos y se lanza (⛔ nunca se inventa un precio 0 ni una foto vacía en la tienda).
 */
export function toCardDTO(r: AccessoryRow): AccessoryCardDTO {
  if (r.priceCents === null || r.photoVersion === null) throw new Error(`accessory ${r.id} is not sellable (price/photo missing)`);
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    energyType: r.energyType,
    priceCents: r.priceCents,
    soldOut: availableOf(r) === 0,
    photo: photoDTO(r.id, r.photoVersion),
  };
}

export function toDetailDTO(r: AccessoryRow): AccessoryDetailDTO {
  const card = toCardDTO(r);
  return {
    id: card.id,
    name: card.name,
    category: card.category,
    energyType: card.energyType,
    priceCents: card.priceCents,
    soldOut: card.soldOut,
    photo: card.photo,
    description: r.description,
    maxQty: Math.min(availableOf(r), MAX_LINE_QTY),
  };
}

export function toAdminDTO(r: AccessoryRow, opts: { superAdmin: boolean; hasSales: boolean }): AdminAccessoryDTO {
  const dto: AdminAccessoryDTO = {
    id: r.id,
    name: r.name,
    description: r.description,
    category: r.category,
    energyType: r.energyType,
    lengthMm: r.lengthMm,
    widthMm: r.widthMm,
    heightMm: r.heightMm,
    weightG: r.weightG,
    priceCents: r.priceCents,
    stockQty: r.stockQty,
    reservedQty: r.reservedQty,
    availableQty: availableOf(r),
    active: r.active,
    suggested: r.suggested,
    photo: r.photoVersion === null ? null : photoDTO(r.id, r.photoVersion),
    hasSales: opts.hasSales,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
  if (opts.superAdmin) dto.unitCostCents = r.unitCostCents;
  return dto;
}

/** `select` de Prisma con exactamente las columnas de `AccessoryRow` (⛔ nunca los bytes de la foto). */
export const ACCESSORY_ROW_SELECT = {
  id: true,
  name: true,
  description: true,
  category: true,
  energyType: true,
  lengthMm: true,
  widthMm: true,
  heightMm: true,
  weightG: true,
  priceCents: true,
  unitCostCents: true,
  stockQty: true,
  reservedQty: true,
  active: true,
  suggested: true,
  photoVersion: true,
  createdAt: true,
  updatedAt: true,
} as const;
