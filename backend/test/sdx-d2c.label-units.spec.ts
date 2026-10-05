/**
 * sdx-d2c.label-units.spec.ts — 💰🔒 unitarias y censos de D2c (API_CONTRACT §M4-SHIP.19.7 con §19.26 … §19.30). Propiedad:
 * backend. La conducta contra Postgres vive en `test/integration/sdx-d2c-label.e2e-spec.ts`.
 *
 *  - PS-145 / C-20: `isOwnerAccount` (la marca + súper-admin + correo + activa + no borrada).
 *  - PS-139 / C-22: `spendOfPaidLabel` / `spendOfAttempt` (reembolso desconocido ⇒ cuenta ENTERA).
 *  - §19.20.2 / §19.27.9 / §19.28.6: `labelAlertOf` (precedencia, `canRelease`), `toLabelPendingDTO` (`verifyingUntil`).
 *  - S-GAS-5: `mergeFacts` (triggers unidos sin repetir; tres llaves se reescriben; el resto queda).
 *  - §19.7: `parseLabelBody` (`400 VALIDATION_ERROR {field}`; los campos de costo del cuerpo no existen para el servicio).
 *  - PS-131 (c): relaciones de constantes de §19.28.2 / §19.28.8.
 *  - PS-132 (b) / C-11 (b): censo de claves de `pg_(try_)?advisory_xact_lock`.
 *  - PS-117 / C-2: `.purchase(` UNA vez en `shipments/` (el verbo `label`), `.protect(` cero en `backend/src`.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { Role, ShipmentRequest, UserStatus } from '@prisma/client';
import { isOwnerAccount, OwnerCandidate } from '../src/modules/spend-alerts/owner';
import { spendOfAttempt, spendOfPaidLabel } from '../src/modules/shipments/label-spend';
import { labelAlertOf, toLabelPendingDTO } from '../src/modules/shipments/label-view';
import { mergeFacts } from '../src/modules/spend-alerts/spend-alerts.service';
import { parseLabelBody } from '../src/modules/shipments/label-purchase.service';
import {
  DEFAULT_LABEL_VERIFY_CONFIG,
  PURCHASE_MAX_LIFE_MS,
  PURCHASE_SEND_DEADLINE_MS,
  T_INFLIGHT_BLOCK_MS,
  T_UNKNOWN_MS,
  inflightBlockOf,
} from '../src/modules/shipments/label-verify.constants';
import { SKYDROPX_PURCHASE_TIMEOUT_MS } from '../src/modules/shipping-provider/http/skydropx-client';
import { BusinessException } from '../src/common/business.exception';

const SRC = join(__dirname, '..', 'src');
const MIN = 60_000;

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(join(__dirname, '..'), p).split(sep).join('/');
/** Código sin comentarios de línea ni de bloque (los censos miden código, no prosa). */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// ================================================================ PS-145 — el dueño

describe('PS-145 / C-20 — isOwnerAccount', () => {
  const base: OwnerCandidate = { isOwner: true, role: Role.super_admin, email: 'd@x.mx', status: UserStatus.active, deletedAt: null };
  it.each<[string, Partial<OwnerCandidate> | null, boolean]>([
    ['marcada + súper-admin + correo + activa ⇒ sí', {}, true],
    ['súper-admin con correo activa SIN marca ⇒ no', { isOwner: false }, false],
    ['marcada bloqueada ⇒ no', { status: UserStatus.blocked }, false],
    ['marcada borrada ⇒ no', { deletedAt: new Date() }, false],
    ['marcada sin correo ⇒ no', { email: null }, false],
    ['marcada con correo vacío ⇒ no', { email: '   ' }, false],
    ['operador marcado ⇒ no', { role: Role.vault_operator }, false],
    ['cliente marcado ⇒ no', { role: Role.customer }, false],
    ['un rol fuera del enum ⇒ no', { role: 'owner' as Role }, false],
    ['null ⇒ no', null, false],
  ])('%s', (_n, over, expected) => {
    expect(isOwnerAccount(over === null ? null : { ...base, ...over })).toBe(expected);
  });
});

