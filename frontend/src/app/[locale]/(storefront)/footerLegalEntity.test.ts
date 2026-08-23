import { describe, it, expect } from 'vitest';
import { resolveLegalEntity } from './footer';

describe('resolveLegalEntity · footer degrada con gracia sin razón social (P-21)', () => {
  it('omite (null) cuando está vacío o en blanco', () => {
    expect(resolveLegalEntity('')).toBeNull();
    expect(resolveLegalEntity('   ')).toBeNull();
    expect(resolveLegalEntity(undefined)).toBeNull();
    expect(resolveLegalEntity(null)).toBeNull();
  });

  it('omite (null) el placeholder entre corchetes en ambos idiomas', () => {
    expect(resolveLegalEntity('[Razón social pendiente]')).toBeNull();
    expect(resolveLegalEntity('[Legal entity pending]')).toBeNull();
    expect(resolveLegalEntity('  [RAZÓN SOCIAL PENDIENTE]  ')).toBeNull();
  });

  it('devuelve la razón social real (recortada) cuando el humano la carga', () => {
    expect(resolveLegalEntity('TCG Hunt S.A. de C.V.')).toBe('TCG Hunt S.A. de C.V.');
    expect(resolveLegalEntity('  Comercializadora TCG  ')).toBe('Comercializadora TCG');
  });
});
