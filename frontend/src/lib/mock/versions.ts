/**
 * MOCK §IDS (API_CONTRACT v1.116.1⟨ids⟩ §IDS.5) — lo que el SERVIDOR calcula y el simulador imita: `finishLabelOf`,
 * `optionKey` y `versions[]` con su orden. Vive en `lib/mock/` a propósito: el navegador real NUNCA compone
 * `optionKey` (IDS-F3, grep en `ids-no-compose.test.ts` excluye esta carpeta).
 */
import type {
  CardVersionsResponse,
  Finish,
  FinishLabel,
  GroupedListingDTO,
  ListingDTO,
  StampDTO,
  VersionComboDTO,
  VersionDTO,
  VersionOptionDTO,
} from '@/types/contract';

export const EN_DEFAULT_VERSION: VersionDTO = { key: 'en', language: 'en', stamp: null };

/** §IDS.5 `finishLabelOf(finish, stampLabel)`, función pura del backend, espejada para el simulador. */
export function mockFinishLabelOf(finish: Finish, stampLabel: string | null | undefined): FinishLabel {
  if (stampLabel && /cosmos\s*holo/i.test(stampLabel)) return 'cosmos_holo';
  switch (finish) {
    case 'normal':
      return 'non_holo';
    case 'holofoil':
      return 'holo';
    case 'reverse_holo':
      return 'reverse_holo';
    case 'first_edition_holofoil':
      return 'first_edition_holo';
  }
}

/** `optionKey` (§IDS.5): `version.key` sin liga; `version.key + '.' + finish` con liga. */
export function mockOptionKeyOf(version: VersionDTO, finish: Finish): string {
  return version.stamp ? `${version.key}.${finish}` : version.key;
}

const FINISH_ORDER: Finish[] = ['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'];

/**
 * `versions[]` de la ficha (§IDS.5): una entrada por versión sin liga (`en`, `es`; acabado = el de sus grupos raw si
 * todos comparten uno, si no `null`) y una por (producto de liga × acabado). Orden: `en`, `es`; luego filas de liga por
 * menor `fromPriceCents` de la fila (empate `productId`, luego FINISH_ORDER); en la fila, `en` antes que `es`. Solo raw
 * (solo raw NM tiene versión, D-IDS-K); agotadas no existen (los grupos ya son vendibles).
 */
export function mockVersionOptions(groups: GroupedListingDTO[]): VersionOptionDTO[] {
  const raw = groups.filter((g) => g.productType === 'raw');
  const out: VersionOptionDTO[] = [];
  for (const lang of ['en', 'es'] as const) {
    const gs = raw.filter((g) => g.version.stamp == null && g.version.language === lang);
    if (gs.length === 0) continue;
    const finishes = new Set(gs.map((g) => g.finish));
    const cheapest = [...gs].sort((a, b) => a.displayPriceCents - b.displayPriceCents)[0];
    const single = finishes.size === 1;
    out.push({
      optionKey: gs[0].version.key,
      version: gs[0].version,
      finish: single ? cheapest.finish : null,
      finishLabel: single ? cheapest.finishLabel : null,
      fromPriceCents: cheapest.displayPriceCents,
      stockCount: gs.reduce((n, g) => n + g.stockCount, 0),
      representativeInventoryItemId: cheapest.representativeInventoryItemId,
    });
  }
  const stamped = raw.filter((g) => g.version.stamp != null);
  const rows = new Map<string, GroupedListingDTO[]>();
  for (const g of stamped) {
    const id = `${g.version.stamp!.productId}|${g.finish}`;
    rows.set(id, [...(rows.get(id) ?? []), g]);
  }
  const ordered = [...rows.values()].sort((a, b) => {
    const pa = Math.min(...a.map((g) => g.displayPriceCents));
    const pb = Math.min(...b.map((g) => g.displayPriceCents));
    return (
      pa - pb ||
      a[0].version.stamp!.productId - b[0].version.stamp!.productId ||
      FINISH_ORDER.indexOf(a[0].finish) - FINISH_ORDER.indexOf(b[0].finish)
    );
  });
  for (const row of ordered) {
    for (const lang of ['en', 'es'] as const) {
      const g = row.find((x) => x.version.language === lang);
      if (!g) continue;
      out.push({
        optionKey: mockOptionKeyOf(g.version, g.finish),
        version: g.version,
        finish: g.finish,
        finishLabel: g.finishLabel,
        fromPriceCents: g.displayPriceCents,
        stockCount: g.stockCount,
        representativeInventoryItemId: g.representativeInventoryItemId,
      });
    }
  }
  return out;
}

