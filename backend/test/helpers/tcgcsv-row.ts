import { releaseTcgcsvRow } from '../../src/modules/pricing/providers/tcgcsv-group-match';

/** §13.4(b): entrada TCGCSV ya liberada por la retención B3 (grupo confirmado) para las pruebas del escritor. */
export const tcgcsvRow = (marketCents: number, currency: 'USD' | 'MXN') =>
  releaseTcgcsvRow({ groupId: 1, via: 'confirmed' }, false, { marketCents, currency, source: 'tcgcsv_singles' as const })!;
