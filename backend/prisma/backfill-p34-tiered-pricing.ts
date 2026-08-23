/**
 * Backfill P-34 / M-38 — RESHAPE de las reglas de precio de shape LEGACY (plano / dos-ejes) al shape
 * TIERED canónico (`{ tierRules, finishRules }`), money-safe e IDEMPOTENTE.
 * =============================================================================================
 * POR QUÉ EXISTE (regresión detectada por el gate E2E): la decisión de dinero de P-34 —bajar la
 * COMPRA de Rare/Rare Holo del fallback 40% al **T2 = 25%**— quedó SILENCIOSAMENTE INERTE en BDs
 * existentes (incl. prod). Motivo: `ConfigSetting.buylist_price_rules` conserva el shape LEGACY PLANO
 * (`{"Common":…, "Uncommon":…, "Reverse Holo":…}`) que el seed sembró en el primer deploy; el seed hace
 * `upsert({ update: {} })` (no pisa lo existente) y NO había migración de datos del reshape a tiers.
 * El compat on-read (`toPriceRuleSet`) reproduce EXACTO el negocio viejo: Rare/Rare Holo no están en el
 * mapa plano ⇒ caen al fallback 40%, NUNCA al T2 25% que decidió el humano.
 *
 * QUÉ HACE — por cada `buylist_price_rules` y `sale_price_rules`:
 *   1. Si YA está en shape tiered (`tierRules`) ⇒ NO-OP (idempotente).
 *   2. Si está en shape LEGACY (plano o dos-ejes) y es IDÉNTICO al DEFAULT ORIGINAL sembrado (pristine,
 *      nunca editado a mano) ⇒ lo reemplaza por el shape TIERED CANÓNICO vigente (`SETTING_DEFAULTS`).
 *      Ese canónico es la decisión LOCKED del humano (P-34 T2=25% + DEV-tiers-1 T1=$1.50). Money-safe:
 *      escribe el seed aprobado, nunca deja una regla en 0 ni vacía.
 *   3. Si el shape LEGACY DIVERGE del pristine (el operador lo editó a mano en M2) ⇒ NO LO TOCA: la
 *      colapsación rareza→tier es AMBIGUA cuando hay valores hechos a mano (dinero). Lo deja intacto
 *      (comportamiento sin cambio = money-safe) y lo REPORTA como "ACCIÓN REQUERIDA — revisión humana".
 *   4. Garantiza que `pricing_tier_map` (clave nueva de v1.37) EXISTA: sin ella, aun un `tierRules` no
 *      resuelve (rareza sin tier ⇒ fallback). Si falta, la crea con el mapa canónico; si existe, la deja.
 *
 * REPORTE: imprime, por rareza, la regla de COMPRA/venta ANTES y DESPUÉS (derivada con el MISMO
 * `toPriceRuleSet` que usa producción) para auditar cada cambio de dinero.
 *
 * IDEMPOTENTE: una 2ª corrida ve `tierRules` ⇒ NO-OP. Money-safe: nunca escribe $0 ni regla vacía;
 * ante duda (divergencia) NO toca dinero y escala al humano.
 *
 * USO (runbook devops):  ts-node prisma/backfill-p34-tiered-pricing.ts
 * Requiere: DATABASE_URL + migraciones aplicadas (`prisma migrate deploy`). Correr DESPUÉS del deploy
 * del código v1.37+ y ANTES de anunciar que P-34 está vigente. Seguro correrlo varias veces.
 */
import { PrismaClient } from '@prisma/client';
import { SETTING_DEFAULTS, SettingKey } from '../src/modules/settings/settings.constants';
import { toPriceRuleSet, isTieredRuleSet, type BuylistRule, type SalesRule } from '../src/common/money';
import type { TierId } from '../src/common/pricing-tiers';

