/**
 * guest-accessory-cart.ts — 💰 la parte de ACCESORIOS y PAQUETES de `POST /checkout/guest/quote|session`
 * (API_CONTRACT §AC.4, §AC.7, §AC.8 «En quote/session», §AC.19.4). Lee de la BD (con el `db` que le den: `this.prisma`
 * en `quote`, la transacción en `session`) y delega lo puro en `accessory-cart.ts` y `box-fit.ts`.
 *
 * ⛔ No reimplementa nada de §AC.8: los `deckPulls` los valida `DecksMetaService.evaluateDeckPulls` (stream C) y aquí
 * solo se traduce su resultado (`bundle` ⇒ renglón o `energyBundles`; `offer` ⇒ `energyBundleOffers`; `invalid` ⇒
 * `unavailableBundles` o `422`; `ignored` ⇒ nada).
 * ⛔ Ningún importe del cuerpo (I-AC-3): precio del accesorio = `Accessory.priceCents`; del paquete = el dial leído por
 * el validador con el MISMO `db` (en `session`, la tx ⇒ ese número se congela).
 */
import { AccessoryCategory, EnergyType, Prisma } from '@prisma/client';
import { BusinessException } from '../../common/business.exception';
import { AccessoryPhotoDTO, photoDTO } from '../accessories/accessory-dto';
import type { DecksMetaService } from '../decks-meta/decks-meta.service';
import type { DeckPullEvaluation, EnergyBundleDTO } from '../decks-meta/energy-bundle';
import { BundleNeed, LooseWant, allocateQuoteStock, wantsOf } from './accessory-cart';
import { BoxChoice, FitBox, FitUnit, boxSnapshotOf, chooseBox, fitUnitsOf, ShippingBoxSnapshot } from './box-fit';

type Db = Prisma.TransactionClient;

/** Un `deckPull` válido con `withEnergyBundle:true` (el validador da `bundle`). */
export type BundleEval = Extract<DeckPullEvaluation, { status: 'bundle' | 'offer' }> & { status: 'bundle' };

export interface QuoteAccessoryLineDTO {
  accessoryId: string;
  name: string;
  category: AccessoryCategory;
  energyType: EnergyType | null;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  photo: AccessoryPhotoDTO;
}

export type UnavailableAccessoryDTO =
  | { accessoryId: string; name: string | null; reason: 'not_found' | 'inactive' | 'sold_out' }
  | { accessoryId: string; name: string; reason: 'insufficient'; availableQty: number };

export interface UnavailableBundleDTO {
  index: number;
  withEnergyBundle: boolean;
  deckSlug: string | null;
  reason: string;
}

export interface ShippingBoxDTO {
  code: string;
  label: string;
  review: boolean;
}

const ROW_SELECT = {
  id: true,
  name: true,
  category: true,
  energyType: true,
  priceCents: true,
  unitCostCents: true,
  stockQty: true,
  reservedQty: true,
  active: true,
  photoVersion: true,
  lengthMm: true,
  widthMm: true,
  heightMm: true,
  weightG: true,
} as const;
type Row = Prisma.AccessoryGetPayload<{ select: typeof ROW_SELECT }>;

const sellable = (r: Row | undefined): r is Row & { priceCents: number; photoVersion: string } => !!r && r.active && r.priceCents !== null && r.photoVersion !== null;

function lineDtoOf(r: Row & { priceCents: number; photoVersion: string }, quantity: number): QuoteAccessoryLineDTO {
  return {
    accessoryId: r.id,
    name: r.name,
    category: r.category,
    energyType: r.energyType,
    unitPriceCents: r.priceCents,
    quantity,
    lineTotalCents: r.priceCents * quantity,
    photo: photoDTO(r.id, r.photoVersion),
  };
}

const bundleNeedOf = (e: Extract<DeckPullEvaluation, { status: 'bundle' | 'offer' }>): BundleNeed => ({
  index: e.index,
  components: e.bundle.energies.map((x) => ({ accessoryId: x.accessoryId, quantity: x.quantity })),
});

