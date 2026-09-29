/**
 * # refunds.candados.spec.ts — ⭐⭐ los candados ESTÁTICOS del dinero que vuelve (API_CONTRACT §M4-SHIP.8, .17.6, .18.2)
 *
 * Cuatro censos por aparición sobre `src/` y una desigualdad. Ninguno mira la prosa: leen el código.
 *
 *  - **`C-REF-1`** — los sitios que CREAN filas `PaymentRefund` o llaman a Stripe para reembolsar son EXACTAMENTE:
 *    el preparado (`ShipmentPrepService.prepare`), M3 (`OrderRefundService.requestFullRefund`), el reembolso de un
 *    caso (`ReplacementCaseService.refund`) y `closeWithdrawalIfEmpty` — y este último SOLO lo llaman `refund` y
 *    `void`, los dos `@MoneyOut()`. El reintento (`retry`) NO crea filas: re-ejecuta la misma. Stripe recibe
 *    `refunds.create` desde UN sitio (`StripeService.createRefund`) y ese sitio tiene UN llamador (`executeRefund`).
 *  - **`C-MREF-1`** — los creadores de `ManualRefund` son EXACTAMENTE tres (`…/replacement-cases/:id/refund`,
 *    `…/refunds/:id/to-manual`, `…/manual-refunds/:id/reissue`); los escritores de `status:'paid'|'cancelled'` son
 *    `paid` y `cancel`; todos `@MoneyOut()` (solo `super_admin`); y el único lector de `KycProfile.clabeEnc` que
 *    devuelve la CLABE en claro fuera de buylist es `reveal-clabe`.
 *  - **`C-CLABE-1`** — el único escritor de `KycProfile.clabeEnc|clabeHmac|clabeUpdatedAt` es `UsersService.setClabe`.
 *  - **`C-FULLREF-1`** — los llamadores de `onFullRefund` son exactamente M3 (directo), la confirmación de Stripe
 *    (`applyStripeOutcome`, bóveda), el webhook `charge.refunded`, `unprepare` de un retiro y `reclaim-vault`; y
 *    `unpackedItemIds` solo viaja desde `reclaim-vault` (v1.80.6, SEC-SHIP-B12).
 *  - **Lease > timeout (SEC-SHIP-M2)** — `REFUND_ATTEMPT_LEASE_MS` > peor caso de UNA llamada a Stripe
 *    (`TIMEOUT_MS × (1 + maxNetworkRetries)`): un reclamo que expira antes de que el proveedor conteste es dos
 *    `refunds.create` en carrera.
 *
 * ⚠️ Si un candado se cae por un sitio NUEVO, la decisión es del arquitecto (regla 9): ⛔ no se arregla añadiendo el
 * sitio a la lista sin que el contrato lo nombre.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REFUND_ATTEMPT_LEASE_MS } from '../src/modules/payments/refunds/refund-ledger.service';
import { StripeService } from '../src/modules/payments/stripe.service';

const SRC = join(__dirname, '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

const FILES = walk(SRC).map((p) => ({ path: relative(SRC, p), text: readFileSync(p, 'utf8') }));

/** Ficheros (relativos a `src/`) donde aparece el patrón, con cuántas veces. */
function census(re: RegExp): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of FILES) {
    const n = (f.text.match(re) ?? []).length;
    if (n > 0) out[f.path] = n;
  }
  return out;
}

/** El texto de UNA llamada `obj.verb(` hasta cerrar sus paréntesis (para ver qué columnas toca). */
function callSpans(text: string, re: RegExp): string[] {
  const spans: string[] = [];
  for (const m of text.matchAll(re)) {
    let depth = 0;
    let i = m.index! + m[0].length - 1;
    for (; i < text.length; i += 1) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    spans.push(text.slice(m.index!, i + 1));
  }
  return spans;
}

const text = (path: string) => FILES.find((f) => f.path === path)!.text;

