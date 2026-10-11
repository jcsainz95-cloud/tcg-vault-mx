import { EnergyType, MetaMatchStatus } from '@prisma/client';
import { AccessoryPhotoDTO, photoDTO } from '../accessories/accessory-dto';
import { DeckPullSigner, verifyPullToken } from './deck-pull-token';
import { energyTypeOf } from './energy-type';

/**
 * 💰 §AC.8 — el paquete de energías del deck, PURO (sin BD, sin reloj, sin llave propia).
 *
 * Dos usos:
 * 1. `computeEnergyBundleOffer` — la oferta (`offered` y su `reason`) de la ficha `GET /decks-meta/:slug`.
 * 2. `evaluateDeckPulls` — el VALIDADOR que el stream B llama en `POST /checkout/guest/quote|session` por cada
 *    `deckPulls[i]` (§AC.8 «En quote/session», pasos 1–6). B no lo reimplementa: lo llama (vía
 *    `DecksMetaService.evaluateDeckPulls`, que carga los hechos de la BD) y traduce el resultado a su respuesta.
 *
 * Firma y decisiones: `docs/BACKEND_NOTES.md §83.C`.
 */

/** §AC.3 — rutas absolutas de la API, con versión. La forma y el constructor son los de `accessories/` (una fuente). */
export type { AccessoryPhotoDTO };

/** Un producto «Energía <tipo>» ACTIVO, con su disponible (`stockQty − reservedQty` [+ lo propio de quien llama]). */
export interface EnergyProduct {
  accessoryId: string;
  energyType: EnergyType;
  priceCents: number;
  availableQty: number;
  /** Activo ⇒ no nulo (CHECK `accessory_active_ready`); nulo se trata como «sin producto». */
  photoVersion: string | null;
}

/** Lo que hace falta de una línea de `MetaDeckCard`. */
export interface DeckListLine {
  rawName: string;
  quantity: number;
  matchStatus: MetaMatchStatus;
}

export type EnergyBundleOfferReason = 'no_basic_energy' | 'not_offered' | 'insufficient_stock';
/** §AC.4 `BundleReason`. */
export type BundleReason =
  | 'invalid_token'
  | 'expired'
  | 'deck_incomplete'
  | 'deck_unpublished'
  | 'not_offered'
  | 'insufficient_stock'
  | 'duplicate';

export interface EnergyBundleOffer {
  offered: boolean;
  /** `null` ⇔ `offered`. */
  reason: EnergyBundleOfferReason | null;
  priceCents: number;
  looseTotalCents: number;
  energies: { energyType: EnergyType; quantity: number; accessoryId: string | null }[];
}

/** §AC.4 `EnergyBundleDTO` (v1.86.1: con la foto del producto activo de cada tipo). */
export interface EnergyBundleDTO {
  deckSlug: string;
  deckName: string;
  priceCents: number;
  looseTotalCents: number;
  energies: { energyType: EnergyType; quantity: number; accessoryId: string; photo: AccessoryPhotoDTO }[];
}

export interface DeckPullInput {
  pullToken: string;
  withEnergyBundle: boolean;
}

export interface DeckFact {
  id: string;
  slug: string;
  name: string;
  published: boolean;
  pausedByOperator: boolean;
}

export interface DeckListFact {
  id: string;
  deckId: string;
  lines: DeckListLine[];
}

export type DeckPullEvaluation =
  /**
   * `bundle`: `withEnergyBundle:true` válido ⇒ renglón `energy_bundle` (componentes = `bundle.energies`).
   * `offer`: `withEnergyBundle:false` válido ⇒ va a `energyBundleOffers`.
   */
  | {
      index: number;
      status: 'bundle' | 'offer';
      deckSlug: string;
      deckName: string;
      metaDeckId: string;
      /** La lista FIRMADA (inmutable) ⇒ `OrderAccessoryLine.metaDeckListId`. */
      metaDeckListId: string;
      /** Los ids firmados (ordenados) ⇒ B los traduce a `deckOrderItemIds` dentro de su transacción. */
      signedInventoryItemIds: string[];
      bundle: EnergyBundleDTO;
    }
  /** Inválido ⇒ `quote`: `unavailableBundles`; `session` con `withEnergyBundle:true`: `422 ENERGY_BUNDLE_INVALID`. */
  | { index: number; status: 'invalid'; withEnergyBundle: boolean; deckSlug: string | null; reason: BundleReason }
  /**
   * Sin efecto (no es error): un `withEnergyBundle:false` de un deck que ya lleva paquete (`bundled`), o la segunda
   * oferta del mismo deck (`offer_repeated`).
   */
  | { index: number; status: 'ignored'; deckSlug: string; why: 'bundled' | 'offer_repeated' };

