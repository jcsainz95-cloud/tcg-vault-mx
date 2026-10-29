/**
 * graded-estimate-seed-gem.e2e-spec.ts — v1.113.3 (hallazgo 5 de QA/tester-e2e de la release de la portada): **el seed
 * sintético trae una carta que pasa el gate de la vitrina** («Joyas para gradear»), para que la vitrina se vea en un gate
 * local sin sembrar nada a mano.
 *
 *  - con el dial `grading_hook_enabled` en `on`, `E2E_CARDS.gemhunt` sale en `?gradingHighlight=true&sort=grading_showcase`
 *    con su PSA 10 sembrado, y el `preview` de M2 la da elegible;
 *  - con el dial en `off` (el valor del seed: encenderlo es del dueño, §4.38r.3) no sale nada.
 * Determinista (N=1).
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_FOLIOS, E2E_GEM_ESTIMATES, E2E_USERS } from '../../prisma/e2e-fixtures';

describe('E2E — seed: la carta de «Joyas para gradear» (hallazgo 5)', () => {
  let h: E2EHarness;
  let admin: string;
  let cardId: string;
  let dialBefore: unknown;
  const setDial = (value: 'on' | 'off') => h.api('PUT', '/admin/settings', { token: admin, json: { gradingHookEnabled: value } });
  const vitrina = () =>
    h.api<{ data: { card: { id: string }; gradingHighlight?: { estimate: { referenceMxnCents: number } }[] }[] }>(
      'GET',
      '/catalog/cards?gradingHighlight=true&sort=grading_showcase&pageSize=50',
    );

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    cardId = (await h.prisma.card.findFirstOrThrow({ where: { externalId: E2E_CARDS.gemhunt.externalId } })).id;
    dialBefore = (await h.api<{ gradingHookEnabled: string }>('GET', '/admin/settings', { token: admin })).body.gradingHookEnabled;
  });

  afterAll(async () => {
    if (h) {
      await setDial(dialBefore === 'on' ? 'on' : 'off');
      await h.close();
    }
  });

  it('el seed deja la carta publicada (raw) con sus dos estimados de HOY y el dial en `off`', async () => {
    const piece = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { folio: E2E_FOLIOS.listedGemHunt } });
    expect(piece).toMatchObject({ cardId, productType: 'raw', ownerType: 'platform', status: 'listed' });
    const est = await h.prisma.priceReference.findMany({ where: { cardId, productType: 'graded' }, orderBy: { gradeKey: 'asc' } });
    expect(est.map((r) => [r.gradeKey, r.priceMxnCents, r.refKind])).toEqual(
      [...E2E_GEM_ESTIMATES].sort((a, b) => a.gradeKey.localeCompare(b.gradeKey)).map((e) => [e.gradeKey, e.priceMxnCents, 'graded_estimate']),
    );
    expect(est.every((r) => r.capturedDate.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10))).toBe(true);
  });

  it('dial `on` ⇒ la carta sale en la vitrina con su PSA 10 y el `preview` la da elegible', async () => {
    expect((await setDial('on')).status).toBe(200);
    const v = await vitrina();
    expect(v.status).toBe(200);
    const mine = v.body.data.find((g) => g.card.id === cardId);
    expect(mine).toBeDefined();
    expect(mine!.gradingHighlight![0].estimate.referenceMxnCents).toBe(E2E_GEM_ESTIMATES[0].priceMxnCents);
    const preview = await h.api<{ data?: unknown }>('GET', `/admin/pricing/graded-estimates/preview?cardId=${cardId}`, { token: admin });
    expect(preview.status).toBe(200);
    expect(JSON.stringify(preview.body)).toMatch(/"eligible":true/);
  });

  it('dial `off` ⇒ la vitrina no la trae (el seed no decide por el dueño)', async () => {
    expect((await setDial('off')).status).toBe(200);
    const v = await vitrina();
    expect(v.body.data.find((g) => g.card.id === cardId)).toBeUndefined();
  });
});
