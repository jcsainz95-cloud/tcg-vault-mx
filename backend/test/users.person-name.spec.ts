import { assertPersonName, PERSON_NAME_MAX } from '../src/modules/users/person-name';

/**
 * v1.67 (contrato §1 `PATCH /users/me` y «Direcciones»): trim server-side; tras el trim 1..120;
 * vacío/ausente/`null`/mayor ⇒ `400 VALIDATION_ERROR` con `details.field`.
 */
describe('assertPersonName — regla única para `name` y `recipientName` (v1.67)', () => {
  it('recorta espacios y devuelve el valor normalizado', () => {
    expect(assertPersonName('  Ana Pérez  ', 'name')).toBe('Ana Pérez');
  });

  it('acepta exactamente 1 y exactamente 120 caracteres (cotas inclusivas)', () => {
    expect(assertPersonName('A', 'recipientName')).toBe('A');
    const max = 'x'.repeat(PERSON_NAME_MAX);
    expect(assertPersonName(max, 'recipientName')).toBe(max);
  });

  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['null', null],
    ['undefined', undefined],
    ['no-string', 42],
  ])('%s ⇒ 400 VALIDATION_ERROR con details.field', (_label, value) => {
    expect(() => assertPersonName(value, 'name')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR', details: { field: 'name' } }),
    );
    let status = 0;
    try {
      assertPersonName(value, 'recipientName');
    } catch (e: any) {
      status = e.getStatus();
      expect(e.details.field).toBe('recipientName');
    }
    expect(status).toBe(400);
  });

  it('121 caracteres (tras trim) ⇒ 400 VALIDATION_ERROR con details.field y max', () => {
    const tooLong = ' ' + 'x'.repeat(PERSON_NAME_MAX + 1) + ' ';
    expect(() => assertPersonName(tooLong, 'name')).toThrow(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
        details: { field: 'name', max: PERSON_NAME_MAX },
      }),
    );
  });

  it('120 caracteres rodeados de espacios pasa (la cota se mide DESPUÉS del trim)', () => {
    const padded = '   ' + 'y'.repeat(PERSON_NAME_MAX) + '   ';
    expect(assertPersonName(padded, 'recipientName')).toHaveLength(PERSON_NAME_MAX);
  });
});
