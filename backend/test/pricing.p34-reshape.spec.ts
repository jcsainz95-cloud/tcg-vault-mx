/**
 * pricing.p34-reshape.spec.ts — unit del PLANNER puro del backfill P-34/M-38
 * (`prisma/backfill-p34-tiered-pricing.ts`). Sin DB: solo la decisión reshape/skip/no-op.
 * Money-safety: una tabla EDITADA A MANO (diverge del pristine) NUNCA se reshapea automáticamente.
 */
import { planSettingReshape } from '../prisma/backfill-p34-tiered-pricing';

const BUYLIST_PRISTINES = {
  flat: {
    Common: { mode: 'fixed', value: 50 },
    Uncommon: { mode: 'fixed', value: 50 },
    'Reverse Holo': { mode: 'fixed', value: 150 },
  },
  twoAxis: {
    rarityRules: { Common: { mode: 'fixed', value: 50 }, Uncommon: { mode: 'fixed', value: 50 } },
    finishRules: { reverse_holo: { mode: 'fixed', value: 150 } },
  },
};

const CANONICAL_TIERED = {
  tierRules: {
    T0: { mode: 'fixed', value: 50 },
    T1: { mode: 'fixed', value: 150 },
    T2: { mode: 'pct', value: 25 },
    T3: { mode: 'pct', value: 40 },
    T4: { mode: 'pct', value: 40 },
  },
  finishRules: { reverse_holo: { mode: 'fixed', value: 150 } },
};

describe('planSettingReshape (backfill P-34)', () => {
  it('shape ya TIERED → no-op idempotente', () => {
    const plan = planSettingReshape(CANONICAL_TIERED, BUYLIST_PRISTINES, CANONICAL_TIERED);
    expect(plan.action).toBe('already-tiered');
    expect(plan.canonicalTiered).toBeUndefined();
  });

  it('shape PLANO pristine → reshape al tiered canónico', () => {
    const plan = planSettingReshape(BUYLIST_PRISTINES.flat, BUYLIST_PRISTINES, CANONICAL_TIERED);
    expect(plan.action).toBe('reshape-pristine');
    expect(plan.matchedPristine).toBe('flat');
    expect(plan.canonicalTiered).toBe(CANONICAL_TIERED);
  });

  it('shape PLANO pristine con claves en otro ORDEN → sigue matcheando (comparación order-independent)', () => {
    const reordered = {
      'Reverse Holo': { value: 150, mode: 'fixed' },
      Uncommon: { mode: 'fixed', value: 50 },
      Common: { mode: 'fixed', value: 50 },
    };
    const plan = planSettingReshape(reordered, BUYLIST_PRISTINES, CANONICAL_TIERED);
    expect(plan.action).toBe('reshape-pristine');
  });

  it('shape DOS-EJES pristine (v1.29) → reshape al tiered canónico', () => {
    const plan = planSettingReshape(BUYLIST_PRISTINES.twoAxis, BUYLIST_PRISTINES, CANONICAL_TIERED);
    expect(plan.action).toBe('reshape-pristine');
    expect(plan.matchedPristine).toBe('two-axis');
  });

  it('shape LEGACY EDITADO A MANO (diverge) → NO se toca (money-safe), escala a revisión', () => {
    const diverged = {
      Common: { mode: 'fixed', value: 77 }, // valor hecho a mano
      Uncommon: { mode: 'fixed', value: 50 },
      'Reverse Holo': { mode: 'fixed', value: 150 },
    };
    const plan = planSettingReshape(diverged, BUYLIST_PRISTINES, CANONICAL_TIERED);
    expect(plan.action).toBe('skip-diverged');
    expect(plan.canonicalTiered).toBeUndefined();
  });

  it('legacy con rareza EXTRA agregada en M2 (diverge) → skip-diverged', () => {
    const withExtra = {
      ...BUYLIST_PRISTINES.flat,
      Rare: { mode: 'pct', value: 30 },
    };
    const plan = planSettingReshape(withExtra, BUYLIST_PRISTINES, CANONICAL_TIERED);
    expect(plan.action).toBe('skip-diverged');
  });

  it('clave ausente → missing (no la inventa)', () => {
    expect(planSettingReshape(null, BUYLIST_PRISTINES, CANONICAL_TIERED).action).toBe('missing');
    expect(planSettingReshape(undefined, BUYLIST_PRISTINES, CANONICAL_TIERED).action).toBe('missing');
  });
});