// ================================================================ PS-139 — el gasto

describe('PS-139 / C-22 — el gasto de una guía y de un intento', () => {
  it('guía viva ⇒ chargedCents; cancelada con 500 sin devolver ⇒ 500; cancelada con reembolso DESCONOCIDO ⇒ chargedCents entero (C-22)', () => {
    expect(spendOfPaidLabel({ cancelledAt: null, unrefundedCents: null, chargedCents: 7625 })).toBe(7625);
    expect(spendOfPaidLabel({ cancelledAt: new Date(), unrefundedCents: 500, chargedCents: 7625 })).toBe(500);
    expect(spendOfPaidLabel({ cancelledAt: new Date(), unrefundedCents: 0, chargedCents: 7625 })).toBe(0);
    expect(spendOfPaidLabel({ cancelledAt: new Date(), unrefundedCents: null, chargedCents: 7625 })).toBe(7625);
  });
  it('intento sin guía: pending/released_unverified ⇒ esperado; not_charged ⇒ 0; con guías ⇒ la suma de sus guías (manda lo cobrado)', () => {
    expect(spendOfAttempt({ outcome: 'pending', expectedChargeCents: 100, paidLabels: [] })).toBe(100);
    expect(spendOfAttempt({ outcome: 'released_unverified', expectedChargeCents: 100, paidLabels: [] })).toBe(100);
    expect(spendOfAttempt({ outcome: 'not_charged', expectedChargeCents: 100, paidLabels: [] })).toBe(0);
    expect(spendOfAttempt({ outcome: 'labeled', expectedChargeCents: 100, paidLabels: [{ cancelledAt: null, unrefundedCents: null, chargedCents: 130 }] })).toBe(130);
    expect(
      spendOfAttempt({
        outcome: 'pending',
        expectedChargeCents: 100,
        paidLabels: [
          { cancelledAt: null, unrefundedCents: null, chargedCents: 130 },
          { cancelledAt: new Date(), unrefundedCents: null, chargedCents: 70 },
        ],
      }),
    ).toBe(200);
  });
});

// ================================================================ §19.20.2 — alertas y «en proceso»