// ---------------------------------------------------------------------------------------------------
// DEFAULTS ORIGINALES ("pristine") que se sembraron en prod en su día. Ya NO viven en el código (los
// reemplazó el shape tiered), por eso se fijan aquí como CONSTANTES HISTÓRICAS. Un `buylist_price_rules`
// / `sale_price_rules` que coincida byte-a-byte (normalizado) con alguno de estos = NUNCA fue editado a
// mano ⇒ es seguro reemplazarlo por el canónico tiered. Fuente: git a8c40c4 (plano) y 421967f (dos-ejes).
// ---------------------------------------------------------------------------------------------------

/** buylist — shape PLANO original (el más viejo; lo que la mayoría de prod tiene). */
const PRISTINE_BUYLIST_FLAT = {
  Common: { mode: 'fixed', value: 50 },
  Uncommon: { mode: 'fixed', value: 50 },
  'Reverse Holo': { mode: 'fixed', value: 150 },
};
/** buylist — shape DOS-EJES intermedio (v1.29, BDs sembradas entre v1.29 y v1.37). */
const PRISTINE_BUYLIST_TWOAXIS = {
  rarityRules: { Common: { mode: 'fixed', value: 50 }, Uncommon: { mode: 'fixed', value: 50 } },
  finishRules: { reverse_holo: { mode: 'fixed', value: 150 } },
};
/** sale — shape PLANO original. */
const PRISTINE_SALES_FLAT = {
  Common: { mode: 'fixed', value: 500 },
  Uncommon: { mode: 'fixed', value: 1000 },
  Holo: { mode: 'fixed', value: 1000 },
  'Reverse Holo': { mode: 'fixed', value: 1000 },
};
/** sale — shape DOS-EJES intermedio (v1.29). */
const PRISTINE_SALES_TWOAXIS = {
  rarityRules: { Common: { mode: 'fixed', value: 500 }, Uncommon: { mode: 'fixed', value: 1000 } },
  finishRules: { holofoil: { mode: 'fixed', value: 1000 }, reverse_holo: { mode: 'fixed', value: 1000 } },
};

/** JSON canónico con claves ordenadas (comparación deep order-independent de objetos de reglas). */
function canonicalJson(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (x === null || typeof x !== 'object') return x;
    if (Array.isArray(x)) return x.map(sort);
    const o = x as Record<string, unknown>;
    return Object.keys(o)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sort(o[k]);
        return acc;
      }, {});
  };
  return JSON.stringify(sort(v));
}

function deepEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

export type ReshapeAction = 'already-tiered' | 'reshape-pristine' | 'skip-diverged' | 'missing';

export interface ReshapePlan {
  action: ReshapeAction;
  /** Shape tiered canónico a escribir (solo cuando action = 'reshape-pristine'). */
  canonicalTiered?: unknown;
  /** Valor legacy hallado (para el reporte / la revisión humana). */
  found?: unknown;
  matchedPristine?: 'flat' | 'two-axis' | null;
}

/**
 * DECISIÓN PURA (sin DB) de qué hacer con un valor almacenado. Testeable en unit tests.
 *  - null/undefined              → 'missing' (el seed la crea; el backfill no la inventa)
 *  - ya tiered (`tierRules`)     → 'already-tiered' (idempotente)
 *  - legacy == algún pristine    → 'reshape-pristine' (seguro: nunca se editó a mano)
 *  - legacy diverge del pristine → 'skip-diverged' (ambiguo, dinero: no tocar, escalar al humano)
 */
export function planSettingReshape(
  raw: unknown,
  pristines: { flat: unknown; twoAxis: unknown },
  canonicalTiered: unknown,
): ReshapePlan {
  if (raw === null || raw === undefined) return { action: 'missing' };
  if (isTieredRuleSet(raw)) return { action: 'already-tiered', found: raw };
  if (deepEqual(raw, pristines.flat)) {
    return { action: 'reshape-pristine', canonicalTiered, found: raw, matchedPristine: 'flat' };
  }
  if (deepEqual(raw, pristines.twoAxis)) {
    return { action: 'reshape-pristine', canonicalTiered, found: raw, matchedPristine: 'two-axis' };
  }
  return { action: 'skip-diverged', found: raw, matchedPristine: null };
}

