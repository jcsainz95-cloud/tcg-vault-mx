/**
 * sdx-d2g.units.spec.ts — 💰🔒 unitarias y censos de D2g (API_CONTRACT §19.29.5–.9, §19.30, §19.31.8). Propiedad: backend.
 *
 *  - PS-165: `OWNER_ONLY_SETTING_KEYS` ⊇ las claves de §19.29.8 + `shipping_label_purchase` (leídas del CONTRATO) y todo dial
 *    `spend_alert*` del código está dentro (un dial nuevo de §Z fuera de la constante ⇒ rojo); `SPEND_MAIL_LOCK_KEY` y
 *    `ORPHAN_FUSE_LOCK_KEY` en el censo de claves; las de D2g en su rango 65_310_710…719.
 *  - PS-157 / C-GAS-1: escritores de `SpendAlert` SOLO en `spend-alerts.service.ts`; ningún borrado; `SpendOwnerWatch` solo
 *    `spend-watch.service.ts`.
 *  - Frontera de día MX (PS-154): 23:30 MX es ESE día; `?from/to` fuera de forma ⇒ 400.
 *  - Plantillas `AVG-1/2/3`: cada tipo, en ES y EN, con título y frase; SDX-I-8 (enlaces solo `admin/…`, sin `?`/`/api/`/token).
 *  - AG-22: gravedad por acto (§19.30.2 (3)); `keys` en camelCase (S-GAS-9).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Role, SpendAlertKind } from '@prisma/client';
import { stripComments } from './helpers/strip-comments';
import { OWNER_ONLY_SETTING_KEYS, ownerOnlyDtoKey, SETTING_DTO_MAP, SettingKey, SETTING_DEFAULTS } from '../src/modules/settings/settings.constants';
import { validateSpendAlertsDisabled } from '../src/modules/settings/shipping-dials';
import {
  SPEND_DIGEST_LOCK_KEY,
  SPEND_MAIL_HOURLY_MAX,
  SPEND_MAIL_LOCK_KEY,
  SPEND_MAIL_PER_SUBJECT_HOURLY_MAX,
  SPEND_WATCH_LOCK_KEY,
} from '../src/modules/spend-alerts/spend-alerts.constants';
import { ORPHAN_FUSE_LOCK_KEY } from '../src/modules/shipments/label-verify.constants';
import { isYmd, mxDayStart, mxDaysRange, nextYmd, parseMxDayFilter, yesterdayMx } from '../src/modules/spend-alerts/mx-day';
import { dayMx, SPEND_ALERT_CODE_OF } from '../src/modules/spend-alerts/spend-alerts.service';
import { spendAlertBatchMail, spendAlertImmediateMail, spendDigestMail } from '../src/modules/spend-alerts/spend-alert.mail';
import { SpendAlertMailView, spendAlertSentence, spendAlertTitle } from '../src/modules/spend-alerts/spend-alert-text';
import { staffControlSeverity } from '../src/modules/spend-alerts/staff-control.service';
import { hourStartOf } from '../src/modules/spend-alerts/spend-mail.service';

const SRC = join(__dirname, '..', 'src');
const CONTRACT = readFileSync(join(__dirname, '..', '..', 'docs', 'API_CONTRACT.md'), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}
const FILES = walk(SRC).map((p) => ({ path: relative(join(__dirname, '..'), p), code: stripComments(readFileSync(p, 'utf8')) }));

// ================================================================ PS-165 — los diales del dueño

/** Las claves de la tabla de §19.29.8 (filas `| \`clave\` · \`dto\` |` y la de `skydropx_low_balance_cents`). */
function contractOwnerDials(): string[] {
  const start = CONTRACT.indexOf('**M4-SHIP.19.29.8 — Diales');
  const end = CONTRACT.indexOf('**M4-SHIP.19.29.9', start);
  const block = CONTRACT.slice(start, end);
  return [...block.matchAll(/^\| `([a-z0-9_]+)`/gm)].map((m) => m[1]);
}

