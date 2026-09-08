import {
  addBusinessDays,
  BusinessDaysCoverageError,
  BusinessDaysInputError,
  businessDaysSince,
  businessDaysUntil,
  isBusinessDay,
  MX_HOLIDAY_YEARS,
  MX_HOLIDAYS,
  MX_TIMEZONE,
  toMexicoCityDateKey,
} from '../src/common/business-days';

/**
 * v1.51 (M-46, ARCHITECTURE §4.39k / API_CONTRACT §12, criterio 154) — **«DÍA HÁBIL»: UNA definición
 * y FALLA RUIDOSAMENTE.**
 *
 * Lunes a viernes, sin festivos oficiales de México, en `America/Mexico_City`. **El sábado NO
 * cuenta.** Lo que este archivo protege no es la aritmética: es que **la fecha del correo, la de la
 * pantalla, la del barrido y la del recordatorio sean la MISMA** — y que, cuando el calendario no
 * alcanza, el sistema **falle hacia «no vence»** en vez de expirarle la oferta a alguien que cumplió.
 */

/** Helper: instante de una fecha civil de CDMX a una hora fija (12:00 local = 18:00Z sin DST). */
function cdmx(dateKey: string, hhmm = '12:00'): Date {
  // México abolió el horario de verano en 2022 ⇒ CST fijo (UTC−6) para todos los años de la tabla.
  return new Date(`${dateKey}T${hhmm}:00-06:00`);
}

// ============================================================================================
describe('§4.39k — la definición: L-V, sin festivos, en America/Mexico_City', () => {
  it('la zona horaria es la del criterio 154 y no es configurable', () => {
    expect(MX_TIMEZONE).toBe('America/Mexico_City');
  });

  it('lunes a viernes son hábiles', () => {
    // 2026-03-02 (lun) … 2026-03-06 (vie): semana limpia, sin festivos.
    for (const d of ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06']) {
      expect(isBusinessDay(cdmx(d))).toBe(true);
    }
  });

  it('⚠️ EL SÁBADO NO CUENTA (y el domingo tampoco)', () => {
    expect(isBusinessDay(cdmx('2026-03-07'))).toBe(false); // sábado
    expect(isBusinessDay(cdmx('2026-03-08'))).toBe(false); // domingo
  });

  it('un festivo oficial en día de semana NO es hábil', () => {
    expect(isBusinessDay(cdmx('2026-01-01'))).toBe(false); // Año Nuevo, jueves
    expect(isBusinessDay(cdmx('2026-02-02'))).toBe(false); // 1er lunes de febrero
    expect(isBusinessDay(cdmx('2026-03-16'))).toBe(false); // 3er lunes de marzo
    expect(isBusinessDay(cdmx('2026-05-01'))).toBe(false); // Día del Trabajo, viernes
    expect(isBusinessDay(cdmx('2026-09-16'))).toBe(false); // Independencia, miércoles
    expect(isBusinessDay(cdmx('2026-11-16'))).toBe(false); // 3er lunes de noviembre
    expect(isBusinessDay(cdmx('2026-12-25'))).toBe(false); // Navidad, viernes
  });

  it('⚠️ NO son festivos los que la COSTUMBRE trata como tales pero la ley no', () => {
    // Jueves/viernes santos, 2 de noviembre y 12 de diciembre NO están en el Art. 74 LFT. Meterlos
    // ALARGARÍA plazos que le prometimos al vendedor con otra fecha. La fuente es la ley.
    expect(isBusinessDay(cdmx('2026-11-02'))).toBe(true); // lunes
    expect(isBusinessDay(cdmx('2026-04-03'))).toBe(true); // Viernes Santo 2026
  });

  it('la fecha civil se resuelve en CDMX, no en UTC (un vencimiento nocturno no se corre un día)', () => {
    // 2026-03-06 23:00 CST = 2026-03-07 05:00Z. En UTC sería SÁBADO; en CDMX es VIERNES y es hábil.
    const nocheDelViernes = cdmx('2026-03-06', '23:00');
    expect(nocheDelViernes.toISOString().slice(0, 10)).toBe('2026-03-07'); // UTC dice sábado
    expect(toMexicoCityDateKey(nocheDelViernes)).toBe('2026-03-06'); // CDMX dice viernes
    expect(isBusinessDay(nocheDelViernes)).toBe(true);
  });
});