describe('§19.20.2 — labelAlertOf (precedencia) y toLabelPendingDTO', () => {
  const now = new Date('2026-10-04T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const r = (over: Partial<ShipmentRequest>): ShipmentRequest =>
    ({
      status: 'picking',
      labelSource: null,
      providerShipmentId: null,
      providerCanceledAt: null,
      providerCancelConfirmedAt: null,
      labelProcessingSince: null,
      trackingNumber: null,
      carrierStatusAt: null,
      labelPurchasedAt: null,
      rateChosenAt: null,
      rateChosenByUserId: null,
      chosenRateJson: null,
      ...over,
    }) as ShipmentRequest;
  const opts = { tUnknownMs: T_UNKNOWN_MS };

  it('sin nada ⇒ null', () => expect(labelAlertOf(r({}), now, Role.super_admin, opts)).toBeNull());
  it('guía viva sobre `cancelado` gana a todo (incluida la huérfana)', () => {
    const a = labelAlertOf(r({ status: 'cancelado', labelSource: 'skydropx', providerShipmentId: 'x', labelProcessingSince: ago(20 * MIN) }), now, Role.super_admin, { ...opts, orphanSince: ago(MIN) });
    expect(a?.kind).toBe('label_live_on_cancelled');
  });
  it('`label_orphan` va justo después (§19.28.6): gana a `label_unknown`', () => {
    expect(labelAlertOf(r({ labelProcessingSince: ago(20 * MIN) }), now, Role.super_admin, { ...opts, orphanSince: ago(MIN) })?.kind).toBe('label_orphan');
  });
  it('cancelación sin confirmar a T_CANCEL (2 min) ⇒ `label_cancel_failed`; antes ⇒ nada', () => {
    expect(labelAlertOf(r({ providerShipmentId: 'x', providerCanceledAt: ago(2 * MIN) }), now, null, opts)?.kind).toBe('label_cancel_failed');
    expect(labelAlertOf(r({ providerShipmentId: 'x', providerCanceledAt: ago(2 * MIN - 1) }), now, null, opts)).toBeNull();
  });
  it('en vuelo sin id a T_UNKNOWN ⇒ `label_unknown` con `canRelease` SOLO para súper-admin y `reason` de la verificación', () => {
    const row = r({ labelProcessingSince: ago(T_UNKNOWN_MS) });
    expect(labelAlertOf(row, now, Role.super_admin, { ...opts, uncertainReason: 'ambiguous' })).toEqual({ kind: 'label_unknown', since: ago(T_UNKNOWN_MS).toISOString(), canRelease: true, reason: 'ambiguous' });
    expect(labelAlertOf(row, now, Role.vault_operator, opts)?.canRelease).toBe(false);
    expect(labelAlertOf(r({ labelProcessingSince: ago(T_UNKNOWN_MS - 1) }), now, Role.super_admin, opts)).toBeNull();
  });
  it('con id sin número a T_STUCK (30 min) ⇒ `label_processing_stuck`', () => {
    expect(labelAlertOf(r({ providerShipmentId: 'x', labelProcessingSince: ago(30 * MIN) }), now, null, opts)?.kind).toBe('label_processing_stuck');
    expect(labelAlertOf(r({ providerShipmentId: 'x', labelProcessingSince: ago(29 * MIN) }), now, null, opts)).toBeNull();
  });
  it('filas parciales (`undefined` en vez de `null`) no revientan', () => {
    expect(labelAlertOf({ status: 'picking' } as ShipmentRequest, now, null, opts)).toBeNull();
  });
  it('labelPending: en vuelo ⇒ `verifyingUntil = since + T_UNKNOWN` y el token; con id ⇒ `processing` y `verifyingUntil` null', () => {
    const since = ago(MIN);
    expect(toLabelPendingDTO(r({ labelProcessingSince: since }), null, 'ENV-000045-01', T_UNKNOWN_MS)).toEqual(
      expect.objectContaining({ state: 'in_flight', verifyingUntil: new Date(since.getTime() + T_UNKNOWN_MS).toISOString(), providerReference: 'ENV-000045-01' }),
    );
    expect(toLabelPendingDTO(r({ labelProcessingSince: since, providerShipmentId: 'x' }), null, null, T_UNKNOWN_MS)).toEqual(expect.objectContaining({ state: 'processing', verifyingUntil: null }));
    expect(toLabelPendingDTO(r({}), null, null, T_UNKNOWN_MS)).toBeNull();
  });
});

// ================================================================ S-GAS-5

describe('S-GAS-5 — mergeFacts', () => {
  it('triggers se UNEN sin repetir; cancelledCount/unrecoveredCents/unknownRefunds se REESCRIBEN; lo demás queda como lo dejó el primero', () => {
    const prev = { triggers: ['reissue_denied'], cancelledCount: 1, unrecoveredCents: 10, unknownRefunds: 0, actors: ['Ana'], shipmentId: 's1' };
    const next = { triggers: ['reissue_denied', 'person_3_in_24h'], cancelledCount: 3, unrecoveredCents: 40, unknownRefunds: 2, actors: ['Beto'], shipmentId: 's2' };
    expect(mergeFacts(prev, next)).toEqual({
      triggers: ['reissue_denied', 'person_3_in_24h'],
      cancelledCount: 3,
      unrecoveredCents: 40,
      unknownRefunds: 2,
      actors: ['Ana'],
      shipmentId: 's1',
    });
  });
});

// ================================================================ §19.7 — el cuerpo

describe('§19.7 — parseLabelBody', () => {
  const ok = { quoteId: 'q', rateId: 'r', expectedPriceCents: 7625, expectedMarginCents: -10 };
  const field = (raw: unknown) => {
    try {
      parseLabelBody(raw);
      return null;
    } catch (e) {
      return e instanceof BusinessException ? `${e.getStatus()}:${e.code}:${String(e.details.field)}` : String(e);
    }
  };
  it('válido ⇒ confirmaciones false por defecto; campos de costo del cuerpo NO pasan', () => {
    expect(parseLabelBody({ ...ok, shippingCostCents: 1 })).toEqual({ ...ok, confirmNegativeMargin: false, confirmBranchDelivery: false });
  });
  it.each<[string, unknown, string]>([
    ['sin quoteId', { ...ok, quoteId: undefined }, '400:VALIDATION_ERROR:quoteId'],
    ['rateId vacío', { ...ok, rateId: '  ' }, '400:VALIDATION_ERROR:rateId'],
    ['precio no entero', { ...ok, expectedPriceCents: 1.5 }, '400:VALIDATION_ERROR:expectedPriceCents'],
    ['margen como texto', { ...ok, expectedMarginCents: '1' }, '400:VALIDATION_ERROR:expectedMarginCents'],
    ['confirmación no booleana', { ...ok, confirmNegativeMargin: 'yes' }, '400:VALIDATION_ERROR:confirmNegativeMargin'],
    ['cuerpo arreglo', [], '400:VALIDATION_ERROR:quoteId'],
  ])('%s ⇒ %s', (_n, raw, expected) => expect(field(raw)).toBe(expected));
});

// ================================================================ PS-131 (c) — constantes

describe('PS-131 (c) — relaciones de constantes (§19.28.2, §19.28.8)', () => {
  it('PURCHASE_MAX_LIFE = plazo de salida + timeout de la compra del cliente + 30 s (DERIVADA)', () => {
    expect(PURCHASE_MAX_LIFE_MS).toBe(PURCHASE_SEND_DEADLINE_MS + SKYDROPX_PURCHASE_TIMEOUT_MS + 30_000);
    expect(PURCHASE_SEND_DEADLINE_MS).toBe(120_000);
  });
  it('T_INFLIGHT_BLOCK: con la evidencia negativa apagada = vida máxima (hoy 3 min); encendida = MIN + GAP + 1 min; < T_UNKNOWN', () => {
    expect(T_INFLIGHT_BLOCK_MS).toBe(PURCHASE_MAX_LIFE_MS);
    expect(T_INFLIGHT_BLOCK_MS).toBe(3 * MIN);
    const c = DEFAULT_LABEL_VERIFY_CONFIG;
    expect(inflightBlockOf({ ...c, negativeVerified: true })).toBe(c.tVerifyMinMs + c.tVerifyGapMs + MIN);
    expect(T_INFLIGHT_BLOCK_MS).toBeLessThan(T_UNKNOWN_MS);
  });
});

// ================================================================ PS-132 (b) / C-11 (b) — censo de claves

/** Llamadas a `pg_(try_)?advisory_xact_lock(...)` en código, con sus argumentos interpolados. */
export function advisoryLockCalls(files: { path: string; text: string }[]): { path: string; args: string[] }[] {
  const out: { path: string; args: string[] }[] = [];
  const re = /pg_(?:try_)?advisory_xact_lock\(([^)]*)\)/g;
  for (const f of files) {
    const c = code(f.text);
    for (const m of c.matchAll(re)) {
      const args = [...m[1].matchAll(/\$\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g)].map((x) => x[1]);
      const raw = m[1].split(',').length;
      out.push({ path: f.path, args: raw === args.length ? args : [...args, ...Array(raw - args.length).fill('<literal>')] });
    }
  }
  return out;
}