/** Problemas del censo: claves de §Z (`spend_alert*` o las del contrato) fuera de la constante. */
export function ownerOnlyProblems(constant: readonly string[], codeKeys: readonly string[], contractKeys: readonly string[]): string[] {
  const set = new Set(constant);
  const zKeys = new Set([...contractKeys, 'shipping_label_purchase', ...codeKeys.filter((k) => /^spend_alert/.test(k))]);
  return [...zKeys].filter((k) => !set.has(k)).sort();
}

describe('PS-165 — `OWNER_ONLY_SETTING_KEYS` ⊇ los diales de §Z', () => {
  it('el contrato da las 11 claves de §19.29.8 (el parser ve la tabla)', () => {
    const keys = contractOwnerDials();
    expect(keys).toHaveLength(11);
    expect(keys).toEqual(expect.arrayContaining(['operator_label_cap_24h_cents', 'skydropx_low_balance_cents', 'spend_alerts_disabled']));
  });
  it('las 11 + `shipping_label_purchase` = 12 en la constante; y todo `spend_alert*` del código está dentro', () => {
    expect(OWNER_ONLY_SETTING_KEYS).toHaveLength(12);
    expect(ownerOnlyProblems(OWNER_ONLY_SETTING_KEYS, Object.values(SettingKey), contractOwnerDials())).toEqual([]);
  });
  it('CANARIO: un dial `spend_alert_nuevo` fuera de la constante ⇒ rojo; quitar `shipping_label_purchase` ⇒ rojo', () => {
    expect(ownerOnlyProblems(OWNER_ONLY_SETTING_KEYS, [...Object.values(SettingKey), 'spend_alert_nuevo'], contractOwnerDials())).toEqual(['spend_alert_nuevo']);
    expect(ownerOnlyProblems(OWNER_ONLY_SETTING_KEYS.filter((k) => k !== 'shipping_label_purchase'), Object.values(SettingKey), contractOwnerDials())).toEqual([
      'shipping_label_purchase',
    ]);
  });
  it('`ownerOnlyDtoKey` usa los nombres del DTO (camelCase) — la lista de `403 {keys}` y de AG-22 `facts.keys` (S-GAS-9)', () => {
    const dto = Object.keys(SETTING_DTO_MAP).filter(ownerOnlyDtoKey).sort();
    expect(dto).toEqual(
      [
        'operatorLabelCap24hCents',
        'shippingLabelPurchase',
        'shippingLabelReissueMaxPerShipment',
        'skydropxLowBalanceCents',
        'spendAlertCancelRefundDays',
        'spendAlertChargeDriftImmediateCents',
        'spendAlertExtraChargeImmediateCents',
        'spendAlertLabelCapWarnPct',
        'spendAlertLabelNotShippedDays',
        'spendAlertPersonCancelCount24h',
        'spendAlertShipmentCancelCount',
        'spendAlertsDisabled',
      ].sort(),
    );
    expect(ownerOnlyDtoKey('shippingTrackingPollMinutes')).toBe(false);
    expect(ownerOnlyDtoKey('__proto__')).toBe(false);
    expect(ownerOnlyDtoKey('operator_label_cap_24h_cents')).toBe(false); // la clave de BD no es un nombre del DTO
  });
  it('PS-155 (instalación limpia, código): seeds de §19.29.8 y `spendAlertsDisabled` rechaza AG-21/AG-22 (`422`)', () => {
    expect(SETTING_DEFAULTS[SettingKey.OPERATOR_LABEL_CAP_24H_CENTS]).toBe(250000);
    expect(SETTING_DEFAULTS[SettingKey.SPEND_ALERTS_DISABLED]).toEqual([]);
    expect(SETTING_DEFAULTS[SettingKey.SKYDROPX_LOW_BALANCE_CENTS]).toBe(100000);
    expect(validateSpendAlertsDisabled(['AG-21'])).not.toBeNull();
    expect(validateSpendAlertsDisabled(['AG-22'])).not.toBeNull();
    expect(validateSpendAlertsDisabled(['AG-1', 'AG-13'])).toBeNull();
  });
});

// ================================================================ censo de claves de candado (PS-165, §19.32.9)

