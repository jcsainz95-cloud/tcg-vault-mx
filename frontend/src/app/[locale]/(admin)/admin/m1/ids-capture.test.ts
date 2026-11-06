/**
 * Modelo PURO de la captura (§IDS.4): A2 (v1.116.8 I-6 «Acabado del alta») en modo casilla (`slot`) y TL-ALTA-5
 * (`hasVersions` vive aquí, no en el hook). Sin DOM: cada regla con su entrada y su salida.
 */
import { describe, it, expect } from 'vitest';
import type { CardVersionsResponse, VersionComboDTO } from '@/types/contract';
import { captureModel } from './ids-capture';

const LEAGUE = { type: 'league' as const, label: null, productId: 651001 };
const PP = { type: 'prize_pack' as const, label: null, productId: 648703 };
const combo = (o: Partial<VersionComboDTO>): VersionComboDTO => ({
  finish: 'normal',
  finishLabel: 'non_holo',
  language: 'en',
  stamp: null,
  previewPriceCents: 20000,
  baseReferenceMxnCents: 20000,
  appliedMarketPct: null,
  buySuggestedCents: null,
  unavailableReason: null,
  ...o,
});
const base = [combo({}), combo({ language: 'es', previewPriceCents: 15000, appliedMarketPct: 75 })];
const LEAGUE_HOLO_ONLY: CardVersionsResponse = {
  combos: [...base, combo({ stamp: LEAGUE, finish: 'holofoil', finishLabel: 'holo', previewPriceCents: 12000 }), combo({ stamp: LEAGUE, finish: 'holofoil', finishLabel: 'holo', language: 'es', previewPriceCents: 9000, appliedMarketPct: 75 })],
  candidates: [],
};
const PP_TWO: CardVersionsResponse = {
  combos: [
    ...base,
    combo({ stamp: PP, finish: 'reverse_holo', finishLabel: 'reverse_holo', previewPriceCents: 13000 }),
    combo({ stamp: PP, finish: 'reverse_holo', finishLabel: 'reverse_holo', language: 'es', previewPriceCents: 9750, appliedMarketPct: 75 }),
    combo({ stamp: PP, finish: 'holofoil', finishLabel: 'holo', previewPriceCents: 15000 }),
    combo({ stamp: PP, finish: 'holofoil', finishLabel: 'holo', language: 'es', previewPriceCents: 11250, appliedMarketPct: 75 }),
  ],
  candidates: [],
};

