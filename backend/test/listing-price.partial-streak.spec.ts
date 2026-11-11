import { ListingPriceService } from '../src/modules/pricing/listing-price.service';

/** D9-7: 3 `partial` consecutivos de `formulaTick` ⇒ UN `logger.error`; cualquier otro resultado reinicia la cuenta. */
describe('ListingPriceService.formulaTick — alerta por `partial` consecutivos (D9-7)', () => {
  function build(seq: string[]) {
    const svc = Object.create(ListingPriceService.prototype) as ListingPriceService;
    const o = svc as unknown as Record<string, unknown>;
    const error = jest.fn();
    o['logger'] = { error };
    o['formulaPartialStreak'] = 0;
    const q = [...seq];
    o['formulaTickOnce'] = jest.fn(async () => ({ status: q.shift() }));
    return { svc, error };
  }

  it('al 3.º partial seguido emite logger.error (y no antes)', async () => {
    const { svc, error } = build(['partial', 'partial', 'partial']);
    await svc.formulaTick();
    await svc.formulaTick();
    expect(error).not.toHaveBeenCalled();
    await svc.formulaTick();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('un resultado distinto reinicia la cuenta; `busy` no la rompe', async () => {
    const { svc, error } = build(['partial', 'partial', 'ran', 'partial', 'partial', 'busy', 'partial']);
    for (let i = 0; i < 7; i++) await svc.formulaTick();
    expect(error).toHaveBeenCalledTimes(1); // solo la 2.ª tanda, con `busy` en medio
  });
});
