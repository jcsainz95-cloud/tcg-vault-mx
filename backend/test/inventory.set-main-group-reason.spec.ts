import 'reflect-metadata';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SetMainGroupRequestDto } from '../src/modules/inventory/dto/inventory.dto';

/**
 * SEC-M11-4 (BAJA/INFO) — `SetMainGroupRequestDto.reason` viaja al `AuditLog.after` (JSON) y NO tenía
 * cota, así que un super_admin podía escribir filas de bitácora desmesuradas. El motivo es una nota
 * «por qué» del operador; el precedente canónico del proyecto para ese tipo de motivo es `@Length(3, 500)`
 * TRAS `trim` (buylist `overrideReason`, `ItemDecisionDto.reason`). Fuera de rango ⇒ 400/422 vía el
 * `ValidationPipe` global. NO PII (motivo interno, nunca se expone en la UI de auditoría).
 */
describe('SEC-M11-4 · SetMainGroupRequestDto.reason acotado a 3..500 tras trim', () => {
  // Mismas opciones del `ValidationPipe` global (`main.ts`): whitelist + transform (trim depende de él).
  const opciones = { whitelist: true, forbidNonWhitelisted: false } as const;
  const build = (reason?: unknown) =>
    plainToInstance(
      SetMainGroupRequestDto,
      reason === undefined ? { tcgplayerGroupId: 800 } : { tcgplayerGroupId: 800, reason },
    );
  const reasonError = (reason?: unknown) =>
    validateSync(build(reason), opciones).some((e) => e.property === 'reason');

  it('⛔ reason de 501 caracteres ⇒ error (antes: 0)', () => {
    expect(reasonError('a'.repeat(501))).toBe(true);
  });

  it('⛔ reason de 5.000 caracteres ⇒ error', () => {
    expect(reasonError('x'.repeat(5000))).toBe(true);
  });

  it('⛔ reason demasiado corto (2 chars) ⇒ error (mínimo 3, consistencia con overrideReason)', () => {
    expect(reasonError('ab')).toBe(true);
  });

  it('⛔ reason que tras trim queda <3 (espacios) ⇒ error (la cota es TRAS trim)', () => {
    expect(reasonError('  a  ')).toBe(true);
  });

  it('✅ reason de 500 caracteres exactos pasa (límite inclusivo)', () => {
    expect(reasonError('b'.repeat(500))).toBe(false);
  });

  it('✅ 500 chars rodeados de espacios pasan (trim los quita antes de medir)', () => {
    expect(reasonError(`  ${'c'.repeat(500)}  `)).toBe(false);
  });

  it('✅ reason corto válido (3 chars) y reason ausente pasan (opcional)', () => {
    expect(reasonError('fix')).toBe(false);
    expect(reasonError(undefined)).toBe(false);
  });
});
