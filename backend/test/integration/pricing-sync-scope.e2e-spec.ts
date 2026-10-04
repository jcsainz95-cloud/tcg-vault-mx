/**
 * pricing-sync-scope.e2e-spec.ts — `POST /admin/pricing/sync` respeta su `scope` (API_CONTRACT §M2,
 * rev v1.80.8.4: «con `scope="cardIds"` no barre»). Propiedad: backend; la ejecuta QA.
 *
 * Nace del gate de QA sobre `8a10153e`, que lo midió por HTTP:
 *  - `{"scope":"cardIds","cardIds":[]}` lanzaba la corrida COMPLETA y el barrido VQ (un `[]` contaba como
 *    «sin filtro»);
 *  - `{"scope":"bogus"}` respondía 201 y corría completo (`scope` solo tenía `@IsString`).
 *
 * Todo va por HTTP (guards + `ValidationPipe` + filtro reales). Testigo del barrido: una fila «sin motivo»
 * de VENTA cuya carta no tiene ninguna pieza — un barrido la cerraría. `syncCardPrice` se espía (y se
 * sustituye por `pending`) para no salir a la red si algo corriera de más; en los casos de este spec no
 * debe llamarse ni una vez.
 */
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { PriceSyncJobService } from '../../src/jobs/price-sync.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';

const SET_ID = 'e2e-sync-scope-set';
const CARD_ID = 'e2e-sync-scope-witness';

describe('E2E — `POST /admin/pricing/sync`: dominio de `scope` y `cardIds` vacío (§M2 v1.80.8.4)', () => {
  let h: E2EHarness;
  let adminToken: string;
  let witnessId: string;
  let syncSpy: jest.SpyInstance;
  let sweepSpy: jest.SpyInstance;

  async function cleanup() {
    await h.prisma.pendingPriceEntry.deleteMany({ where: { cardId: CARD_ID } });
    await h.prisma.card.deleteMany({ where: { id: CARD_ID } });
    await h.prisma.cardSet.deleteMany({ where: { id: SET_ID } });
  }

  const witnessStatus = async () =>
    (await h.prisma.pendingPriceEntry.findUniqueOrThrow({ where: { id: witnessId } })).status;

  beforeAll(async () => {
    h = await E2EHarness.create();
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    await cleanup();
    await h.prisma.cardSet.create({ data: { id: SET_ID, externalId: SET_ID, name: 'E2E sync scope' } });
    await h.prisma.card.create({
      data: {
        id: CARD_ID,
        externalId: CARD_ID,
        setId: SET_ID,
        name: 'Sync scope witness',
        number: '1',
        rarity: 'Common',
        rarityCanonical: 'Common',
        availableFinishes: ['normal'],
      },
    });
    witnessId = (
      await h.prisma.pendingPriceEntry.create({
        data: {
          cardId: CARD_ID,
          productType: 'raw',
          gradeKey: 'raw:NM',
          finish: 'normal',
          context: 'inventory',
          status: 'open',
          reason: null,
        },
      })
    ).id;
    syncSpy = jest.spyOn(h.app.get(PricingService), 'syncCardPrice').mockResolvedValue({ status: 'pending' });
    sweepSpy = jest.spyOn(h.app.get(PriceSyncJobService), 'sweepUnreasonedSaleQueue');
  });

  afterEach(() => {
    syncSpy.mockClear();
    sweepSpy.mockClear();
  });

  afterAll(async () => {
    syncSpy?.mockRestore();
    sweepSpy?.mockRestore();
    if (h) await cleanup();
    await h?.close();
  });

  it.each([
    [{ scope: 'cardIds', cardIds: [] }],
    [{ scope: 'cardIds' }],
  ])('%j ⇒ 201 `queued: 0`, sin refrescar y SIN barrido', async (json) => {
    const res = await h.api('POST', '/admin/pricing/sync', { token: adminToken, json });
    expect(res.status).toBe(201);
    expect(res.body.queued).toBe(0);
    expect(typeof res.body.jobId).toBe('string');
    expect(syncSpy).not.toHaveBeenCalled();
    expect(sweepSpy).not.toHaveBeenCalled();
    expect(await witnessStatus()).toBe('open');
  });

  it.each([
    [{ scope: 'bogus' }],
    [{ scope: '' }],
    [{ scope: 'cardIds', cardIds: 'e2e-sync-scope-witness' }],
  ])('%j ⇒ 400 VALIDATION_ERROR y no corre nada', async (json) => {
    const res = await h.api('POST', '/admin/pricing/sync', { token: adminToken, json });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(syncSpy).not.toHaveBeenCalled();
    expect(sweepSpy).not.toHaveBeenCalled();
    expect(await witnessStatus()).toBe('open');
  });

  it('`scope="cardIds"` con una carta sin piezas ⇒ 201 `queued: 0` y SIN barrido', async () => {
    const res = await h.api('POST', '/admin/pricing/sync', {
      token: adminToken,
      json: { scope: 'cardIds', cardIds: [CARD_ID] },
    });
    expect(res.status).toBe(201);
    expect(res.body.queued).toBe(0);
    expect(sweepSpy).not.toHaveBeenCalled();
    expect(await witnessStatus()).toBe('open');
  });
});
