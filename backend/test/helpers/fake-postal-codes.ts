/**
 * fake-postal-codes.ts — un `PostalCodeService` REAL sobre una fuente en memoria (⛔ no un doble del servicio: la
 * normalización, el canónico y los `422` son los de producción; solo la tabla es de mentira). Fase C, M-64.
 *
 * CPs sembrados (forma SEPOMEX: colonia, municipio/alcaldía, estado):
 *  - 06600: Juárez, Roma Norte — Cuauhtémoc, Ciudad de México
 *  - 01000: San Ángel, Tlacopac — Álvaro Obregón, Ciudad de México
 *  - 14210: Jardines de la Montaña — Tlalpan, Ciudad de México
 *  - 64000: Monterrey Centro — Monterrey, Nuevo León
 */
import { PostalCodePort, PostalCodeRecord, PostalCodeService } from '../../src/modules/shipping-provider/geo/postal-code';

export const FAKE_POSTAL_CODES: Record<string, { neighborhood: string; municipality: string; state: string }[]> = {
  '06600': [
    { neighborhood: 'Juárez', municipality: 'Cuauhtémoc', state: 'Ciudad de México' },
    { neighborhood: 'Roma Norte', municipality: 'Cuauhtémoc', state: 'Ciudad de México' },
  ],
  '01000': [
    { neighborhood: 'San Ángel', municipality: 'Álvaro Obregón', state: 'Ciudad de México' },
    { neighborhood: 'Tlacopac', municipality: 'Álvaro Obregón', state: 'Ciudad de México' },
  ],
  '14210': [{ neighborhood: 'Jardines de la Montaña', municipality: 'Tlalpan', state: 'Ciudad de México' }],
  '64000': [{ neighborhood: 'Monterrey Centro', municipality: 'Monterrey', state: 'Nuevo León' }],
};

export class MemoryPostalCodeSource implements PostalCodePort {
  readonly calls: string[] = [];
  constructor(private readonly table = FAKE_POSTAL_CODES) {}
  async lookup(postalCode: string): Promise<PostalCodeRecord | null> {
    this.calls.push(postalCode);
    const entries = this.table[postalCode];
    return entries && entries.length > 0 ? { postalCode, source: 'local', entries } : null;
  }
}

export function fakePostalCodes(table = FAKE_POSTAL_CODES): PostalCodeService {
  return new PostalCodeService([new MemoryPostalCodeSource(table)]);
}
