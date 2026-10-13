import { MemoryCardShowCounterStore } from '../src/modules/card-show/card-show-counter.store';
import { CardShowMailboxCapsService } from '../src/modules/card-show/card-show-mailbox-caps.service';

/** §CARDSHOW.8/.11/.12 (C2) — topes por buzón/dominio/avisos, con reloj simulado. */
describe('CARDSHOW · topes por buzón (C2)', () => {
  const H = 60 * 60 * 1000;

  it('buzón NO confirmado: altas t0, t0+25 h, t0+50 h ⇒ 2 envíos (máx 2, separados ≥ 24 h)', async () => {
    let now = 1_700_000_000_000;
    const store = new MemoryCardShowCounterStore(() => now);
    const caps = new CardShowMailboxCapsService(store);
    const mbox = 'hmac-victima';

    expect(await caps.reserveUnconfirmedSend(mbox)).toBe(true); // t0 ⇒ 1.º
    now += 25 * H;
    expect(await caps.reserveUnconfirmedSend(mbox)).toBe(true); // t0+25h ⇒ 2.º (≥24h)
    now += 25 * H;
    expect(await caps.reserveUnconfirmedSend(mbox)).toBe(false); // t0+50h ⇒ ya gastó 2
  });

  it('buzón NO confirmado: 2.ª alta dentro de 24 h ⇒ retenida (gap)', async () => {
    let now = 1_700_000_000_000;
    const store = new MemoryCardShowCounterStore(() => now);
    const caps = new CardShowMailboxCapsService(store);
    expect(await caps.reserveUnconfirmedSend('m')).toBe(true);
    now += 3 * H; // < 24 h
    expect(await caps.reserveUnconfirmedSend('m')).toBe(false);
  });

  it('buzón confirmado: máx 4 / 24 h (el 5.º no sale)', async () => {
    const store = new MemoryCardShowCounterStore(() => 1_700_000_000_000);
    const caps = new CardShowMailboxCapsService(store);
    for (let i = 0; i < 4; i += 1) expect(await caps.reserveConfirmedSend('c')).toBe(true);
    expect(await caps.reserveConfirmedSend('c')).toBe(false);
  });

  it('dominio no masivo: 20 / 24 h (el 21.º no sale)', async () => {
    const store = new MemoryCardShowCounterStore(() => 1_700_000_000_000);
    const caps = new CardShowMailboxCapsService(store);
    for (let i = 0; i < 20; i += 1) expect(await caps.reserveDomainSend('dominio.mx')).toBe(true);
    expect(await caps.reserveDomainSend('dominio.mx')).toBe(false);
  });

  it('avisos internos: ≤ 10/h', async () => {
    const store = new MemoryCardShowCounterStore(() => 1_700_000_000_000);
    const caps = new CardShowMailboxCapsService(store);
    for (let i = 0; i < 10; i += 1) expect(await caps.reserveInternalNotice()).toBe(true);
    expect(await caps.reserveInternalNotice()).toBe(false);
  });

  it('torneo: máx 4 playerId por buzón y día (el 5.º ⇒ false)', async () => {
    const store = new MemoryCardShowCounterStore(() => 1_700_000_000_000);
    const caps = new CardShowMailboxCapsService(store);
    for (let i = 0; i < 4; i += 1) expect(await caps.reservePlayerPerMailboxDay('m', 'sat')).toBe(true);
    expect(await caps.reservePlayerPerMailboxDay('m', 'sat')).toBe(false);
    // otro día es un cubo distinto
    expect(await caps.reservePlayerPerMailboxDay('m', 'sun')).toBe(true);
  });
});
