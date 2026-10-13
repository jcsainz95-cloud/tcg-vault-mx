import { CardShowSignupStatus } from '@prisma/client';
import { assignOnConfirm, playerIdLast4 } from '../src/modules/card-show/tournament.util';
import { csvCell, csvDocument } from '../src/modules/card-show/csv.util';

/** §CARDSHOW.12 (L0-SEG-02) — cupo al confirmar, por orden. */
describe('CARDSHOW · asignación de cupo al confirmar', () => {
  it('cupo 2/día: los primeros 2 CONFIRMED, el 3.º WAITLIST', () => {
    expect(assignOnConfirm(0, 2)).toBe(CardShowSignupStatus.confirmed);
    expect(assignOnConfirm(1, 2)).toBe(CardShowSignupStatus.confirmed);
    expect(assignOnConfirm(2, 2)).toBe(CardShowSignupStatus.waitlist);
  });

  it('cupo desconocido (null) ⇒ no se recorta (todos CONFIRMED)', () => {
    expect(assignOnConfirm(100, null)).toBe(CardShowSignupStatus.confirmed);
  });

  it('playerIdLast4: solo los últimos 4 dígitos (⛔ nunca el completo)', () => {
    expect(playerIdLast4('1234567')).toBe('4567');
    expect(playerIdLast4('12')).toBe('12');
  });
});

/** §CARDSHOW.15 — CSV con defensa anti-inyección de fórmulas y sin IP. */
describe('CARDSHOW · CSV anti-inyección de fórmulas', () => {
  it('neutraliza celdas que abren con = + - @ o control', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+A1')).toBe("'+A1");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tTAB')).toBe("'\tTAB");
  });

  it('un correo normal no se toca; uno con coma/comillas se entrecomilla', () => {
    expect(csvCell('user@dominio.mx')).toBe('user@dominio.mx');
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });

  it('un correo que es payload de fórmula se neutraliza (apóstrofo + entrecomillado)', () => {
    const out = csvCell('=HYPERLINK("http://evil","x")@dominio.mx');
    expect(out.startsWith('"\'=HYPERLINK')).toBe(true); // apóstrofo delante, dentro de comillas
    expect(out).toContain('""http://evil""'); // comillas internas duplicadas (RFC 4180)
  });

  it('documento: cabecera + filas, terminado en \\n; ⛔ sin columna IP', () => {
    const doc = csvDocument(['type', 'email', 'status'], [['visitor', '=evil@x.mx', 'new']]);
    expect(doc).toBe('type,email,status\nvisitor,\'=evil@x.mx,new\n');
    expect(doc.toLowerCase()).not.toContain('ip');
  });
});