describe('C-REF-1 — quién crea filas del libro y quién habla con Stripe', () => {
  it('`paymentRefund.create*` vive SOLO en `RefundLedgerService.createRows`', () => {
    expect(census(/paymentRefund\.create(Many)?\(/g)).toEqual({ 'modules/payments/refunds/refund-ledger.service.ts': 1 });
  });

  it('`createRows` tiene EXACTAMENTE los llamadores del contrato: preparado, M3, reembolso del caso y `closeWithdrawalIfEmpty`', () => {
    const callers = census(/\.createRows\(/g);
    expect(callers).toEqual({
      'modules/shipments/shipment-prep.service.ts': 1, // POST /admin/shipments/:id/prepared
      'modules/orders/order-refund.service.ts': 1, // M3 order_full
      'modules/vault/replacement-case.service.ts': 2, // refund (case_refund) + closeWithdrawalIfEmpty (shipment_fee)
    });
  });

  it('`closeWithdrawalIfEmpty` tiene DOS llamadores (`refund` y `void`) y los dos verbos llevan `@MoneyOut()` en el controlador', () => {
    const svc = text('modules/vault/replacement-case.service.ts');
    expect((svc.match(/this\.closeWithdrawalIfEmpty\(/g) ?? []).length).toBe(2);
    expect(census(/closeWithdrawalIfEmpty\(/g)).toEqual({ 'modules/vault/replacement-case.service.ts': 3 }); // 1 definición + 2 llamadas
    const ctrl = text('modules/vault/admin-replacement-cases.controller.ts');
    for (const verb of ['refund', 'void']) {
      const block = ctrl.slice(ctrl.indexOf(`@Post(':id/${verb}')`), ctrl.indexOf(`${verb}(@Param`));
      // `@MoneyOut()` = solo `super_admin` Y el operador recibe `403 MONEY_OUT_FORBIDDEN` auditado (`money-out.guard.spec.ts`).
      expect(block).toContain('@MoneyOut()');
    }
    // `replace` es operador+ y ⛔ sin dinero.
    const replace = ctrl.slice(ctrl.indexOf("@Post(':id/replace')"), ctrl.indexOf('replace(@Param'));
    expect(replace).not.toContain('@MoneyOut()');
  });

  it('Stripe `refunds.create` vive SOLO en `StripeService.createRefund`, y `createRefund` tiene UN llamador: `executeRefund`', () => {
    expect(census(/\.refunds\.create\(/g)).toEqual({ 'modules/payments/stripe.service.ts': 1 });
    expect(census(/stripe\.createRefund\(/g)).toEqual({ 'modules/payments/refunds/refund-ledger.service.ts': 1 });
  });
});

describe('C-MREF-1 — la cubeta SPEI: tres creadores, dos escritores de estado, un reveal', () => {
  it('`manualRefund.create*` vive SOLO en `ManualRefundService.createRow`', () => {
    expect(census(/manualRefund\.create(Many)?\(/g)).toEqual({ 'modules/payments/refunds/manual-refund.service.ts': 1 });
  });

  it('`createRow` tiene EXACTAMENTE tres llamadores: el reembolso del caso, `to-manual` y `reissue`', () => {
    expect(census(/manual\.createRow\(|this\.createRow\(/g)).toEqual({
      'modules/vault/replacement-case.service.ts': 1,
      'modules/payments/refunds/manual-refund.service.ts': 2,
    });
    const svc = text('modules/payments/refunds/manual-refund.service.ts');
    const reissue = svc.slice(svc.indexOf('async reissue('), svc.indexOf('async toManual('));
    const toManual = svc.slice(svc.indexOf('async toManual('), svc.indexOf('async notifyAnnounced('));
    expect((reissue.match(/this\.createRow\(/g) ?? []).length).toBe(1);
    expect((toManual.match(/this\.createRow\(/g) ?? []).length).toBe(1);
  });

  it("`status: 'paid'` y `status: 'cancelled'` sobre `ManualRefund` se escriben SOLO en `paid` y `cancel`", () => {
    // Solo el bloque `data:` (el `where` lleva el estado LEÍDO, que es justo el CAS).
    const dataOf = (span: string) => span.slice(span.indexOf('data:'));
    const spans = FILES.flatMap((f) => callSpans(f.text, /manualRefund\.update(Many)?\(/g).map((s) => ({ path: f.path, s: dataOf(s) })));
    const writers = spans.filter((x) => /status:\s*'(paid|cancelled)'/.test(x.s));
    expect(writers.map((w) => w.path)).toEqual([
      'modules/payments/refunds/manual-refund.service.ts',
      'modules/payments/refunds/manual-refund.service.ts',
    ]);
    // ⛔ nada vuelve a `pending` (INV-MR-4).
    expect(spans.some((x) => /status:\s*'pending'/.test(x.s))).toBe(false);
  });

  it('el controlador de la cubeta es `super_admin` + `@MoneyOut()` a nivel de clase y NINGÚN verbo abre la puerta al operador', () => {
    const ctrl = text('modules/payments/refunds/admin-manual-refunds.controller.ts');
    // `@MoneyOut()` a nivel de CLASE (todos los verbos, también las lecturas): el operador ⇒ `403 MONEY_OUT_FORBIDDEN`.
    const head = ctrl.slice(0, ctrl.indexOf('export class'));
    expect(head).toContain('@MoneyOut()');
    // ⛔ ningún verbo se abre por su cuenta con un `@Roles(...)` propio sin `@MoneyOut()` (el de clase ya lo cubre).
    expect((ctrl.match(/^\s*@Roles\(/gm) ?? []).length).toBe(1); // solo el de clase (los comentarios no cuentan)
    // `to-manual` vive en `admin/refunds` (operador+ a nivel de clase): su verbo lleva `@MoneyOut()`.
    const refunds = text('modules/payments/refunds/admin-refunds.controller.ts');
    const block = refunds.slice(refunds.indexOf("@Post(':id/to-manual')"), refunds.indexOf('toManual(@Param'));
    expect(block).toContain('@MoneyOut()');
  });

  it('la CLABE en claro sale SOLO por los dos `reveal-clabe` (buylist y la cubeta): `decryptOptional`/`decrypt` sobre `clabeEnc`', () => {
    // `tryDecryptOptional` (⇒ máscara, degrada) está permitido en cualquier proyección; el descifrado DURO no.
    const hard = census(/\.(decryptOptional|decrypt)\((?!Optional)[^)]*clabe/gi);
    // buylist (fuera del alcance de este candado, medido 2026-09-29): 4 sitios — fallback de la CLABE propia al crear
    // la solicitud, máscara del snapshot en la lista, y los dos del `reveal-clabe` de §M5. ⛔ Fuera de buylist: UNO.
    const { 'modules/buylist/buylist.service.ts': buylist, ...outside } = hard;
    expect(buylist).toBe(4);
    expect(outside).toEqual({ 'modules/payments/refunds/manual-refund.service.ts': 1 }); // reveal-clabe de la cubeta
  });
});

describe('C-CLABE-1 — el único escritor de la CLABE', () => {
  it('`kycProfile.update|upsert|create*` que toque `clabeEnc|clabeHmac|clabeUpdatedAt` vive SOLO en `users.service.ts` (setClabe), UNA vez', () => {
    const spans = FILES.flatMap((f) =>
      callSpans(f.text, /kycProfile\.(update|updateMany|upsert|create|createMany)\(/g)
        .filter((s) => /clabeEnc|clabeHmac|clabeUpdatedAt/.test(s))
        .map((s) => ({ path: f.path, s })),
    );
    // ⚠️ Excepción DECLARADA (medida 2026-09-29, enrutada al arquitecto en BACKEND_NOTES): el borrado SUAVE de una
    // cuenta (`AdminService.deleteUser`, C20/PII) ANULA `clabeEnc`/`clabeHmac` (`null`, ⛔ nunca un valor). No es un
    // cambio de CLABE (SEC-SHIP-A3: con CLABE nula, `paid` ⇒ `422 CLABE_NOT_ON_FILE`), es una anonimización.
    const erasure = spans.filter((x) => x.path === 'modules/admin/admin.service.ts');
    expect(erasure).toHaveLength(1);
    expect(erasure[0].s).toMatch(/clabeEnc:\s*null/);
    expect(erasure[0].s).toMatch(/clabeHmac:\s*null/);
    expect(erasure[0].s).not.toMatch(/clabeUpdatedAt/);
    expect(erasure[0].s).not.toMatch(/clabe(Enc|Hmac):\s*(?!null\b)\S/);
    const writers = spans.filter((x) => x.path !== 'modules/admin/admin.service.ts').map((x) => x.path);
    expect(writers).toEqual(['modules/users/users.service.ts']);
    const users = text('modules/users/users.service.ts');
    const setClabe = users.slice(users.indexOf('async setClabe('), users.indexOf('async notifyClabeChanged('));
    expect(setClabe).toContain('clabeUpdatedAt: now');
    expect(setClabe).toContain('FOR UPDATE');
  });

  it('⛔ ningún SQL crudo escribe esas columnas', () => {
    expect(census(/\$(executeRaw|queryRaw)(Unsafe)?[^;]*"(clabeEnc|clabeHmac|clabeUpdatedAt)"/gs)).toEqual({});
  });
});

describe('C-FULLREF-1 — el despachador `onFullRefund` y sus llamadores', () => {
  it('los llamadores son EXACTAMENTE: M3 directo + reclaim-vault (orders), confirmación de Stripe (libro), webhook y `unprepare`', () => {
    expect(census(/\.onFullRefund\(/g)).toEqual({
      'modules/orders/order-refund.service.ts': 2, // requestFullRefund (directo, en tx1) + reclaimVault (§18.10)
      'modules/payments/refunds/refund-ledger.service.ts': 1, // applyStripeOutcome (bóveda: al CONFIRMAR)
      'modules/payments/payments.service.ts': 2, // charge.refunded: cobro de una ORDEN (total) y cobro de un RETIRO
      'modules/shipments/shipment-prep.service.ts': 1, // DELETE …/prepared de un retiro (piezas vuelven a la foto del sello)
    });
  });

  it('`unpackedItemIds` solo viaja desde `reclaim-vault` (v1.80.6, SEC-SHIP-B12)', () => {
    const spans = FILES.flatMap((f) => callSpans(f.text, /\.onFullRefund\(/g).map((s) => ({ path: f.path, s })));
    const withIds = spans.filter((x) => /unpackedItemIds/.test(x.s));
    expect(withIds.map((x) => x.path)).toEqual(['modules/orders/order-refund.service.ts']);
    const orders = text('modules/orders/order-refund.service.ts');
    const reclaim = orders.slice(orders.indexOf('async reclaimVault('));
    expect(reclaim).toContain('unpackedItemIds');
  });
});

describe('SEC-SHIP-M2 — el reclamo del intento dura MÁS que la peor llamada a Stripe', () => {
  it('REFUND_ATTEMPT_LEASE_MS > TIMEOUT_MS × (1 + maxNetworkRetries)', () => {
    const stripe = text('modules/payments/stripe.service.ts');
    const retries = Number(/maxNetworkRetries:\s*(\d+)/.exec(stripe)![1]);
    expect(retries).toBeGreaterThanOrEqual(0);
    expect(REFUND_ATTEMPT_LEASE_MS).toBeGreaterThan(StripeService.TIMEOUT_MS * (1 + retries));
  });
});

describe('PS-62 — el despachador `onFullRefund` LANZA ante lo que no tiene rama (⛔ nunca un no-op silencioso)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { FullRefundService } = require('../src/modules/payments/refunds/full-refund.service');
  const svc = new FullRefundService();
  const txWith = (order: unknown) => ({ order: { findUnique: jest.fn(async () => order) } }) as never;

  it('un `FulfillmentMode` sin rama ⇒ lanza', async () => {
    await expect(svc.onFullRefund(txWith({ id: 'o1', fulfillmentMode: 'teleport' }), { orderId: 'o1' }, 'm3', null)).rejects.toThrow(/fulfillmentMode/i);
  });

  it('`unprepared` / `reclaim` con un directo (o con un envío como objetivo) ⇒ lanza: solo reclaman bóveda', async () => {
    await expect(svc.onFullRefund(txWith({ id: 'o1', fulfillmentMode: 'direct_ship' }), { orderId: 'o1' }, 'unprepared', 'u')).rejects.toThrow(/only reclaims vault/);
    await expect(svc.onFullRefund(txWith(null), { shipmentRequestId: 's1' }, 'reclaim', 'u')).rejects.toThrow(/only reclaims vault/);
  });

  it('una orden inexistente ⇒ lanza (⛔ no «no había nada que hacer»)', async () => {
    await expect(svc.onFullRefund(txWith(null), { orderId: 'nope' }, 'm3', null)).rejects.toThrow(/not found/);
  });
});
