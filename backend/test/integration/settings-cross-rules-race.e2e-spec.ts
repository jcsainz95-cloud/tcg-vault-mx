/**
 * settings-cross-rules-race.e2e-spec.ts — PEN-DYN-2 (`docs/PENTEST_NOTES.md`, pase §DYN): las dos reglas CRUZADAS de diales
 * (`buylistShippingFeeCents + buylistMinimumOfferNetCents ≤ buylistMinimumRequestCents`, §4.39l; y Destacadas
 * `featuredRandomSlots + featuredNewArrivalSlots ∈ [1, 20]` con `featuredPoolSize ≥ featuredRandomSlots`, §DYN.3) contra
 * Postgres REAL y dos `update()` simultáneos, cada uno válido por sí solo y juntos fuera de la regla.
 *
 * El solapamiento NO es por suerte: una barrera en `prisma.$transaction` retiene a la primera escritura hasta que la segunda
 * también llega a su transacción. Con la regla evaluada FUERA de la transacción (el defecto), las dos leyeron el estado de
 * antes ⇒ las dos commitean y el estado final rompe la regla. Con la regla dentro (candado de diales + relectura por `tx`), la
 * segunda relee lo que escribió la primera y sale con `422`. N = 10 por regla, y se reporta `k/N`.
 */
import { E2EHarness } from './helpers/e2e-app';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { SettingKey, SettingKeyType } from '../../src/modules/settings/settings.constants';
import { BusinessException } from '../../src/common/business.exception';

const N = 10;

describe('PEN-DYN-2 — las reglas cruzadas de diales se evalúan dentro de la transacción (carrera forzada, N=10)', () => {
  let h: E2EHarness;
  let settings: SettingsService;
  const KEYS: SettingKeyType[] = [
    SettingKey.BUYLIST_SHIPPING_FEE_CENTS,
    SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS,
    SettingKey.BUYLIST_MINIMUM_REQUEST_CENTS,
    SettingKey.FEATURED_POOL_SIZE,
    SettingKey.FEATURED_RANDOM_SLOTS,
    SettingKey.FEATURED_NEW_ARRIVAL_SLOTS,
  ];
  const saved = new Map<string, unknown>();

  beforeAll(async () => {
    h = await E2EHarness.create();
    settings = h.app.get(SettingsService);
    for (const k of KEYS) saved.set(k, (await h.prisma.configSetting.findUnique({ where: { key: k } }))?.valueJson);
  });
  afterAll(async () => {
    for (const k of KEYS) {
      const v = saved.get(k);
      if (v === undefined) await h.prisma.configSetting.deleteMany({ where: { key: k } });
      else await h.prisma.configSetting.update({ where: { key: k }, data: { valueJson: v as object } });
    }
    await h.close();
  });

  async function setRaw(values: Record<string, number>) {
    for (const [key, v] of Object.entries(values)) {
      await h.prisma.configSetting.upsert({ where: { key }, create: { key, valueJson: v }, update: { valueJson: v } });
    }
  }
  async function readNum(key: string): Promise<number> {
    return Number((await h.prisma.configSetting.findUniqueOrThrow({ where: { key } })).valueJson);
  }

  /**
   * Dos `update()` a la vez con la barrera: la transacción de cada uno espera a que el OTRO haya llegado a la suya. Solo se
   * retienen las DOS primeras transacciones de la ventana (cualquier otra del proceso pasa sin esperar).
   */
  async function race(a: Record<string, unknown>, b: Record<string, unknown>) {
    const prisma = h.prisma as unknown as { $transaction: (...args: unknown[]) => Promise<unknown> };
    const original = prisma.$transaction.bind(h.prisma);
    let arrived = 0;
    let openGate!: () => void;
    const gate = new Promise<void>((r) => (openGate = r));
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation(async (...args: unknown[]) => {
      if (arrived < 2) {
        arrived += 1;
        if (arrived === 2) openGate();
        // Si la otra nunca llega (la regla la rechazó antes de su transacción), no se espera para siempre.
        await Promise.race([gate, new Promise((r) => setTimeout(r, 1500))]);
      }
      return original(...args);
    });
    try {
      return await Promise.allSettled([settings.update(a), settings.update(b)]);
    } finally {
      spy.mockRestore();
    }
  }

  const is422 = (r: PromiseSettledResult<unknown>) =>
    r.status === 'rejected' && r.reason instanceof BusinessException && r.reason.getStatus() === 422;

  it(`buylist: {fee 28000} ∥ {minNet 30000} sobre fee 10000 + minNet 10000 ≤ 50000 ⇒ una 200, otra 422 y la regla se cumple (${N}/${N})`, async () => {
    let ok = 0;
    const fails: string[] = [];
    for (let i = 0; i < N; i++) {
      await setRaw({
        [SettingKey.BUYLIST_SHIPPING_FEE_CENTS]: 10000,
        [SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS]: 10000,
        [SettingKey.BUYLIST_MINIMUM_REQUEST_CENTS]: 50000,
      });
      const res = await race({ buylistShippingFeeCents: 28000 }, { buylistMinimumOfferNetCents: 30000 });
      const fee = await readNum(SettingKey.BUYLIST_SHIPPING_FEE_CENTS);
      const net = await readNum(SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS);
      const min = await readNum(SettingKey.BUYLIST_MINIMUM_REQUEST_CENTS);
      const fulfilled = res.filter((r) => r.status === 'fulfilled').length;
      const good = fee + net <= min && fulfilled === 1 && res.some(is422);
      if (good) ok += 1;
      else fails.push(`#${i}: fee=${fee} net=${net} min=${min} fulfilled=${fulfilled}`);
    }
    // eslint-disable-next-line no-console
    console.log(`PEN-DYN-2 buylist: regla cumplida en ${ok}/${N}${fails.length ? ` · rotas: ${fails.join(' | ')}` : ''}`);
    expect(ok).toBe(N);
  });

  it(`Destacadas: {random 18} ∥ {newArrival 4} sobre random 10 + newArrival 2, pool 30 ⇒ una 200, otra 422 y la regla se cumple (${N}/${N})`, async () => {
    let ok = 0;
    const fails: string[] = [];
    for (let i = 0; i < N; i++) {
      await setRaw({
        [SettingKey.FEATURED_POOL_SIZE]: 30,
        [SettingKey.FEATURED_RANDOM_SLOTS]: 10,
        [SettingKey.FEATURED_NEW_ARRIVAL_SLOTS]: 2,
      });
      const res = await race({ featuredRandomSlots: 18 }, { featuredNewArrivalSlots: 4 });
      const random = await readNum(SettingKey.FEATURED_RANDOM_SLOTS);
      const fresh = await readNum(SettingKey.FEATURED_NEW_ARRIVAL_SLOTS);
      const fulfilled = res.filter((r) => r.status === 'fulfilled').length;
      const good = random + fresh <= 20 && fulfilled === 1 && res.some(is422);
      if (good) ok += 1;
      else fails.push(`#${i}: random=${random} newArrival=${fresh} fulfilled=${fulfilled}`);
    }
    // eslint-disable-next-line no-console
    console.log(`PEN-DYN-2 destacadas: regla cumplida en ${ok}/${N}${fails.length ? ` · rotas: ${fails.join(' | ')}` : ''}`);
    expect(ok).toBe(N);
  });
});
