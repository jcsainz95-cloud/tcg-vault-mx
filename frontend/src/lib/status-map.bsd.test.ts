import { describe, it, expect } from 'vitest';
import { getBadgeSpec } from './status-map';

/** 💰 rev BSD-1 (DESIGN_SYSTEM §BSD-UX.4a, BX2): `expirada` + `not_continued` ⇒ «No continuó», NEUTRAL, `soft`, sin icono. */
describe('status-map · `expirada_not_continued`', () => {
  it('fila refinada propia (⛔ el fallback «Expirada», ⛔ `danger`, ⛔ icono)', () => {
    const spec = getBadgeSpec('sellRequest', 'expirada', 'not_continued');
    expect(spec.i18nKey).toBe('status.sellRequestExpiry.not_continued');
    expect(spec.tone).toBe('neutral');
    expect(spec.shape).toBe('soft');
    expect(spec.icon).toBeUndefined();
  });
});