/**
 * MOCK §IDS.4 `GET /admin/inventory/cards/:cardId/versions`. `combos` = acabados de la carta × {en, es} ∪ cada producto
 * de liga colgado × sus acabados × {en, es}; `previewPriceCents` es el `P` que daría el servidor (aquí: literales con el
 * español ≈ 75 %). Cartas del simulador con liga: `c-pikachu-ir` (Prize Pack Holo con precio, Staff sin mercado y una
 * candidata ambigua por colgar). El resto: solo idioma (sin fila «Versión»).
 */
const MOCK_ATTACHED = new Map<string, StampDTO[]>();
export function mockCardVersions(cardId: string, cardFinishes: Finish[], basePriceCents: number | null): CardVersionsResponse {
  const combos: VersionComboDTO[] = [];
  const pct = (c: number | null) => (c == null ? null : Math.floor((c * 75 + 50) / 100));
  for (const finish of cardFinishes) {
    const en = basePriceCents;
    combos.push({ finish, finishLabel: mockFinishLabelOf(finish, null), language: 'en', stamp: null, previewPriceCents: en, unavailableReason: en == null ? 'no_market' : null });
    const es = pct(en);
    combos.push({ finish, finishLabel: mockFinishLabelOf(finish, null), language: 'es', stamp: null, previewPriceCents: es, unavailableReason: es == null ? 'no_english_market' : null });
  }
  const stamps: { stamp: StampDTO; finishes: Finish[]; price: number | null }[] = [];
  if (cardId === 'c-pikachu-ir') {
    stamps.push({ stamp: { type: 'prize_pack', label: null, productId: 648703 }, finishes: ['holofoil'], price: 48000 });
    stamps.push({ stamp: { type: 'staff', label: null, productId: 610001 }, finishes: ['holofoil'], price: null });
  }
  for (const s of MOCK_ATTACHED.get(cardId) ?? []) stamps.push({ stamp: s, finishes: ['normal'], price: 9000 });
  for (const { stamp, finishes, price } of stamps) {
    for (const finish of finishes) {
      for (const language of ['en', 'es'] as const) {
        const p = language === 'en' ? price : pct(price);
        combos.push({
          finish,
          finishLabel: mockFinishLabelOf(finish, stamp.label),
          language,
          stamp,
          previewPriceCents: p,
          unavailableReason: p == null ? 'no_stamped_market' : null,
        });
      }
    }
  }
  const candidates =
    cardId === 'c-pikachu-ir' && !(MOCK_ATTACHED.get(cardId) ?? []).length
      ? [{ tcgplayerProductId: 777001, name: 'Pikachu ex - 238/191 (Prize Pack Series Seven)', stamp: { type: 'prize_pack' as const, label: 'Prize Pack Series Seven', productId: 777001 }, finishes: ['normal' as Finish] }]
      : [];
  return { combos, candidates };
}

/** MOCK §IDS.4 `attach`: cuelga la candidata (identidad, no precio) y responde el `GET …/versions` nuevo. */
export function mockAttachCandidate(tcgplayerProductId: number, cardId: string): StampDTO | null {
  if (cardId !== 'c-pikachu-ir' || tcgplayerProductId !== 777001) return null;
  const stamp: StampDTO = { type: 'prize_pack', label: 'Prize Pack Series Seven', productId: 777001 };
  MOCK_ATTACHED.set(cardId, [...(MOCK_ATTACHED.get(cardId) ?? []), stamp]);
  return stamp;
}

/** Clave de agrupación K de §IDS.5 en el simulador: la de hoy + versión. */
export function mockVersionGroupKeyPart(l: ListingDTO): string {
  return l.version.key;
}

// TL-DYN3R-2 · centinela PROPIO de este módulo: un literal, no un import (si el módulo escapara al alias de
// next.config.mjs, un `import './sentinel'` resolvería vacío y el literal no viajaría). Ver sentinel.ts.
(globalThis as { __thMockBundle?: string }).__thMockBundle = 'th-mock-bundle-sentinel-5c1e';
