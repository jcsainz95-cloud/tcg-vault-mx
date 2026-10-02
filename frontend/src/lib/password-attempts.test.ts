import { describe, it, expect } from 'vitest';
import { retryAfterMinutes } from './password-attempts';

/**
 * v1.80 (C7, contrato §0): `{minutos} = max(1, ceil(retryAfterSeconds / 60))`. Los casos 61 y 121
 * existen para que `round`/`floor` no pasen (150 s solo no distingue `ceil` de `round`).
 */
describe('retryAfterMinutes (v1.80, C7)', () => {
  it.each([
    [1, 1],
    [59, 1],
    [60, 1],
    [61, 2],
    [121, 3],
    [150, 3],
    [3600, 60],
  ])('%i s ⇒ %i min', (seconds, minutes) => {
    expect(retryAfterMinutes({ retryAfterSeconds: seconds })).toBe(minutes);
  });

  it('0 s ⇒ 1 min (nunca «0 min»)', () => {
    expect(retryAfterMinutes({ retryAfterSeconds: 0 })).toBe(1);
  });

  it.each([[undefined], [null], [{}], [{ retryAfterSeconds: '150' }], [{ retryAfterSeconds: NaN }], [{ retryAfterSeconds: -5 }]])(
    'sin número usable (%j) ⇒ null: no se inventa cifra',
    (details) => {
      expect(retryAfterMinutes(details as Record<string, unknown> | undefined)).toBeNull();
    },
  );
});
