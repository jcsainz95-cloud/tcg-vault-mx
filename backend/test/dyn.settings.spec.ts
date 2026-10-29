/**
 * dyn.settings.spec.ts — v1.113⟨portada⟩ (API_CONTRACT §DYN.3, M-93): los SEIS diales sin dinero de §DYN.3, su seed (idéntico
 * al `INSERT` de M-93), su dominio, las dos reglas de combinación (`422 VALIDATION_ERROR` con `details.rule`, evaluadas sobre
 * el valor RESULTANTE del `PUT` parcial) y el retiro de `graded_estimate_ingest_max_cards_per_run`.
 * ⛔ Oráculo escrito a mano desde la tabla del contrato.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RETIRED_SETTING_KEYS,
  SETTING_DEFAULTS,
  SETTING_DTO_MAP,
  SETTING_VALIDATORS,
  SettingKey,
  SettingKeyType,
} from '../src/modules/settings/settings.constants';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';

const TABLE: { dto: string; db: string; seed: number; ok: unknown[]; bad: unknown[] }[] = [
  { dto: 'featuredPoolSize', db: 'featured_pool_size', seed: 60, ok: [1, 60, 500], bad: [0, 501, 1.5, '60', null] },
  { dto: 'featuredRandomSlots', db: 'featured_random_slots', seed: 8, ok: [0, 8, 20], bad: [-1, 21, 2.5, '8'] },
  { dto: 'featuredNewArrivalSlots', db: 'featured_new_arrival_slots', seed: 2, ok: [0, 2, 4], bad: [-1, 5, 1.5] },
  { dto: 'featuredNewArrivalWindowDays', db: 'featured_new_arrival_window_days', seed: 7, ok: [1, 7, 30], bad: [0, 31, 7.5] },
  { dto: 'featuredRotationHour', db: 'featured_rotation_hour', seed: 6, ok: [0, 6, 23], bad: [-1, 24, 6.5] },
  {
    dto: 'gradedEstimateDailyCreditCap',
    db: 'graded_estimate_daily_credit_cap',
    seed: 3000,
    ok: [0, 3000, 20000],
    bad: [-1, 20001, 1.5, '3000'],
  },
];

describe('DYN.3 — los seis diales de M-93', () => {
  it.each(TABLE)('$dto ⇒ $db en SETTING_DTO_MAP', ({ dto, db }) => {
    expect(SETTING_DTO_MAP[dto]).toBe(db);
  });
  it.each(TABLE)('$db: seed = $seed', ({ db, seed }) => {
    expect(SETTING_DEFAULTS[db as SettingKeyType]).toBe(seed);
  });
  it.each(TABLE)('$db: dominio (dentro ⇒ null; fuera ⇒ mensaje)', ({ db, ok, bad }) => {
    const v = SETTING_VALIDATORS[db as SettingKeyType];
    expect(v).toBeDefined();
    for (const x of ok) expect(v(x)).toBeNull();
    for (const x of bad) expect(typeof v(x)).toBe('string');
  });
  it('el INSERT de M-93 siembra EXACTAMENTE `SETTING_DEFAULTS` de las seis', () => {
    const sql = readFileSync(
      join(__dirname, '..', 'prisma', 'migrations', '20261110120000_m93_portada_dinamica', 'migration.sql'),
      'utf8',
    );
    const rows = [...sql.matchAll(/\('([a-z_]+)', '([^']+)'::jsonb, 'migration:m93-portada'/g)].map((m) => [m[1], JSON.parse(m[2])]);
    expect(Object.fromEntries(rows)).toEqual(Object.fromEntries(TABLE.map((t) => [t.db, t.seed])));
  });
});

describe('DYN.3 / DYN-B20 — `graded_estimate_ingest_max_cards_per_run` RETIRADO', () => {
  it('ya no es una clave viva: ni en `SettingKey`, ni en el DTO de M10, ni con seed', () => {
    expect(Object.values(SettingKey)).not.toContain('graded_estimate_ingest_max_cards_per_run');
    expect(Object.values(SETTING_DTO_MAP)).not.toContain('graded_estimate_ingest_max_cards_per_run');
    expect(Object.keys(SETTING_DEFAULTS)).not.toContain('graded_estimate_ingest_max_cards_per_run');
  });
  it('su fila (huérfana) se rotula en el inventario de arranque como retirada', () => {
    expect(RETIRED_SETTING_KEYS).toContain('graded_estimate_ingest_max_cards_per_run');
  });
});

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
        },
        $executeRaw: jest.fn(async () => 0),
      }),
    ),
  } as unknown as PrismaService;
  return { svc: new SettingsService(prisma), store };
}

describe('DYN.3 — reglas de combinación sobre el valor RESULTANTE (422 con `details.rule`)', () => {
  const rule = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      const b = e as { code?: string; details?: { rule?: string } };
      return { code: b.code, rule: b.details?.rule };
    }
  };

  it('azar + recién llegadas = 0 ⇒ `featured_slots_total`', async () => {
    const { svc } = settingsWith({});
    expect(await rule(svc.update({ featuredRandomSlots: 0, featuredNewArrivalSlots: 0 }))).toEqual({
      code: 'VALIDATION_ERROR',
      rule: 'featured_slots_total',
    });
  });

  it('PUT PARCIAL: solo `featuredNewArrivalSlots: 0` con azar vigente 0 ⇒ rechazado (mira lo vigente)', async () => {
    const { svc } = settingsWith({ featured_random_slots: 0, featured_new_arrival_slots: 2 });
    expect((await rule(svc.update({ featuredNewArrivalSlots: 0 })))?.rule).toBe('featured_slots_total');
  });

  it('azar 20 + recién llegadas 4 = 24 > 20 ⇒ `featured_slots_total`', async () => {
    const { svc } = settingsWith({ featured_pool_size: 100 });
    expect((await rule(svc.update({ featuredRandomSlots: 20, featuredNewArrivalSlots: 4 })))?.rule).toBe(
      'featured_slots_total',
    );
  });

  it('pool < azar ⇒ `featured_pool_lt_random` (también si solo se baja el pool)', async () => {
    const { svc } = settingsWith({ featured_random_slots: 8 });
    expect((await rule(svc.update({ featuredPoolSize: 7 })))?.rule).toBe('featured_pool_lt_random');
  });

  it('combinación válida en los bordes (azar 0 + 1 recién llegada; pool = azar) ⇒ se escribe', async () => {
    const { svc, store } = settingsWith({});
    expect(await rule(svc.update({ featuredRandomSlots: 0, featuredNewArrivalSlots: 1 }))).toBeNull();
    expect(await rule(svc.update({ featuredPoolSize: 20, featuredRandomSlots: 20, featuredNewArrivalSlots: 0 }))).toBeNull();
    expect(store.get('featured_pool_size')).toBe(20);
  });

  it('un PUT que no toca los `featured_*` no paga la regla (solo el tope de créditos)', async () => {
    const { svc } = settingsWith({ featured_random_slots: 0, featured_new_arrival_slots: 0 });
    expect(await rule(svc.update({ gradedEstimateDailyCreditCap: 0 }))).toBeNull();
  });
});
