import { MemoryCardShowCounterStore } from '../src/modules/card-show/card-show-counter.store';
import { CardShowThrottleService } from '../src/modules/card-show/card-show-throttle.service';

/**
 * §CARDSHOW.4 (C7) — throttle por IP en el contador compartido. Mismo cubo = misma `ipKey`
 * (⛔ no una cabecera). Ventanas FIJAS: 5/min + 20/h por IP, 60/min global.
 */
describe('CARDSHOW · throttle por IP (C7)', () => {
  let now: number;
  let store: MemoryCardShowCounterStore;
  let svc: CardShowThrottleService;

  beforeEach(() => {
    now = 1_700_000_000_000;
    store = new MemoryCardShowCounterStore(() => now);
    svc = new CardShowThrottleService(store);
  });

  it('6 POST/60 s desde 1 IP ⇒ 5 permitidos + la 6.ª 429 con Retry-After entero ≥ 1', async () => {
    const results = [];
    for (let i = 0; i < 6; i += 1) results.push(await svc.hitPost('leads', '203.0.113.1'));
    expect(results.slice(0, 5).every((r) => r.allowed)).toBe(true);
    expect(results[5].allowed).toBe(false);
    expect(Number.isInteger(results[5].retryAfterSeconds)).toBe(true);
    expect(results[5].retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('el cubo es la ipKey: una IP distinta NO comparte el tope', async () => {
    for (let i = 0; i < 5; i += 1) await svc.hitPost('leads', '203.0.113.1');
    expect((await svc.hitPost('leads', '203.0.113.1')).allowed).toBe(false);
    expect((await svc.hitPost('leads', '203.0.113.2')).allowed).toBe(true);
  });

  it('21/<1 h ⇒ 429 desde la 21.ª (repartidas en minutos para no tocar el tope por minuto)', async () => {
    let allowed = 0;
    let denied = 0;
    for (let i = 0; i < 21; i += 1) {
      const r = await svc.hitPost('players', '198.51.100.9');
      r.allowed ? (allowed += 1) : (denied += 1);
      now += 61_000; // avanza >1 min ⇒ la ventana por-minuto se renueva, la de hora no
    }
    expect(allowed).toBe(20);
    expect(denied).toBe(1);
  });

  it('60/min global: 61 POST desde ≥13 IP (≤5 c/u) ⇒ 429 desde la 61.ª', async () => {
    let allowed = 0;
    let denied = 0;
    for (let i = 0; i < 61; i += 1) {
      const ip = `10.0.0.${Math.floor(i / 5)}`; // 13 IPs, ≤5 por IP
      const r = await svc.hitPost('leads', ip);
      r.allowed ? (allowed += 1) : (denied += 1);
    }
    expect(allowed).toBe(60);
    expect(denied).toBe(1);
  });

  it('form-token: 31.ª/h ⇒ 429; confirm: 31.ª/min ⇒ 429', async () => {
    for (let i = 0; i < 30; i += 1) expect((await svc.hitFormToken('1.1.1.1')).allowed).toBe(true);
    expect((await svc.hitFormToken('1.1.1.1')).allowed).toBe(false);
    for (let i = 0; i < 30; i += 1) expect((await svc.hitConfirm('2.2.2.2')).allowed).toBe(true);
    expect((await svc.hitConfirm('2.2.2.2')).allowed).toBe(false);
  });
});
