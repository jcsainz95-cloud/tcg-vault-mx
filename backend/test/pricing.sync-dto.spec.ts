import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PRICE_SYNC_SCOPES, SyncDto } from '../src/modules/pricing/pricing.controller';

/**
 * QA (gate sobre `8a10153e`) — `POST /admin/pricing/sync` validaba `scope` solo con `@IsString`, así que
 * `{"scope":"bogus"}` respondía 201 y lanzaba la corrida COMPLETA con barrido VQ. §M2: `scope?:
 * "all_vault" | "cardIds"`. La prueba por HTTP (400 por el pipe real) vive en
 * `test/integration/pricing-sync-scope.e2e-spec.ts`; aquí, el DTO aislado.
 */
async function errorsOf(body: unknown): Promise<string[]> {
  const errs = await validate(plainToInstance(SyncDto, body as object));
  return errs.map((e) => e.property);
}

describe('SyncDto — dominio de `scope` y forma de `cardIds` (§M2)', () => {
  it('el dominio es EXACTAMENTE el del contrato', () => {
    expect([...PRICE_SYNC_SCOPES]).toEqual(['all_vault', 'cardIds']);
  });

  it.each([{}, { scope: 'all_vault' }, { scope: 'cardIds', cardIds: ['a', 'b'] }, { scope: 'cardIds', cardIds: [] }])(
    'acepta %j',
    async (body) => {
      expect(await errorsOf(body)).toEqual([]);
    },
  );

  it.each([
    [{ scope: 'bogus' }, 'scope'],
    [{ scope: '' }, 'scope'],
    [{ scope: 1 }, 'scope'],
    [{ scope: 'cardIds', cardIds: 'c1' }, 'cardIds'],
    [{ scope: 'cardIds', cardIds: [1] }, 'cardIds'],
  ])('rechaza %j (campo %s)', async (body, field) => {
    expect(await errorsOf(body)).toEqual([field]);
  });
});
