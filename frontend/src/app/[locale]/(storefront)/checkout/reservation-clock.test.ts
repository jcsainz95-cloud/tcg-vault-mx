import { describe, it, expect } from 'vitest';
import { formatRemaining, formatReservationTime, remainingMs, reservationDeadline } from './reservation-clock';

/**
 * El reloj de la reserva NO inventa minutos (contrato v1.68 §4-R): solo formatea el instante del
 * servidor y lo resta del reloj local. Entrada inválida ⇒ `null`/`''`, nunca una cifra.
 */
describe('reservation-clock', () => {
  it('reservationDeadline: ISO válido ⇒ ms epoch; inválido/ausente ⇒ null', () => {
    expect(reservationDeadline('2026-09-11T13:05:00Z')).toBe(Date.UTC(2026, 8, 11, 13, 5, 0));
    expect(reservationDeadline('no-es-fecha')).toBeNull();
    expect(reservationDeadline(undefined)).toBeNull();
    expect(reservationDeadline(null)).toBeNull();
    expect(reservationDeadline('')).toBeNull();
  });

  it('formatReservationTime: hora de la Ciudad de México (UTC-6), en es-MX 24 h y en en-US 12 h', () => {
    // 13:05Z = 07:05 CDMX (CDMX no observa horario de verano desde 2022).
    expect(formatReservationTime('2026-09-11T13:05:00Z', 'es')).toBe('07:05');
    expect(formatReservationTime('2026-09-11T13:05:00Z', 'en')).toMatch(/^0?7:05\s?AM$/);
    expect(formatReservationTime('basura', 'es')).toBe('');
  });

  it('remainingMs: resta del `now` dado y nunca es negativo', () => {
    const now = Date.UTC(2026, 8, 11, 12, 0, 0);
    expect(remainingMs('2026-09-11T12:30:00Z', now)).toBe(30 * 60_000);
    expect(remainingMs('2026-09-11T11:59:00Z', now)).toBe(0);
    expect(remainingMs(undefined, now)).toBeNull();
  });

  it('formatRemaining: mm:ss redondeando hacia abajo; h:mm:ss por encima de la hora', () => {
    expect(formatRemaining(0)).toBe('00:00');
    expect(formatRemaining(999)).toBe('00:00');
    expect(formatRemaining(61_000)).toBe('01:01');
    expect(formatRemaining(59 * 60_000 + 59_999)).toBe('59:59');
    expect(formatRemaining(3_600_000)).toBe('1:00:00');
    expect(formatRemaining(-5)).toBe('00:00');
  });
});