async function loadRows(db: Db, ids: readonly string[]): Promise<Map<string, Row>> {
  if (ids.length === 0) return new Map();
  const rows = await db.accessory.findMany({ where: { id: { in: [...new Set(ids)] } }, select: ROW_SELECT });
  return new Map(rows.map((r) => [r.id, r]));
}

/** Las cajas con tarifa (§AC.7): `active ∧ customerFeeCents IS NOT NULL`. */
export async function loadFitBoxes(db: Db): Promise<FitBox[]> {
  const rows = await db.shippingPackage.findMany({
    where: { active: true, customerFeeCents: { not: null } },
    select: { code: true, label: true, lengthCm: true, widthCm: true, heightCm: true, customerFeeCents: true, sortOrder: true },
  });
  return rows.map((r) => ({ ...r, customerFeeCents: r.customerFeeCents as number }));
}

/** La caja de unas unidades: sin unidades ⛔ ni siquiera se leen las cajas (I-AC-5: pedido sin accesorios = hoy). */
export async function boxChoiceOf(db: Db, units: FitUnit[]): Promise<BoxChoice | null> {
  if (units.length === 0) return null;
  return chooseBox(units, await loadFitBoxes(db));
}

export const shippingBoxDtoOf = (c: BoxChoice | null): ShippingBoxDTO | null => (c ? { code: c.box.code, label: c.box.label, review: c.review } : null);

/** Lo apartado por las órdenes PROPIAS (reintento), por accesorio: renglones sueltos + componentes `reserved`. */
export async function ownAccessoryReservedOf(db: Db, orderIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (orderIds.length === 0) return out;
  const lines = await db.orderAccessoryLine.findMany({
    where: { orderId: { in: [...orderIds] }, status: 'reserved' },
    select: { kind: true, accessoryId: true, quantity: true, components: { select: { accessoryId: true, quantity: true } } },
  });
  for (const l of lines) {
    if (l.kind === 'accessory' && l.accessoryId) out.set(l.accessoryId, (out.get(l.accessoryId) ?? 0) + l.quantity);
    else for (const c of l.components) out.set(c.accessoryId, (out.get(c.accessoryId) ?? 0) + c.quantity);
  }
  return out;
}

/** El carrito de accesorios de una orden (para decidir el REUSO: mismo multiconjunto y mismos decks). */
export async function orderAccessoryCartOf(db: Db, orderId: string): Promise<{ loose: LooseWant[]; bundleSlugs: string[]; allReserved: boolean }> {
  const lines = await db.orderAccessoryLine.findMany({ where: { orderId }, select: { kind: true, accessoryId: true, quantity: true, deckSlug: true, status: true } });
  return {
    loose: lines.filter((l) => l.kind === 'accessory' && l.accessoryId).map((l) => ({ accessoryId: l.accessoryId as string, quantity: l.quantity })),
    bundleSlugs: lines.filter((l) => l.kind === 'energy_bundle' && l.deckSlug).map((l) => l.deckSlug as string),
    allReserved: lines.every((l) => l.status === 'reserved'),
  };
}