/** Rareza representativa por tier para el reporte de auditoría (una por peldaño + acabados). */
const REPORT_RARITIES = [
  'Common',
  'Uncommon',
  'Rare',
  'Rare Holo',
  'Double Rare',
  'Ultra Rare',
  'Secret Rare',
];

/** Formatea una regla efectiva `{ mode, value }` para el log. */
function fmtRule(r: { mode: string; value: number } | undefined, fallbackPct: number): string {
  if (r == null) return `fallback ${fallbackPct}% (pct)`;
  return r.mode === 'pct' ? `${r.value}% (pct)` : `$${(r.value / 100).toFixed(2)} (fixed)`;
}

/**
 * Reporte ANTES/DESPUÉS por rareza, derivado con el MISMO `toPriceRuleSet` de producción (base rarity
 * rule para el acabado `normal`). Deja ver cada cambio de dinero (p. ej. `Rare: 40% → 25%`).
 */
function diffReport(
  oldRaw: unknown,
  newRaw: unknown,
  fallbackPct: number,
  tierMap: Record<string, TierId>,
): string[] {
  const before = toPriceRuleSet<BuylistRule | SalesRule>(oldRaw, fallbackPct, tierMap);
  const after = toPriceRuleSet<BuylistRule | SalesRule>(newRaw, fallbackPct, tierMap);
  const lines: string[] = [];
  for (const rarity of REPORT_RARITIES) {
    const b = fmtRule(before.rarityRules[rarity], before.fallbackPct);
    const a = fmtRule(after.rarityRules[rarity], after.fallbackPct);
    const changed = b !== a ? '  ← CAMBIA' : '';
    lines.push(`    ${rarity.padEnd(14)} ${b.padEnd(22)} → ${a}${changed}`);
  }
  return lines;
}

export interface SettingReport {
  key: string;
  plan: ReshapeAction;
  matchedPristine?: 'flat' | 'two-axis' | null;
  diff?: string[];
}

export interface BackfillReport {
  settings: SettingReport[];
  tierMap: 'created' | 'present';
  needsHumanReview: string[];
}

async function readRaw(prisma: PrismaClient, key: string): Promise<unknown> {
  const row = await prisma.configSetting.findUnique({ where: { key } });
  return row ? (row.valueJson as unknown) : null;
}

async function getFallbackPct(prisma: PrismaClient, key: string, def: number): Promise<number> {
  const raw = await readRaw(prisma, key);
  return typeof raw === 'number' ? raw : def;
}