// ============================================================================================
describe('§4.39k — addBusinessDays: los plazos del ciclo (7 emitir / 2 aceptar / 3 enviar)', () => {
  it('cuenta desde el día SIGUIENTE y preserva la hora del día', () => {
    // Lunes 2026-03-02 + 1 hábil = martes 2026-03-03, misma hora.
    const from = cdmx('2026-03-02', '10:30');
    const out = addBusinessDays(from, 1);
    expect(toMexicoCityDateKey(out)).toBe('2026-03-03');
    expect(out.getTime() - from.getTime()).toBe(24 * 3600 * 1000);
  });

  it('⚠️ CRUZA FIN DE SEMANA: viernes + 1 hábil = LUNES (el sábado no cuenta)', () => {
    expect(toMexicoCityDateKey(addBusinessDays(cdmx('2026-03-06'), 1))).toBe('2026-03-09');
    // Y el plazo de 2 días del vendedor, arrancado un jueves, vence el LUNES.
    expect(toMexicoCityDateKey(addBusinessDays(cdmx('2026-03-05'), 2))).toBe('2026-03-09');
  });

  it('⚠️ CRUZA UN FESTIVO OFICIAL: el 3er lunes de marzo se salta', () => {
    // Viernes 2026-03-13 + 1 hábil: el lunes 16 es festivo ⇒ martes 17.
    expect(toMexicoCityDateKey(addBusinessDays(cdmx('2026-03-13'), 1))).toBe('2026-03-17');
    // Y el plazo de 3 días (enviar) desde el jueves 12 cae el miércoles 18, no el martes 17.
    expect(toMexicoCityDateKey(addBusinessDays(cdmx('2026-03-12'), 3))).toBe('2026-03-18');
  });

  it('el plazo de EMISIÓN (7 hábiles) sobre una semana con festivo', () => {
    // Desde el lunes 2026-03-09: 10,11,12,13 (4) · [14-15 findes] · [16 festivo] · 17,18,19 (7).
    expect(toMexicoCityDateKey(addBusinessDays(cdmx('2026-03-09'), 7))).toBe('2026-03-19');
  });

  it('`n = 0` devuelve el mismo instante (no hay plazo que contar)', () => {
    const from = cdmx('2026-03-02', '08:15');
    expect(addBusinessDays(from, 0).getTime()).toBe(from.getTime());
  });

  it('el resultado SIEMPRE cae en día hábil', () => {
    for (let n = 1; n <= 15; n++) {
      for (const start of ['2026-03-06', '2026-03-07', '2026-12-24', '2026-01-01']) {
        expect(isBusinessDay(addBusinessDays(cdmx(start), n))).toBe(true);
      }
    }
  });
});

// ============================================================================================
describe('§4.39k — businessDaysUntil / businessDaysSince: la MISMA cuenta, en la otra dirección', () => {
  it('`businessDaysUntil` es la inversa de `addBusinessDays`', () => {
    // Es la propiedad que hace que la pantalla («te quedan N días») y el correo («vence el D»)
    // NUNCA se contradigan: las dos salen del mismo conteo.
    for (const n of [1, 2, 3, 5, 7, 10]) {
      const from = cdmx('2026-03-09', '09:00');
      expect(businessDaysUntil(addBusinessDays(from, n), from)).toBe(n);
    }
  });

  it('devuelve 0 —nunca negativo— si el plazo ya pasó', () => {
    expect(businessDaysUntil(cdmx('2026-03-02'), cdmx('2026-03-09'))).toBe(0);
    expect(businessDaysUntil(cdmx('2026-03-09'), cdmx('2026-03-09'))).toBe(0);
  });

  it('`businessDaysSince` es lo que necesita la regla 7 del barrido (ancla ?? createdAt)', () => {
    // Del lunes 9 al viernes 13 han transcurrido 4 hábiles (10, 11, 12, 13).
    expect(businessDaysSince(cdmx('2026-03-09'), cdmx('2026-03-13'))).toBe(4);
    // Cruzando el festivo del lunes 16: del 13 al 17 ⇒ 1 solo hábil (el 17).
    expect(businessDaysSince(cdmx('2026-03-13'), cdmx('2026-03-17'))).toBe(1);
    expect(businessDaysSince(cdmx('2026-03-09'), cdmx('2026-03-09'))).toBe(0);
    expect(businessDaysSince(cdmx('2026-03-13'), cdmx('2026-03-09'))).toBe(0); // pasado ⇒ 0
  });

  it('`since` y `add` coinciden en el borde exacto del vencimiento (el barrido no adelanta)', () => {
    // La regla 7 dispara con `businessDaysSince(ancla) >= dial`. Si `since` contara uno de más, el
    // barrido mataría la solicitud UN DÍA ANTES de la fecha que le dijimos al vendedor.
    const ancla = cdmx('2026-03-09', '09:00');
    const vence = addBusinessDays(ancla, 7);
    expect(businessDaysSince(ancla, vence)).toBe(7);
    // Un día natural antes del vencimiento, todavía NO se cumplen los 7.
    const vispera = new Date(vence.getTime() - 24 * 3600 * 1000);
    expect(businessDaysSince(ancla, vispera)).toBeLessThan(7);
  });
});

