/**
 * D9 §8.4 (i) — validación del dial de comisión: `stripe_fee_pct ∈ [0, 0.10]` y `pct × (1+IVA) ≤ 0.25`, al guardar el pct O el IVA.
 * 422 con `details.rule = stripe_fee_pct_times_iva`; el valor anterior queda intacto. N=1 por caso, determinista.
 */
import { validateStripeFeeCombination } from '../src/modules/settings/settings.constants';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';

/** Doble mínimo de Prisma: filas vigentes + transacción que aplica upserts en memoria. */
function settingsWith(stored: Record<string, unknown>) {
  const store = new Map<string, unknown>(Object.entries(stored));
  const prisma = {
    configSetting: {
      findMany: jest.fn(async (args?: { where?: { key?: { in?: string[] } } }) => {
        const keys = args?.where?.key?.in ?? [...store.keys()];
        return keys.filter((k) => store.has(k)).map((k) => ({ key: k, valueJson: store.get(k) }));
      }),
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) =>
        store.has(where.key) ? { key: where.key, valueJson: store.get(where.key) } : null,
      ),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        configSetting: {
          upsert: jest.fn(async ({ where, create }: { where: { key: string }; create: { valueJson: unknown } }) => {
            store.set(where.key, create.valueJson);
          }),
          findUnique: jest.fn(async () => null),
          // PEN-DYN-2: las reglas cruzadas releen POR `tx`, después del candado.
          findMany: jest.fn(async (args?: { where?: { key?: { in?: string[] } } }) => {
            const keys = args?.where?.key?.in ?? [...store.keys()];
            return keys.filter((k) => store.has(k)).map((k) => ({ key: k, valueJson: store.get(k) }));
          }),
        },
        $executeRaw: jest.fn(async () => 0),
      }),
    ),
  } as unknown as PrismaService;
  return { svc: new SettingsService(prisma), store };
}


const rule = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    const b = e as { code?: string; details?: { rule?: string } };
    return { code: b.code, rule: b.details?.rule };
  }
};

describe('D9 §8.4 (i) — stripe_fee_pct y su condición cruzada con el IVA', () => {
  it('pct fuera de [0, 0.10] ⇒ rechazado y el valor anterior queda intacto', async () => {
    const { svc, store } = settingsWith({ stripe_fee_pct: 0.036 });
    expect(await rule(svc.update({ stripeFeePct: 0.11 }))).not.toBeNull();
    expect(await rule(svc.update({ stripeFeePct: -0.01 }))).not.toBeNull();
    expect(store.get('stripe_fee_pct')).toBe(0.036);
  });
  it('los valores de hoy (0.036, 16 %) y el tope 0.10 con IVA 100 % se aceptan', async () => {
    const { svc, store } = settingsWith({ stripe_fee_pct: 0.036, iva_pct: 16 });
    expect(await rule(svc.update({ stripeFeePct: 0.1 }))).toBeNull();
    expect(await rule(svc.update({ ivaPct: 100 }))).toBeNull(); // 0.10 × 2 = 0.20 ≤ 0.25
    expect(store.get('stripe_fee_pct')).toBe(0.1);
  });
  it('la condición cruzada pct × (1+IVA) ≤ 0.25 (pura): 0.036×1.16 pasa; 0.22×1.16 y 0.13×2 no', () => {
    expect(validateStripeFeeCombination({ stripePct: 0.036, ivaPct: 16 })).toBeNull();
    expect(validateStripeFeeCombination({ stripePct: 0.25 / 1.16, ivaPct: 16 })).toBeNull();
    expect(validateStripeFeeCombination({ stripePct: 0.22, ivaPct: 16 })?.message).toMatch(/25 %/);
    expect(validateStripeFeeCombination({ stripePct: 0.13, ivaPct: 100 })).not.toBeNull();
  });
  it('el servicio evalúa la condición cruzada con el valor RESULTANTE (si el validador de rango se aflojara, el cruce sigue rechazando)', async () => {
    const { svc, store } = settingsWith({ stripe_fee_pct: 0.1, iva_pct: 16 });
    // El IVA máximo admitido es 100 ⇒ con pct ≤ 0.10 el cruce nunca dispara por la puerta pública; se fuerza el estado vigente.
    store.set('stripe_fee_pct', 0.2);
    expect(await rule(svc.update({ ivaPct: 30 }))).toEqual({ code: 'VALIDATION_ERROR', rule: 'stripe_fee_pct_times_iva' }); // 0.2 × 1.3 = 0.26 > 0.25
  });
});
