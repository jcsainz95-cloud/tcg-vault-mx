/**
 * §AUTO-ENLACE §14.1 — veredicto de `stamped-ingest` por carta: SOLO un veredicto explícito del resolver libera o refresca; todo lo demás RETIENE (falla cerrada).
 */
import { StampedIngestService } from '../src/modules/pricing/stamped-ingest.service';
import * as match from '../src/modules/pricing/providers/tcgcsv-group-match';

const set = { id: 's1', name: 'X', pptSetId: null, externalId: 'x', series: null, releaseDate: null, cardGroupId: null, cardGroupVia: null };
function svc(card: unknown): StampedIngestService {
  const prisma = { card: { findUnique: jest.fn().mockResolvedValue(card) } };
  return new StampedIngestService(prisma as never, {} as never, {} as never);
}
const run = (s: StampedIngestService) => s.cardVerdict('c1', new Map(), async () => []);

describe('stamped-ingest cardVerdict (§14.1, falla cerrada)', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each<[string, string, unknown, unknown]>([
    ['carta ausente', 'retain', null, undefined],
    ['set ausente', 'retain', { set: null }, undefined],
    ['resolución nula', 'retain', { set }, null],
    ['sin groupId y sin `failure` (no es veredicto)', 'retain', { set }, {}],
    ['sin groupId con `failure` desconocido', 'retain', { set }, { groupId: null, failure: 'raro' }],
    ['via desconocido', 'retain', { set }, { groupId: 7, via: 'raro' }],
    ['via ausente', 'retain', { set }, { groupId: 7 }],
    ['«no hay grupo» definitivo (no_match)', 'release', { set }, { groupId: null, failure: 'no_match' }],
    ['via confirmed', 'release', { set }, { groupId: 7, via: 'confirmed' }],
    ['via b3', 'b3', { set }, { groupId: 7, via: 'b3' }],
  ])('%s ⇒ %s', async (_n, mode, card, res) => {
    jest.spyOn(match, 'resolveTcgcsvGroupForSet').mockResolvedValue(res as never);
    expect((await run(svc(card))).mode).toBe(mode);
  });

  it('error del resolver ⇒ retain', async () => {
    jest.spyOn(match, 'resolveTcgcsvGroupForSet').mockRejectedValue(new Error('boom'));
    expect((await run(svc({ set }))).mode).toBe('retain');
  });
});