export async function runP34Backfill(prisma: PrismaClient): Promise<BackfillReport> {
  const report: BackfillReport = { settings: [], tierMap: 'present', needsHumanReview: [] };

  // 0. `pricing_tier_map` DEBE existir para que un `tierRules` resuelva (rareza→tier). Es clave NUEVA
  //    (v1.37): BDs viejas no la tienen. Si falta, la crea con el mapa canónico; si existe, la respeta.
  const tierMapRaw = await readRaw(prisma, SettingKey.PRICING_TIER_MAP);
  if (tierMapRaw === null) {
    await prisma.configSetting.create({
      data: {
        key: SettingKey.PRICING_TIER_MAP,
        valueJson: SETTING_DEFAULTS[SettingKey.PRICING_TIER_MAP] as object,
        updatedBy: 'backfill-p34',
      },
    });
    report.tierMap = 'created';
  }
  const effectiveTierMap =
    (report.tierMap === 'created'
      ? (SETTING_DEFAULTS[SettingKey.PRICING_TIER_MAP] as Record<string, TierId>)
      : (tierMapRaw as Record<string, TierId>)) ?? {};

  // 1. Las dos claves de reglas a reshapear.
  const targets: {
    key: string;
    pristines: { flat: unknown; twoAxis: unknown };
    canonical: unknown;
    fallbackKey: string;
    fallbackDefault: number;
  }[] = [
    {
      key: SettingKey.BUYLIST_PRICE_RULES,
      pristines: { flat: PRISTINE_BUYLIST_FLAT, twoAxis: PRISTINE_BUYLIST_TWOAXIS },
      canonical: SETTING_DEFAULTS[SettingKey.BUYLIST_PRICE_RULES],
      fallbackKey: SettingKey.BUYLIST_PRICE_FALLBACK_PCT,
      fallbackDefault: SETTING_DEFAULTS[SettingKey.BUYLIST_PRICE_FALLBACK_PCT] as number,
    },
    {
      key: SettingKey.SALES_PRICE_RULES,
      pristines: { flat: PRISTINE_SALES_FLAT, twoAxis: PRISTINE_SALES_TWOAXIS },
      canonical: SETTING_DEFAULTS[SettingKey.SALES_PRICE_RULES],
      fallbackKey: SettingKey.SALES_PRICE_FALLBACK_PCT,
      fallbackDefault: SETTING_DEFAULTS[SettingKey.SALES_PRICE_FALLBACK_PCT] as number,
    },
  ];

  for (const t of targets) {
    const raw = await readRaw(prisma, t.key);
    const plan = planSettingReshape(raw, t.pristines, t.canonical);
    const fallbackPct = await getFallbackPct(prisma, t.fallbackKey, t.fallbackDefault);
    const entry: SettingReport = { key: t.key, plan: plan.action, matchedPristine: plan.matchedPristine };

    if (plan.action === 'reshape-pristine') {
      entry.diff = diffReport(raw, t.canonical, fallbackPct, effectiveTierMap);
      await prisma.configSetting.update({
        where: { key: t.key },
        data: { valueJson: t.canonical as object, updatedBy: 'backfill-p34' },
      });
    } else if (plan.action === 'skip-diverged') {
      report.needsHumanReview.push(t.key);
    }
    report.settings.push(entry);
  }

  return report;
}

function printReport(report: BackfillReport): void {
  const log = (s = '') => console.log(s); // eslint-disable-line no-console
  log('════════════════════════════════════════════════════════════════════');
  log('  Backfill P-34 / M-38 — reshape legacy → tiered (money-safe)');
  log('════════════════════════════════════════════════════════════════════');
  log(`  pricing_tier_map: ${report.tierMap === 'created' ? 'CREADA (faltaba)' : 'ya presente'}`);
  for (const s of report.settings) {
    log('');
    log(`  ${s.key}: ${s.plan}${s.matchedPristine ? ` (pristine ${s.matchedPristine})` : ''}`);
    if (s.plan === 'already-tiered') log('    → ya tiered, sin cambios (idempotente).');
    if (s.plan === 'missing') log('    → clave ausente; el seed la crea, el backfill no la inventa.');
    if (s.plan === 'skip-diverged') {
      log('    → DIVERGE del default original (editado a mano). NO se toca (money-safe).');
      log('    → ACCIÓN REQUERIDA: revisión humana del reshape rareza→tier para esta tabla.');
    }
    if (s.diff) {
      log('    Regla efectiva por rareza (acabado normal)   ANTES → DESPUÉS:');
      s.diff.forEach((l) => log(l));
    }
  }
  if (report.needsHumanReview.length > 0) {
    log('');
    log('  ⚠  ACCIÓN REQUERIDA — estas tablas divergen del default y NO se migraron:');
    report.needsHumanReview.forEach((k) => log(`      - ${k}`));
    log('     Escalar al arquitecto/humano: definir el reshape rareza→tier a mano (dinero).');
  }
  log('════════════════════════════════════════════════════════════════════');
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const report = await runP34Backfill(prisma);
    printReport(report);
  } finally {
    await prisma.$disconnect();
  }
}

// Guard: solo corre como CLI (no al importarse desde un unit test).
if (require.main === module) {
  main().catch((e) => {
    console.error('Backfill P-34 FALLÓ:', e); // eslint-disable-line no-console
    process.exit(1);
  });
}