// ============================================================================================
describe('§4.39k — ⚠️ FALLA RUIDOSAMENTE: la norma money-safe del helper', () => {
  it('la tabla de festivos declara qué años cubre, y son explícitos por año', () => {
    expect(MX_HOLIDAY_YEARS.length).toBeGreaterThan(0);
    for (const y of MX_HOLIDAY_YEARS) {
      expect(MX_HOLIDAYS[y].length).toBeGreaterThanOrEqual(7); // Art. 74 LFT: siete fijos por año
      for (const d of MX_HOLIDAYS[y]) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Cada fecha pertenece al año que la indexa (un typo de año se ve aquí, no en producción).
      for (const d of MX_HOLIDAYS[y]) expect(Number(d.slice(0, 4))).toBe(y);
    }
  });

  it('⚠️ un año SIN cobertura LANZA — está PROHIBIDO degradar a «no hay festivos»', () => {
    // Degradar adelantaría vencimientos y EXPIRARÍA OFERTAS DE GENTE QUE SÍ CUMPLIÓ.
    // Fallar hacia «no vence» es el único lado seguro: el barrido captura, loggea y NO expira.
    const fueraDeTabla = cdmx(`${Math.max(...MX_HOLIDAY_YEARS) + 1}-06-15`);
    expect(() => isBusinessDay(fueraDeTabla)).toThrow(BusinessDaysCoverageError);
    expect(() => addBusinessDays(fueraDeTabla, 3)).toThrow(BusinessDaysCoverageError);
    expect(() => businessDaysUntil(fueraDeTabla, fueraDeTabla)).not.toThrow(); // `to <= from` ⇒ 0
    // Y el mensaje dice qué hacer, no solo que falló.
    try {
      isBusinessDay(fueraDeTabla);
    } catch (e) {
      expect((e as Error).message).toMatch(/MX_HOLIDAYS/);
      expect((e as Error).message).toMatch(/Art\. 74 LFT/);
    }
  });

  it('⚠️ un plazo que SALE de la cobertura por la derecha también LANZA', () => {
    // Sumarle días hábiles a diciembre del último año cubierto se sale de la tabla: tiene que
    // lanzar, no «asumir» que enero del año siguiente no tiene festivos (el 1 de enero SÍ lo es).
    const finDeCobertura = cdmx(`${Math.max(...MX_HOLIDAY_YEARS)}-12-29`);
    expect(() => addBusinessDays(finDeCobertura, 10)).toThrow(BusinessDaysCoverageError);
  });

  it('⚠️ una fecha INVÁLIDA lanza, no se degrada a «hoy»', () => {
    // El contrato lo norma: una fecha silenciosamente equivocada es un vencimiento silenciosamente
    // equivocado, y este helper produce fechas que se le prometen por escrito a una persona.
    const invalida = new Date('no-es-una-fecha');
    expect(() => addBusinessDays(invalida, 2)).toThrow(BusinessDaysInputError);
    expect(() => businessDaysUntil(invalida)).toThrow(BusinessDaysInputError);
    expect(() => businessDaysSince(invalida)).toThrow(BusinessDaysInputError);
    expect(() => toMexicoCityDateKey(invalida)).toThrow(BusinessDaysInputError);
    expect(() => addBusinessDays(undefined as unknown as Date, 2)).toThrow(BusinessDaysInputError);
    expect(() => addBusinessDays(null as unknown as Date, 2)).toThrow(BusinessDaysInputError);
    // Un `n` sin sentido también: los diales de plazo son enteros >= 1.
    expect(() => addBusinessDays(cdmx('2026-03-02'), -1)).toThrow(BusinessDaysInputError);
    expect(() => addBusinessDays(cdmx('2026-03-02'), 1.5)).toThrow(BusinessDaysInputError);
  });

  it('los errores son tipos PROPIOS (el barrido tiene que poder distinguirlos)', () => {
    // Para aplicar la única conducta correcta —loggear `error` y NO expirar— el barrido necesita
    // saber que lo que falló fue el calendario, y no cualquier otra cosa.
    expect(new BusinessDaysCoverageError(1999)).toBeInstanceOf(Error);
    expect(new BusinessDaysCoverageError(1999).name).toBe('BusinessDaysCoverageError');
    expect(new BusinessDaysInputError('x').name).toBe('BusinessDaysInputError');
  });
});