export interface EvaluateDeckPullsContext {
  signer: DeckPullSigner;
  nowSec: number;
  /** Los `inventoryItemIds` de la petición, DESPUÉS de la poda en `quote` (P-EN-4). */
  requestInventoryItemIds: readonly string[];
  /** Por `slug` firmado (publicado o no: el validador decide). */
  decksBySlug: ReadonlyMap<string, DeckFact>;
  /** Por `listId` firmado. */
  listsById: ReadonlyMap<string, DeckListFact>;
  /** Productos de energía ACTIVOS por tipo, con el disponible que aplica a esta petición. */
  products: ReadonlyMap<EnergyType, EnergyProduct>;
  /** El dial `energy_bundle_price_cents`, ya normalizado. */
  bundlePriceCents: number;
}

const ENERGY_ORDER: readonly EnergyType[] = Object.values(EnergyType);

/** §AC.3: `/api/v1/accessories/:id/photo/:version/:variant` — delega en `photoDTO` de `accessories/` (la misma foto). */
export function accessoryPhotoOf(accessoryId: string, version: string): AccessoryPhotoDTO {
  return photoDTO(accessoryId, version);
}

/** Línea de energía básica reconocida ⇒ su tipo; cualquier otra ⇒ `null`. */
function basicEnergyTypeOf(line: DeckListLine): EnergyType | null {
  return line.matchStatus === MetaMatchStatus.unmatched_basic_energy ? energyTypeOf(line.rawName) : null;
}

/** Σ `quantity` por tipo, en el orden del enum. */
export function energyNeedsOf(lines: readonly DeckListLine[]): { energyType: EnergyType; quantity: number }[] {
  const byType = new Map<EnergyType, number>();
  for (const l of lines) {
    const t = basicEnergyTypeOf(l);
    if (t) byType.set(t, (byType.get(t) ?? 0) + l.quantity);
  }
  return ENERGY_ORDER.filter((t) => byType.has(t)).map((t) => ({ energyType: t, quantity: byType.get(t)! }));
}

/**
 * P-AC-4: copias de las líneas que NO son energía básica. «Energía básica» = `matchStatus = unmatched_basic_energy`
 * (el término del sistema), con o sin tipo reconocido (§83.C, decisión 2).
 */
export function nonBasicEnergyCopiesOf(lines: readonly DeckListLine[]): number {
  let n = 0;
  for (const l of lines) if (l.matchStatus !== MetaMatchStatus.unmatched_basic_energy) n += l.quantity;
  return n;
}

/** Activo y con foto (activo ⇒ foto por CHECK; sin foto se trata como ausente, por defensa). */
function usable(p: EnergyProduct | undefined): p is EnergyProduct & { photoVersion: string } {
  return !!p && typeof p.photoVersion === 'string' && p.photoVersion.length > 0;
}

/**
 * §AC.8 `offered` ⇔ las cuatro condiciones. Precedencia del `reason` (§83.C, decisión 1): primero lo estructural
 * (no cambia con las existencias), al final las existencias:
 *   1. ningún tipo                                           ⇒ `no_basic_energy`
 *   2. algún tipo sin producto activo                        ⇒ `not_offered`
 *   3. `looseTotalCents ≤ priceCents` (P-EN-3)               ⇒ `not_offered`
 *   4. firmadas < ⌈½ × copias no-energía⌉ (P-AC-4)           ⇒ `not_offered`
 *   5. algún tipo con disponible < lo pedido (regla 5)       ⇒ `insufficient_stock`
 * `looseTotalCents` = Σ need × precio de su producto, solo de los tipos que tienen producto.
 */
export function computeEnergyBundleOffer(input: {
  lines: readonly DeckListLine[];
  signedIdsCount: number;
  products: ReadonlyMap<EnergyType, EnergyProduct>;
  priceCents: number;
}): EnergyBundleOffer {
  const needs = energyNeedsOf(input.lines);
  const energies = needs.map((n) => {
    const p = input.products.get(n.energyType);
    return { energyType: n.energyType, quantity: n.quantity, accessoryId: usable(p) ? p.accessoryId : null };
  });
  let looseTotalCents = 0;
  for (const n of needs) {
    const p = input.products.get(n.energyType);
    if (usable(p)) looseTotalCents += n.quantity * p.priceCents;
  }
  const out = (reason: EnergyBundleOfferReason | null): EnergyBundleOffer => ({
    offered: reason === null,
    reason,
    priceCents: input.priceCents,
    looseTotalCents,
    energies,
  });

  if (needs.length === 0) return out('no_basic_energy');
  if (needs.some((n) => !usable(input.products.get(n.energyType)))) return out('not_offered');
  if (!(looseTotalCents > input.priceCents)) return out('not_offered');
  const half = Math.ceil(nonBasicEnergyCopiesOf(input.lines) / 2);
  if (!(input.signedIdsCount >= half)) return out('not_offered');
  if (needs.some((n) => input.products.get(n.energyType)!.availableQty < n.quantity)) return out('insufficient_stock');
  return out(null);
}

