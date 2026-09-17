import 'reflect-metadata';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SetMainGroupRequestDto } from '../src/modules/inventory/dto/inventory.dto';

/**
 * SEC-M11-4 (BAJA/higiene) — `SetMainGroupRequestDto.reason` iba a `AuditLog.after` (JSON) SIN
 * `@MaxLength`, así que un super_admin podía escribir filas de bitácora desmesuradas. El límite canónico
 * del proyecto para un `reason` interno que viaja al `AuditLog` es 500 (buylist `DeclineDto`,
 * `OfferCancelDto`, `RejectRequestDto`). La validación fuera de rango debe fallar como el resto (⇒ 400/422
 * vía el `ValidationPipe` global). NO PII (motivo interno del operador, nunca se expone en UI).
 */
describe('SEC-M11-4 · SetMainGroupRequestDto.reason con @MaxLength(500)', () => {
  // Las MISMAS opciones del `ValidationPipe` global (`main.ts`): whitelist + transform.
  const opciones = { whitelist: true, forbidNonWhitelisted: false } as const;

  it('⛔ reason de 501 caracteres ⇒ ≥1 error (antes: 0)', () => {
    const dto = plainToInstance(SetMainGroupRequestDto, {
      tcgplayerGroupId: 800,
      reason: 'a'.repeat(501),
    });
    const errores = validateSync(dto, opciones);
    expect(errores.length).toBeGreaterThanOrEqual(1);
    expect(errores.some((e) => e.property === 'reason')).toBe(true);
  });

  it('⛔ reason de 5.000 caracteres ⇒ ≥1 error', () => {
    const dto = plainToInstance(SetMainGroupRequestDto, {
      tcgplayerGroupId: 800,
      reason: 'x'.repeat(5000),
    });
    expect(validateSync(dto, opciones).some((e) => e.property === 'reason')).toBe(true);
  });

  it('✅ reason de 500 caracteres exactos pasa (límite inclusivo)', () => {
    const dto = plainToInstance(SetMainGroupRequestDto, {
      tcgplayerGroupId: 800,
      reason: 'b'.repeat(500),
    });
    expect(validateSync(dto, opciones)).toHaveLength(0);
  });

  it('✅ reason corto / ausente pasa (es opcional)', () => {
    expect(
      validateSync(plainToInstance(SetMainGroupRequestDto, { tcgplayerGroupId: 800, reason: 'fix' }), opciones),
    ).toHaveLength(0);
    expect(
      validateSync(plainToInstance(SetMainGroupRequestDto, { tcgplayerGroupId: 800 }), opciones),
    ).toHaveLength(0);
  });
});