describe('PS-165 — claves de candado de D2g', () => {
  it('SPEND_MAIL_LOCK_KEY = 65_310_702 y ORPHAN_FUSE_LOCK_KEY = 65_310_703; las propias de D2g en 65_310_710…719', () => {
    expect(SPEND_MAIL_LOCK_KEY).toBe(65_310_702);
    expect(ORPHAN_FUSE_LOCK_KEY).toBe(65_310_703);
    for (const k of [SPEND_WATCH_LOCK_KEY, SPEND_DIGEST_LOCK_KEY]) expect(k >= 65_310_710 && k <= 65_310_719).toBe(true);
  });
  it('en `spend-alerts/` todo `pg_(try_)advisory_xact_lock` usa una constante `*_LOCK_KEY` de `spend-alerts.constants.ts`', () => {
    const calls = FILES.filter((f) => f.path.includes('modules/spend-alerts/')).flatMap((f) =>
      [...f.code.matchAll(/pg_(?:try_)?advisory_xact_lock\(([^)]*)\)/g)].map((m) => ({ path: f.path, arg: m[1].trim() })),
    );
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const c of calls) expect(c.arg).toMatch(/^\$\{(SPEND_MAIL_LOCK_KEY|SPEND_WATCH_LOCK_KEY|SPEND_DIGEST_LOCK_KEY)\}$/);
    expect(calls.filter((c) => c.arg.includes('SPEND_MAIL_LOCK_KEY')).map((c) => c.path)).toEqual([
      'src/modules/spend-alerts/spend-mail.service.ts',
      'src/modules/spend-alerts/spend-mail.service.ts',
    ]);
  });
  it('los valores 65_310_702…719 no los usa ningún otro módulo', () => {
    const owners = FILES.flatMap((f) => [...f.code.matchAll(/export const ([A-Z0-9_]+_LOCK_KEY)\s*=\s*(65_?310_?7\d\d)\s*;/g)].map((m) => ({ path: f.path, name: m[1], v: Number(m[2].replace(/_/g, '')) })));
    const d2g = owners.filter((o) => o.v === 65310702 || (o.v >= 65310710 && o.v <= 65310719));
    expect(d2g.every((o) => o.path === 'src/modules/spend-alerts/spend-alerts.constants.ts')).toBe(true);
    expect(new Set(owners.map((o) => o.v)).size).toBe(owners.length);
  });
});

// ================================================================ PS-157 / C-GAS-1 — escritores