/**
 * 💰 El VALIDADOR de `deckPulls` (§AC.8 «En quote/session»). Puro y síncrono. Un resultado por entrada, en el orden
 * de la petición. Pasos por entrada:
 *   1. firma inválida ⇒ `invalid_token`; vencido ⇒ `expired`;
 *   2. deck del `slug` firmado publicado y sin pausa, y la lista firmada es de ese deck ⇒ si no, `deck_unpublished`;
 *      las energías se leen de la lista FIRMADA (⛔ ni del navegador ni de la vigente);
 *   3. P-EN-4: todo id firmado ∈ `requestInventoryItemIds` ⇒ si no, `deck_incomplete`;
 *   4. segundo `withEnergyBundle:true` del mismo slug que pasó 1–3 ⇒ `duplicate`;
 *   5. `offered` recalculado ⇒ `not_offered` (incluye `no_basic_energy`) o `insufficient_stock`;
 *   6. válido ⇒ `bundle` (true) u `offer` (false).
 * Los `withEnergyBundle:false` se evalúan DESPUÉS de todos los `true`: un deck con paquete no se ofrece además
 * (`ignored: bundled`), y un deck se ofrece una sola vez (`ignored: offer_repeated`).
 */
export function evaluateDeckPulls(pulls: readonly DeckPullInput[], ctx: EvaluateDeckPullsContext): DeckPullEvaluation[] {
  const request = new Set(ctx.requestInventoryItemIds);
  const results: DeckPullEvaluation[] = new Array(pulls.length);
  const bundleSlugsPast3 = new Set<string>(); // pasaron 1–3 con withEnergyBundle:true (para `duplicate`)
  const bundledSlugs = new Set<string>(); // terminaron en `bundle`
  const offeredSlugs = new Set<string>();

  const order = [
    ...pulls.map((p, i) => ({ p, i })).filter(({ p }) => p.withEnergyBundle === true),
    ...pulls.map((p, i) => ({ p, i })).filter(({ p }) => p.withEnergyBundle !== true),
  ];

  for (const { p, i } of order) {
    const withBundle = p.withEnergyBundle === true;
    const invalid = (deckSlug: string | null, reason: BundleReason): DeckPullEvaluation => ({
      index: i,
      status: 'invalid',
      withEnergyBundle: withBundle,
      deckSlug,
      reason,
    });

    // 1. Firma y vigencia.
    const v = verifyPullToken(ctx.signer, p.pullToken, ctx.nowSec);
    if (!v.ok) {
      results[i] = invalid(v.slug, v.reason);
      continue;
    }
    const { slug, listId, ids } = v.payload;

    // 2. Deck publicado y lista firmada de ese deck.
    const deck = ctx.decksBySlug.get(slug);
    const list = ctx.listsById.get(listId);
    if (!deck || deck.slug !== slug || !deck.published || deck.pausedByOperator || !list || list.deckId !== deck.id) {
      results[i] = invalid(slug, 'deck_unpublished');
      continue;
    }

    // 3. P-EN-4: el deck firmado entero va en la petición.
    if (!ids.every((id) => request.has(id))) {
      results[i] = invalid(slug, 'deck_incomplete');
      continue;
    }

    if (withBundle) {
      // 4. Uno por deck.
      if (bundleSlugsPast3.has(slug)) {
        results[i] = invalid(slug, 'duplicate');
        continue;
      }
      bundleSlugsPast3.add(slug);
    } else if (bundledSlugs.has(slug)) {
      results[i] = { index: i, status: 'ignored', deckSlug: slug, why: 'bundled' };
      continue;
    } else if (offeredSlugs.has(slug)) {
      results[i] = { index: i, status: 'ignored', deckSlug: slug, why: 'offer_repeated' };
      continue;
    }

    // 5. La oferta, recalculada sobre la lista FIRMADA y los ids FIRMADOS.
    const offer = computeEnergyBundleOffer({
      lines: list.lines,
      signedIdsCount: ids.length,
      products: ctx.products,
      priceCents: ctx.bundlePriceCents,
    });
    if (!offer.offered) {
      results[i] = invalid(slug, offer.reason === 'insufficient_stock' ? 'insufficient_stock' : 'not_offered');
      continue;
    }

    // 6. Válido.
    const bundle: EnergyBundleDTO = {
      deckSlug: slug,
      deckName: deck.name,
      priceCents: offer.priceCents,
      looseTotalCents: offer.looseTotalCents,
      energies: offer.energies.map((e) => {
        const prod = ctx.products.get(e.energyType)!; // offered ⇒ todos los tipos tienen producto usable
        return {
          energyType: e.energyType,
          quantity: e.quantity,
          accessoryId: prod.accessoryId,
          photo: accessoryPhotoOf(prod.accessoryId, prod.photoVersion as string),
        };
      }),
    };
    results[i] = {
      index: i,
      status: withBundle ? 'bundle' : 'offer',
      deckSlug: slug,
      deckName: deck.name,
      metaDeckId: deck.id,
      metaDeckListId: list.id,
      signedInventoryItemIds: [...ids],
      bundle,
    };
    (withBundle ? bundledSlugs : offeredSlugs).add(slug);
  }
  return results;
}