describe('captureModel · modo casilla (A2, IDS-F11 a/b/c)', () => {
  it('sin liga ⇒ el acabado de la casilla (modo slot), sin opciones de acabado', () => {
    const m = captureModel(LEAGUE_HOLO_ONLY, ['normal'], 'normal', 'en', null, { chosenFinish: null });
    expect(m.altaFinish).toBe('normal');
    expect(m.altaFinishMode).toBe('slot');
    expect(m.altaFinishOptions).toEqual([]);
    expect(m.combo?.finish).toBe('normal');
    expect(m.canCreate).toBe(true);
  });

  it('(a) liga con un solo acabado ≠ casilla ⇒ ese, implícito, y la opción lo nombra; combo y precio de ese acabado', () => {
    const m = captureModel(LEAGUE_HOLO_ONLY, ['normal'], 'normal', 'en', LEAGUE.productId, { chosenFinish: null });
    expect(m.altaFinish).toBe('holofoil');
    expect(m.altaFinishMode).toBe('implicit');
    expect(m.stampProductId).toBe(LEAGUE.productId);
    expect(m.combo).toMatchObject({ finish: 'holofoil', stamp: LEAGUE, previewPriceCents: 12000 });
    expect(m.canCreate).toBe(true);
    const opt = m.versionOptions.find((o) => o.key === String(LEAGUE.productId))!;
    expect(opt).toMatchObject({ altaFinish: 'holofoil', implicitFinish: true, disabledReason: null });
    expect(m.versionOptions.find((o) => o.key === 'none')).toMatchObject({ altaFinish: 'normal', implicitFinish: false });
  });

  it('(a) la burbuja se apaga solo si el combo del acabado resuelto trae motivo; nunca `combo_missing` por el acabado de la casilla', () => {
    const noMarket: CardVersionsResponse = {
      combos: [...base, combo({ stamp: LEAGUE, finish: 'holofoil', finishLabel: 'holo', previewPriceCents: null, baseReferenceMxnCents: null, unavailableReason: 'no_stamped_market' }), combo({ stamp: LEAGUE, finish: 'holofoil', finishLabel: 'holo', language: 'es', previewPriceCents: null, baseReferenceMxnCents: null, unavailableReason: 'no_stamped_market' })],
      candidates: [],
    };
    const m = captureModel(noMarket, ['normal'], 'normal', 'en', null, { chosenFinish: null });
    expect(m.versionOptions.find((o) => o.key === String(LEAGUE.productId))!.disabledReason).toBe('no_stamped_market');
    expect(m.versionOptions.every((o) => o.disabledReason !== 'combo_missing')).toBe(true);
  });

  it('(b) varios acabados y ninguno el de la casilla ⇒ modo choose con los acabados de la liga en orden del servidor; sin elección no hay combo ni alta', () => {
    const m = captureModel(PP_TWO, ['normal'], 'normal', 'en', PP.productId, { chosenFinish: null });
    expect(m.altaFinishMode).toBe('choose');
    expect(m.altaFinishOptions).toEqual(['reverse_holo', 'holofoil']);
    expect(m.altaFinish).toBeNull();
    expect(m.combo).toBeNull();
    expect(m.canCreate).toBe(false);
    expect(m.versionOptions.find((o) => o.key === String(PP.productId))).toMatchObject({ altaFinish: null, implicitFinish: false, disabledReason: null });
  });

  it('(b) con elección ⇒ el combo de ese acabado; una elección fuera de los de la liga no cuenta', () => {
    const m = captureModel(PP_TWO, ['normal'], 'normal', 'es', PP.productId, { chosenFinish: 'holofoil' });
    expect(m.altaFinish).toBe('holofoil');
    expect(m.combo).toMatchObject({ finish: 'holofoil', language: 'es', previewPriceCents: 11250 });
    expect(m.canCreate).toBe(true);
    const bad = captureModel(PP_TWO, ['normal'], 'normal', 'en', PP.productId, { chosenFinish: 'normal' });
    expect(bad.altaFinish).toBeNull();
    expect(bad.canCreate).toBe(false);
  });

  it('(b) la burbuja de una liga con varios acabados se apaga solo si ninguno está disponible', () => {
    const allOff: CardVersionsResponse = {
      combos: PP_TWO.combos.map((c) => (c.stamp ? { ...c, previewPriceCents: null, baseReferenceMxnCents: null, unavailableReason: 'no_stamped_market' as const } : c)),
      candidates: [],
    };
    expect(captureModel(allOff, ['normal'], 'normal', 'en', null, { chosenFinish: null }).versionOptions.find((o) => o.key === String(PP.productId))!.disabledReason).toBe('no_stamped_market');
    const oneOff: CardVersionsResponse = {
      combos: PP_TWO.combos.map((c) => (c.stamp && c.finish === 'reverse_holo' ? { ...c, previewPriceCents: null, baseReferenceMxnCents: null, unavailableReason: 'no_stamped_market' as const } : c)),
      candidates: [],
    };
    expect(captureModel(oneOff, ['normal'], 'normal', 'en', null, { chosenFinish: null }).versionOptions.find((o) => o.key === String(PP.productId))!.disabledReason).toBeNull();
  });

  it('(c) el acabado de la casilla está entre los de la liga ⇒ ese, aunque la liga liste otro primero', () => {
    const m = captureModel(PP_TWO, ['holofoil'], 'holofoil', 'en', PP.productId, { chosenFinish: null });
    expect(m.altaFinish).toBe('holofoil');
    expect(m.altaFinishMode).toBe('slot');
    expect(m.altaFinishOptions).toEqual([]);
    expect(m.combo).toMatchObject({ finish: 'holofoil', previewPriceCents: 15000 });
    expect(m.versionOptions.find((o) => o.key === String(PP.productId))).toMatchObject({ altaFinish: 'holofoil', implicitFinish: false });
  });

  it('fuera del modo casilla (captura por lote) nada cambia: el acabado es el elegido y la versión que no existe con él se apaga', () => {
    // Carta solo `normal`; la liga trae Holo ⇒ el Acabado pasa a burbujas (unión de combos) y, con «normal» elegido, la
    // liga (solo Holo) se apaga por `combo_missing` — el modelo de la captura por lote, sin cambios.
    const m = captureModel(LEAGUE_HOLO_ONLY, ['normal'], 'normal', 'en', LEAGUE.productId);
    expect(m.altaFinish).toBe('normal');
    expect(m.altaFinishMode).toBe('slot');
    expect(m.versionOptions.find((o) => o.key === String(LEAGUE.productId))!.disabledReason).toBe('combo_missing');
    expect(m.finishOptions).toEqual(['normal', 'holofoil']);
  });
});

describe('captureModel · hasVersions (TL-ALTA-5)', () => {
  it('sin datos ⇒ false; solo inglés ⇒ false; español con precio ⇒ true; liga ⇒ true; candidata ⇒ true', () => {
    expect(captureModel(undefined, ['normal'], 'normal', 'en', null).hasVersions).toBe(false);
    expect(captureModel({ combos: [combo({})], candidates: [] }, ['normal'], 'normal', 'en', null).hasVersions).toBe(false);
    expect(captureModel({ combos: [combo({}), combo({ language: 'es', previewPriceCents: null, unavailableReason: 'no_english_market' })], candidates: [] }, ['normal'], 'normal', 'en', null).hasVersions).toBe(false);
    expect(captureModel({ combos: base, candidates: [] }, ['normal'], 'normal', 'en', null).hasVersions).toBe(true);
    expect(captureModel(LEAGUE_HOLO_ONLY, ['normal'], 'normal', 'en', null).hasVersions).toBe(true);
    expect(captureModel({ combos: [combo({})], candidates: [{ tcgplayerProductId: 1, name: 'x', stamp: PP, finishes: ['normal'] }] }, ['normal'], 'normal', 'en', null).hasVersions).toBe(true);
  });
});