export const sameSlugSet = (a: readonly string[], b: readonly string[]) => {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

async function evaluate(
  decksMeta: DecksMetaService | undefined,
  pulls: readonly { pullToken: string; withEnergyBundle: boolean }[],
  opts: { requestInventoryItemIds: readonly string[]; db: Db; extraAvailableByAccessoryId?: ReadonlyMap<string, number> },
): Promise<DeckPullEvaluation[]> {
  if (pulls.length === 0) return [];
  if (!decksMeta) throw new Error('DecksMetaService no disponible: no se pueden validar deckPulls');
  return decksMeta.evaluateDeckPulls(pulls, opts);
}

// ================================================================ quote (poda, 200)

export interface QuoteAccessoryPart {
  accessoryLines: QuoteAccessoryLineDTO[];
  energyBundles: EnergyBundleDTO[];
  energyBundleOffers: EnergyBundleDTO[];
  unavailableAccessories: UnavailableAccessoryDTO[];
  unavailableBundles: UnavailableBundleDTO[];
  subtotalCents: number;
  units: FitUnit[];
  /** Lo cotizado, para comparar con una orden propia congelada. */
  loose: LooseWant[];
  bundleSlugs: string[];
}

export const EMPTY_QUOTE_ACCESSORY_PART: QuoteAccessoryPart = {
  accessoryLines: [],
  energyBundles: [],
  energyBundleOffers: [],
  unavailableAccessories: [],
  unavailableBundles: [],
  subtotalCents: 0,
  units: [],
  loose: [],
  bundleSlugs: [],
};

/**
 * §AC.19.4 `quote`, pasos 3–5: el validador de decks con las piezas YA podadas, luego existencias en el orden
 * normativo (paquetes primero, después los sueltos con el remanente) y la traducción. Disponible = `stockQty −
 * reservedQty` + lo apartado por la propia reserva (`extra`, §AC.4).
 */
export async function quoteAccessoryPart(
  db: Db,
  decksMeta: DecksMetaService | undefined,
  input: {
    lines: readonly { accessoryId: string; quantity: number }[];
    pulls: readonly { pullToken: string; withEnergyBundle: boolean }[];
    prunedInventoryItemIds: readonly string[];
    extra?: ReadonlyMap<string, number>;
  },
): Promise<QuoteAccessoryPart> {
  const evals = await evaluate(decksMeta, input.pulls, {
    requestInventoryItemIds: input.prunedInventoryItemIds,
    db,
    extraAvailableByAccessoryId: input.extra,
  });
  const bundleEvals = evals.filter((e): e is BundleEval => e.status === 'bundle');
  const componentIds = bundleEvals.flatMap((e) => e.bundle.energies.map((x) => x.accessoryId));
  const rows = await loadRows(db, [...input.lines.map((l) => l.accessoryId), ...componentIds]);
  const available = new Map<string, number>();
  for (const r of rows.values()) {
    if (!sellable(r)) continue;
    available.set(r.id, Math.max(0, r.stockQty - r.reservedQty) + Math.max(0, input.extra?.get(r.id) ?? 0));
  }
  const unavailableAccessories: UnavailableAccessoryDTO[] = [];
  const valid: LooseWant[] = [];
  for (const l of input.lines) {
    const r = rows.get(l.accessoryId);
    // v1.86.1: `name` = `Accessory.name` si la fila existe (también inactiva); `null` ⇔ not_found. ⛔ Nada más de la fila.
    if (!r) unavailableAccessories.push({ accessoryId: l.accessoryId, name: null, reason: 'not_found' });
    else if (!sellable(r)) unavailableAccessories.push({ accessoryId: l.accessoryId, name: r.name, reason: 'inactive' });
    else valid.push({ accessoryId: l.accessoryId, quantity: l.quantity });
  }
  const alloc = allocateQuoteStock(bundleEvals.map(bundleNeedOf), valid, available);
  const accepted = new Set(alloc.acceptedBundleIndexes);
  const unavailableBundles: UnavailableBundleDTO[] = [];
  const energyBundles: EnergyBundleDTO[] = [];
  const energyBundleOffers: EnergyBundleDTO[] = [];
  for (const e of [...evals].sort((a, b) => a.index - b.index)) {
    if (e.status === 'invalid') unavailableBundles.push({ index: e.index, withEnergyBundle: e.withEnergyBundle, deckSlug: e.deckSlug, reason: e.reason });
    else if (e.status === 'bundle') {
      if (accepted.has(e.index)) energyBundles.push(e.bundle);
      else unavailableBundles.push({ index: e.index, withEnergyBundle: true, deckSlug: e.deckSlug, reason: 'insufficient_stock' });
    } else if (e.status === 'offer') energyBundleOffers.push(e.bundle);
    // `ignored` ⇒ nada (interno del validador, §AC.19.3 (6)).
  }
  const accessoryLines: QuoteAccessoryLineDTO[] = [];
  const quoted: LooseWant[] = [];
  const unitsSrc: { quantity: number; accessory: Row }[] = [];
  for (const a of alloc.loose) {
    const r = rows.get(a.accessoryId) as Row & { priceCents: number; photoVersion: string };
    if (a.quoted > 0) {
      accessoryLines.push(lineDtoOf(r, a.quoted));
      quoted.push({ accessoryId: a.accessoryId, quantity: a.quoted });
      unitsSrc.push({ quantity: a.quoted, accessory: r });
    }
    if (a.quoted < a.requested) {
      unavailableAccessories.push(
        a.remaining === 0
          ? { accessoryId: a.accessoryId, name: r.name, reason: 'sold_out' }
          : { accessoryId: a.accessoryId, name: r.name, reason: 'insufficient', availableQty: a.remaining },
      );
    }
  }
  // Orden de la petición en los avisos (así la pantalla los empareja sin adivinar).
  const pos = new Map(input.lines.map((l, i) => [l.accessoryId, i]));
  unavailableAccessories.sort((x, y) => (pos.get(x.accessoryId) ?? 0) - (pos.get(y.accessoryId) ?? 0));
  const subtotalCents = accessoryLines.reduce((s, l) => s + l.lineTotalCents, 0) + energyBundles.reduce((s, b) => s + b.priceCents, 0);
  return {
    accessoryLines,
    energyBundles,
    energyBundleOffers,
    unavailableAccessories,
    unavailableBundles,
    subtotalCents,
    units: fitUnitsOf(unitsSrc),
    loose: quoted,
    bundleSlugs: energyBundles.map((b) => b.deckSlug),
  };
}

// ================================================================ session (estricta)

export interface SessionAccessoryPart {
  loose: { row: Row & { priceCents: number; photoVersion: string }; quantity: number }[];
  bundles: BundleEval[];
  /** Costo congelado de cada producto de energía de los paquetes. */
  componentCost: Map<string, number | null>;
  subtotalCents: number;
  units: FitUnit[];
  wants: Map<string, number>;
  looseWants: LooseWant[];
  bundleSlugs: string[];
}

/**
 * §AC.19.4 `session`, pasos 2–3 (dentro de la tx, ANTES de crear nada): accesorio inexistente, inactivo o sin precio ⇒
 * `409 ACCESSORY_UNAVAILABLE {accessoryId, reason}`; el PRIMER `invalid` con `withEnergyBundle:true` (por `index`) ⇒
 * `422 ENERGY_BUNDLE_INVALID {index, deckSlug, reason}`. `false` inválido, `offer` e `ignored` ⇒ nada.
 */
export async function sessionAccessoryPart(
  tx: Db,
  decksMeta: DecksMetaService | undefined,
  input: {
    lines: readonly { accessoryId: string; quantity: number }[];
    pulls: readonly { pullToken: string; withEnergyBundle: boolean }[];
    requestInventoryItemIds: readonly string[];
    extra?: ReadonlyMap<string, number>;
  },
): Promise<SessionAccessoryPart> {
  const looseRows = await loadRows(tx, input.lines.map((l) => l.accessoryId));
  const loose: SessionAccessoryPart['loose'] = [];
  for (const l of input.lines) {
    const r = looseRows.get(l.accessoryId);
    if (!sellable(r)) {
      throw BusinessException.conflict('ACCESSORY_UNAVAILABLE', `Accessory ${l.accessoryId} is not available`, {
        accessoryId: l.accessoryId,
        reason: r ? 'inactive' : 'not_found',
      });
    }
    loose.push({ row: r, quantity: l.quantity });
  }
  const evals = await evaluate(decksMeta, input.pulls, {
    requestInventoryItemIds: input.requestInventoryItemIds,
    db: tx,
    extraAvailableByAccessoryId: input.extra,
  });
  const firstBad = [...evals]
    .sort((a, b) => a.index - b.index)
    .find((e): e is Extract<DeckPullEvaluation, { status: 'invalid' }> => e.status === 'invalid' && e.withEnergyBundle);
  if (firstBad) {
    throw BusinessException.validation('ENERGY_BUNDLE_INVALID', 'The energy bundle is not valid', {
      index: firstBad.index,
      deckSlug: firstBad.deckSlug,
      reason: firstBad.reason,
    });
  }
  const bundles = evals
    .filter((e): e is BundleEval => e.status === 'bundle')
    .sort((a, b) => a.index - b.index);
  const compRows = await loadRows(tx, bundles.flatMap((b) => b.bundle.energies.map((e) => e.accessoryId)));
  const componentCost = new Map<string, number | null>([...compRows.values()].map((r) => [r.id, r.unitCostCents]));
  const looseWants = loose.map((l) => ({ accessoryId: l.row.id, quantity: l.quantity }));
  const subtotalCents = loose.reduce((s, l) => s + l.row.priceCents * l.quantity, 0) + bundles.reduce((s, b) => s + b.bundle.priceCents, 0);
  return {
    loose,
    bundles,
    componentCost,
    subtotalCents,
    units: fitUnitsOf(loose.map((l) => ({ quantity: l.quantity, accessory: l.row }))),
    wants: wantsOf(looseWants, bundles.map(bundleNeedOf)),
    looseWants,
    bundleSlugs: bundles.map((b) => b.deckSlug),
  };
}

/**
 * §AC.4 / §AC.19.4 paso 4 — los renglones con precio, costo y snapshot CONGELADOS, `reservedUntil` = el de las piezas.
 * `deckOrderItemIds` = los `OrderItem` de las piezas firmadas, leídos en ESTA tx por `inventoryItemId` tras el `create`
 * anidado del pedido.
 */
export async function createAccessoryLines(tx: Db, orderId: string, part: SessionAccessoryPart, reservedUntil: Date): Promise<void> {
  for (const l of part.loose) {
    await tx.orderAccessoryLine.create({
      data: {
        orderId,
        kind: 'accessory',
        accessoryId: l.row.id,
        quantity: l.quantity,
        unitPriceCents: l.row.priceCents,
        unitCostCents: l.row.unitCostCents,
        snapshot: { name: l.row.name, category: l.row.category, energyType: l.row.energyType, photoVersion: l.row.photoVersion },
        reservedUntil,
      },
    });
  }
  for (const b of part.bundles) {
    const ois = await tx.orderItem.findMany({ where: { orderId, inventoryItemId: { in: b.signedInventoryItemIds } }, select: { id: true } });
    await tx.orderAccessoryLine.create({
      data: {
        orderId,
        kind: 'energy_bundle',
        quantity: 1,
        unitPriceCents: b.bundle.priceCents,
        unitCostCents: null,
        snapshot: { name: b.deckName, category: 'energy', energyType: null, photoVersion: null },
        metaDeckId: b.metaDeckId,
        metaDeckListId: b.metaDeckListId,
        deckSlug: b.deckSlug,
        deckName: b.deckName,
        deckOrderItemIds: ois.map((o) => o.id).sort(),
        reservedUntil,
        components: {
          create: b.bundle.energies.map((e) => ({
            accessoryId: e.accessoryId,
            energyType: e.energyType,
            quantity: e.quantity,
            unitCostCents: part.componentCost.get(e.accessoryId) ?? null,
          })),
        },
      },
    });
  }
}

/** Respuesta de `session`: los renglones creados (para el reuso, los de la orden reusada). */
export async function sessionLinesDtoOf(tx: Db, orderId: string): Promise<QuoteAccessoryLineDTO[]> {
  const lines = await tx.orderAccessoryLine.findMany({
    where: { orderId, kind: 'accessory' },
    include: { accessory: { select: { id: true, photoVersion: true, name: true, category: true, energyType: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return lines.map((l) => {
    const snap = (l.snapshot ?? {}) as { name?: string; category?: AccessoryCategory; energyType?: EnergyType | null };
    const a = l.accessory!;
    return {
      accessoryId: a.id,
      name: snap.name ?? a.name,
      category: snap.category ?? a.category,
      energyType: snap.energyType ?? a.energyType,
      unitPriceCents: l.unitPriceCents,
      quantity: l.quantity,
      lineTotalCents: l.unitPriceCents * l.quantity,
      photo: photoDTO(a.id, a.photoVersion as string),
    };
  });
}

export { boxSnapshotOf };
export type { ShippingBoxSnapshot };
