import { describe, it, expect } from 'vitest';
import { parseUserId } from './tabs';

describe('§FICHA-CLIENTE · ?userId= en M4', () => {
  it('lee un id válido (también el primero de un arreglo)', () => {
    expect(parseUserId('u-777')).toBe('u-777');
    expect(parseUserId(['3f2c-aa', 'otro'])).toBe('3f2c-aa');
  });
  it('rechaza vacío, ausente y caracteres raros', () => {
    expect(parseUserId(undefined)).toBeNull();
    expect(parseUserId('')).toBeNull();
    expect(parseUserId('a b')).toBeNull();
    expect(parseUserId('<script>')).toBeNull();
    expect(parseUserId('x'.repeat(65))).toBeNull();
  });
});
