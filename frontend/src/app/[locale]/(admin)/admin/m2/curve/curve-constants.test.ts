import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_CURVE_CONSTANT_CENTS, constantError } from './curve-draft';

/**
 * Techo de cordura de `floorCents` / `binCents` — contrato v2.1.9 §M2, cerrado por el dueño (Q-D1).
 *
 * Por qué esto tiene test propio: el número vive **en dos lados** (aquí y en el backend) y tiene que
 * ser **el mismo**. Si el cliente acepta en el campo lo que el `PUT` rechaza con 422, cliente y
 * servidor discrepan sobre la misma regla y el editor promete un guardado que no ocurre — §21.4
 * con el signo invertido. Un test que fija la cifra convierte una futura divergencia en un rojo.
 */
describe('MAX_CURVE_CONSTANT_CENTS · el techo del piso y el bin', () => {
  it('es MX$2,000 (200_000 centavos), el valor que cerró el dueño en Q-D1', () => {
    expect(MAX_CURVE_CONSTANT_CENTS).toBe(200_000);
  });

  it('acepta el techo exacto y rechaza un centavo más', () => {
    expect(constantError('2000')).toBeNull();
    expect(constantError('2000.01')).toBe('constantTooHigh');
  });

  it('sigue rechazando vacío y negativo (lo de antes no se pierde)', () => {
    expect(constantError('')).toBe('required');
    expect(constantError('-1')).toBe('negative');
  });

  it('deja pasar la semilla del piso (MX$25) y la del bin (MX$1)', () => {
    expect(constantError('25')).toBeNull();
    expect(constantError('1')).toBeNull();
  });

  it('el copy del error nombra el MISMO número que el validador', () => {
    // Un mensaje que dice «MX$10,000» junto a un validador que corta en 2,000 es peor que no
    // tener mensaje: manda al dueño a teclear otra vez lo mismo.
    const messages = (locale: string) =>
      JSON.parse(readFileSync(join(process.cwd(), 'messages', `${locale}.json`), 'utf8'));
    const es = messages('es');
    const en = messages('en');
    const pesos = (MAX_CURVE_CONSTANT_CENTS / 100).toLocaleString('en-US');
    expect(es.admin.m2.curve.fieldError.constantTooHigh).toContain(`MX$${pesos}`);
    expect(en.admin.m2.curve.fieldError.constantTooHigh).toContain(`MX$${pesos}`);
  });
});