export function lockKeyProblems(files: { path: string; text: string }[]): string[] {
  const problems: string[] = [];
  const consts = new Map<string, number>();
  for (const f of files) {
    for (const m of code(f.text).matchAll(/export const ([A-Z0-9_]+(?:_LOCK_KEY|_NAMESPACE))\s*=\s*([0-9_]+)\s*;/g)) consts.set(m[1], Number(m[2].replace(/_/g, '')));
  }
  for (const call of advisoryLockCalls(files)) {
    if (call.args.length === 1 && !/_LOCK_KEY$/.test(call.args[0])) problems.push(`${call.path}: una clave sin constante _LOCK_KEY (${call.args[0]})`);
    if (call.args.length === 2 && !/_NAMESPACE$/.test(call.args[0])) problems.push(`${call.path}: espacio sin constante _NAMESPACE (${call.args[0]})`);
  }
  for (const suffix of ['_LOCK_KEY', '_NAMESPACE']) {
    const seen = new Map<number, string>();
    for (const [name, v] of consts) {
      if (!name.endsWith(suffix)) continue;
      if (seen.has(v)) problems.push(`${name} = ${v} repite el valor de ${seen.get(v)}`);
      seen.set(v, name);
    }
  }
  return problems;
}

describe('PS-132 (b) / C-11 (b) — censo de claves de los candados consultivos', () => {
  const files = walk(SRC).map((p) => ({ path: rel(p), text: readFileSync(p, 'utf8') }));
  it('toda llamada usa una constante con nombre y los valores son distintos entre sí', () => {
    expect(lockKeyProblems(files)).toEqual([]);
  });
  it('la compra usa SKYDROPX_PURCHASE_LOCK_KEY con `try` (nunca espera)', () => {
    const calls = advisoryLockCalls(files).filter((c) => c.path.includes('shipments/'));
    expect(calls).toEqual([{ path: 'src/modules/shipments/label-purchase.service.ts', args: ['SKYDROPX_PURCHASE_LOCK_KEY'] }]);
    const t = code(readFileSync(join(SRC, 'modules/shipments/label-purchase.service.ts'), 'utf8'));
    expect(t).toMatch(/pg_try_advisory_xact_lock\(\$\{SKYDROPX_PURCHASE_LOCK_KEY\}/);
    expect(t).not.toMatch(/pg_advisory_xact_lock\(\$\{SKYDROPX_PURCHASE_LOCK_KEY\}/);
  });
  it('CANARIOS: reutilizar FX_GATE_LOCK_KEY ⇒ rojo; un literal ⇒ rojo; un espacio de dos argumentos sin _NAMESPACE ⇒ rojo', () => {
    const fx = { path: 'a.ts', text: 'export const FX_GATE_LOCK_KEY = 63_120_863;' };
    expect(lockKeyProblems([fx, { path: 'b.ts', text: 'export const SKYDROPX_PURCHASE_LOCK_KEY = 63_120_863;' }])).toEqual([
      'SKYDROPX_PURCHASE_LOCK_KEY = 63120863 repite el valor de FX_GATE_LOCK_KEY',
    ]);
    expect(lockKeyProblems([{ path: 'c.ts', text: 'await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${KEY})`' }])).toEqual(['c.ts: una clave sin constante _LOCK_KEY (KEY)']);
    expect(lockKeyProblems([{ path: 'd.ts', text: 'await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS}::int, hashtext(${k}))`' }])).toEqual(['d.ts: espacio sin constante _NAMESPACE (NS)']);
  });
});

// ================================================================ PS-117 / C-2 — un llamador de la compra

describe('PS-117 / C-2 — `.purchase(` tiene UN llamador en shipments/ y `.protect(` ninguno en backend/src', () => {
  const files = walk(SRC).map((p) => ({ path: rel(p), text: code(readFileSync(p, 'utf8')) }));
  it('`.purchase(` en shipments/: una sola vez, en label-purchase.service.ts, DESPUÉS del reclamo y del 7b.2', () => {
    // (el controlador llama al VERBO `this.labels.purchase(`, que es esta misma función; se excluye por su receptor)
    const hits = files
      .filter((f) => f.path.includes('modules/shipments/'))
      .flatMap((f) => [...f.text.matchAll(/([A-Za-z_.]*)\.purchase\(/g)].filter((m) => m[1] !== 'this.labels').map(() => f.path));
    expect(hits).toEqual(['src/modules/shipments/label-purchase.service.ts']);
    const t = files.find((f) => f.path.endsWith('label-purchase.service.ts'))!.text;
    const i = t.indexOf('.purchase(');
    expect(t.lastIndexOf('this.claim(', i)).toBeGreaterThan(-1);
    expect(t.lastIndexOf('this.markSent(', i)).toBeGreaterThan(t.lastIndexOf('this.claim(', i));
  });
  it('`.protect(` ⇒ 0 en backend/src', () => {
    expect(files.filter((f) => /\.protect\(/.test(f.text)).map((f) => f.path)).toEqual([]);
  });
});