/** Escritores de una tabla en código (Prisma o SQL crudo). */
export function writersOf(files: { path: string; code: string }[], delegate: string, table: string): string[] {
  const prisma = new RegExp(`\\.${delegate}\\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\\(`);
  const raw = new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+"${table}"`, 'i');
  return files.filter((f) => prisma.test(f.code) || raw.test(f.code)).map((f) => f.path).sort();
}

describe('PS-157 / C-GAS-1 — un solo escritor de `SpendAlert`; `SpendOwnerWatch` solo `spend-watch`', () => {
  it('`SpendAlert`: solo `spend-alerts.service.ts`', () => {
    expect(writersOf(FILES, 'spendAlert', 'SpendAlert')).toEqual(['src/modules/spend-alerts/spend-alerts.service.ts']);
  });
  it('ningún borrado de avisos en `src/`', () => {
    expect(FILES.filter((f) => /\.spendAlert\.(delete|deleteMany)\(|DELETE\s+FROM\s+"SpendAlert"/i.test(f.code)).map((f) => f.path)).toEqual([]);
  });
  it('`SpendOwnerWatch`: solo `spend-watch.service.ts` (paso (0))', () => {
    expect(writersOf(FILES, 'spendOwnerWatch', 'SpendOwnerWatch')).toEqual(['src/modules/spend-alerts/spend-watch.service.ts']);
  });
  it('CANARIO: un aviso escrito desde `shipments/` ⇒ rojo', () => {
    const fake = [...FILES, { path: 'src/modules/shipments/x.ts', code: 'await tx.spendAlert.create({ data: {} })' }];
    expect(writersOf(fake, 'spendAlert', 'SpendAlert')).toContain('src/modules/shipments/x.ts');
  });
});

// ================================================================ frontera de día MX

describe('PS-154 — la frontera de día MX (un cuerpo para panel, resumen y correo)', () => {
  it('00:00 MX = 06:00Z; 23:30 MX del 14 (05:30Z del 15) es del 14; ayer a las 08:00 MX', () => {
    expect(mxDayStart('2026-10-05').toISOString()).toBe('2026-10-05T06:00:00.000Z');
    expect(dayMx(new Date('2032-06-15T05:30:00Z'))).toBe('2032-06-14');
    const r = mxDaysRange('2032-06-14', '2032-06-14');
    expect([r.gte.toISOString(), r.lt.toISOString()]).toEqual(['2032-06-14T06:00:00.000Z', '2032-06-15T06:00:00.000Z']);
    expect(yesterdayMx(new Date('2032-06-15T14:00:00Z'))).toBe('2032-06-14');
    expect(nextYmd('2026-12-31')).toBe('2027-01-01');
  });
  it('MUTACIÓN guardada: frontera en UTC ⇒ el 23:30 MX caería en el día siguiente', () => {
    const utcDay = (d: Date) => d.toISOString().slice(0, 10);
    expect(utcDay(new Date('2032-06-15T05:30:00Z'))).not.toBe(dayMx(new Date('2032-06-15T05:30:00Z')));
  });
  it('`?from/to`: vacío ⇒ sin cota; fuera de forma o imposible ⇒ 400 {field}; from > to ⇒ 400', () => {
    expect(parseMxDayFilter({ from: ' ', to: undefined })).toEqual({});
    for (const [raw, field] of [[{ from: '2026-02-30' }, 'from'], [{ to: 'ayer' }, 'to'], [{ from: '2026-10-05', to: '2026-10-04' }, 'from'], [{ from: 5 }, 'from']] as const) {
      try {
        parseMxDayFilter(raw as never);
        throw new Error('no lanzó');
      } catch (e) {
        expect((e as { getResponse(): { details: unknown } }).getResponse().details).toMatchObject({ field });
      }
    }
    expect(isYmd('2028-02-29')).toBe(true);
    expect(isYmd('2027-02-29')).toBe(false);
  });
  it('la hora de reloj del cupo (`hourStartOf`)', () => {
    expect(hourStartOf(new Date('2031-03-10T16:59:59.999Z')).toISOString()).toBe('2031-03-10T16:00:00.000Z');
  });
});

// ================================================================ plantillas

describe('AVG-1/2/3 — cada tipo tiene título y frase, en ES y EN; SDX-I-8', () => {
  const saved = process.env.APP_PUBLIC_URL;
  beforeAll(() => {
    process.env.APP_PUBLIC_URL = 'https://panel.test';
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = saved;
  });
  const view = (kind: SpendAlertKind, facts: SpendAlertMailView['facts'] = {}): SpendAlertMailView => ({
    id: '11111111-2222-4333-8444-555555555555',
    kind,
    severity: 'immediate',
    facts,
    amountCents: 15000,
    subjectName: 'Luis',
    orderNumber: 'TCG-000123',
    folio: 'ENV-000045',
    firstOccurredAt: new Date('2031-03-10T16:05:00Z'),
  });
  const recipient = (locale: 'es' | 'en') => ({ email: 'duena@x.mx', name: 'Dueña', nameSource: 'user' as const, locale });
  const TRIGGERED: SpendAlertKind[] = Object.keys(SPEND_ALERT_CODE_OF).filter((k) => {
    const n = Number(SPEND_ALERT_CODE_OF[k as SpendAlertKind].slice(3));
    return n <= 13 || n >= 21;
  }) as SpendAlertKind[];

  it.each(TRIGGERED)('%s: título y frase no vacíos en ES y EN, sin «undefined», `{ref}` sin «de el»', (kind) => {
    // AG-22 `target` lleva `role` (§19.30.2 (3)) como subtipo del objeto persona de G2 (§19.33.7; ver BACKEND_NOTES §66).
    const target = { userId: 'u', name: 'Ana', role: 'vault_operator' };
    for (const l of ['es', 'en'] as const) {
      const v = view(kind, { cause: 'changed', act: 'staff_created', target, changedKeys: ['line1'] });
      expect(spendAlertTitle(v, l).length).toBeGreaterThan(3);
      const s = spendAlertSentence(v, l);
      expect(s.length).toBeGreaterThan(10);
      expect(s).not.toMatch(/undefined|NaN|\[object/);
      expect(s).not.toMatch(/\bde el\b/);
    }
  });

  it('SDX-I-8: AVG-1 (con «Frenar»), AVG-2 y AVG-3 — todo enlace es una PÁGINA `admin/…`, sin `/api/`, sin `?`, sin token', () => {
    const mails = [
      spendAlertImmediateMail(view('label_cap_blocked', { priceCents: 1, usedCents: 2, capCents: 3 }), recipient('es')),
      spendAlertImmediateMail(view('owner_account_changed', { cause: 'no_owner' }), recipient('en'), { previousOwner: true }),
      spendAlertBatchMail([view('label_charged_unexplained', { cause: 'orphan_fuse' })], new Date('2031-03-10T16:00:00Z'), recipient('es')),
      spendDigestMail(
        '2031-03-09',
        { from: '2031-03-09', to: '2031-03-09', byKind: [{ code: 'AG-3', immediate: 1, digest: 0, amountCents: 15000 }], mutedCount: 2, labelSpendByPerson: [], costlyChoices: { count: 0, overRecommendedCents: 0, byPerson: [] } },
        [view('label_cap_blocked')],
        recipient('es'),
        () => 'x',
      ),
    ];
    for (const m of mails) {
      const urls = [...[...m.html.matchAll(/href="([^"]*)"/g)].map((x) => x[1]), ...[...m.text.matchAll(/https?:\/\/\S+/g)].map((x) => x[0])];
      expect(urls.length).toBeGreaterThan(0);
      for (const u of urls) {
        expect(u).toMatch(/^https:\/\/panel\.test\/(es|en)\/admin\//);
        expect(u).not.toMatch(/\/api\/|[?#]|token/i);
      }
    }
    // «Frenar» (AG-3 es de los 🔴 de guías) lleva a la página de ajustes, en prosa.
    expect(mails[0].text).toContain('https://panel.test/es/admin/m10');
    expect(mails[0].subject).toBe('Guía negada por el tope: pedido TCG-000123');
    expect(mails[1].subject).toBe('There is no owner account');
    expect(mails[3].text).toMatch(/Además hubo 2 avisos apagados/);
  });

  it('AG-1 dice QUÉ campos se corrigieron, ⛔ nunca valores (solo recibe `changedKeys`)', () => {
    const s = spendAlertSentence(view('label_after_address_fix', { changedKeys: ['line1', 'postalCode'], carrierName: 'DHL', chargedCents: 15000 }), 'es');
    expect(s).toBe('Luis corrigió la dirección del pedido TCG-000123 (calle y número y CP) y compró su guía: DHL, MX$150.00.');
  });
});

// ================================================================ AG-22

describe('AG-22 — gravedad por acto (§19.30.2 (3))', () => {
  const sa = { userId: 'u', name: 'A', role: Role.super_admin };
  const op = { userId: 'u', name: 'A', role: Role.vault_operator };
  it.each([
    ['staff_created', sa, 'immediate'],
    ['staff_created', op, 'digest'],
    ['staff_password_reset', sa, 'immediate'],
    ['staff_password_reset', op, 'digest'],
    ['staff_status_changed', sa, 'digest'],
    ['staff_deleted', sa, 'digest'],
    ['owner_account_denied', sa, 'immediate'],
    ['owner_setting_denied', null, 'immediate'],
  ] as const)('%s ⇒ %s', (act, target, sev) => {
    expect(staffControlSeverity(act, target)).toBe(sev);
  });
  it('el cupo es el del contrato (5 global, 2 por persona)', () => {
    expect([SPEND_MAIL_HOURLY_MAX, SPEND_MAIL_PER_SUBJECT_HOURLY_MAX]).toEqual([5, 2]);
  });
});
