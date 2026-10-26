import { createHmac, randomBytes } from 'node:crypto';
import { IS_REAL, apiAs, apiAsOk, resolveApiBaseUrl } from './env';
import { createHarnessPiece } from './accessories-scenario';
import { clearState, readState, withFileLock, writeState } from './state';

/**
 * ─────────────────────────────────────────────────────────────────────────────────────
 * §DSC contra el stack REAL — lo que el arnés siembra y cómo lo deja (frontend, 2026-10-26, contrato v1.110.2).
 *
 * **Códigos.** Se siembran por `POST /admin/discount-codes` (§DSC.7, `super_admin`), como L3 de `checkout-movil`
 * siembra su accesorio. El texto es «único para siempre» (§DSC.1: un archivado sigue ocupando su nombre), así que
 * cada caso usa uno nuevo (`runDiscountCode`). Al final: `DELETE` (archiva) si no tiene usos; con uso
 * (`409 DISCOUNT_CODE_HAS_USES`, el uso nunca vuelve [D5]) se **pausa**: queda en la lista del dueño del stack de
 * pruebas, pausado y con su prefijo `E2E`. Lo que un caso caído no retiró lo retira el `globalTeardown`.
 *
 * **Piezas.** Las cartas que se pagan son PROPIAS del caso (`createHarnessPiece`, la misma alta que `ownCatalogPiece`
 * de §AC): ⛔ ninguna pieza del seed se vende ni se retira (QA-REL-3). Se anotan en una lista PROPIA, no en la de §AC:
 * su destino es acabar vendidas o en un retiro `picking`, y el `error_captura` del teardown de §AC no aplica a eso.
 * El teardown de aquí solo retira las que sigan `listed` (un caso que se cayó antes de pagar).
 *
 * **Pago.** «El doble de Stripe» es el del arnés de QA: el SDK del backend apunta a un servidor local
 * (`QA_FAKE_STRIPE_PORT`, precarga `stripe-preload.cjs`) y el webhook se firma con el `STRIPE_WEBHOOK_SECRET` del
 * mismo stack. Sin esas dos variables no hay cobro posible (sin Stripe la sesión da `503`, `checkout.spec.ts`), y el
 * caso lo dice ROJO con su motivo (`stripeDouble`), ⛔ no se salta.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */

const codesKey = async () => `discounts:codes:${await resolveApiBaseUrl()}`;
const piecesKey = async () => `discounts:pieces:${await resolveApiBaseUrl()}`;

async function remember(key: string, value: string): Promise<void> {
  await withFileLock(`${key}:lock`, async () => {
    const prev = readState<string[]>(key)?.value ?? [];
    if (!prev.includes(value)) writeState<string[]>(key, [...prev, value]);
  });
}

async function forget(key: string, value: string): Promise<void> {
  await withFileLock(`${key}:lock`, async () => {
    const prev = readState<string[]>(key)?.value ?? [];
    writeState<string[]>(key, prev.filter((v) => v !== value));
  });
}

/** Texto de código nuevo por caso: `^[A-Z0-9-]{4,20}$` (§DSC.1). `E2E` + 1 letra del caso + sello base 36. */
export function runDiscountCode(tag: string): string {
  const stamp = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`.toUpperCase();
  return `E2E${tag.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2)}-${stamp}`.slice(0, 20);
}

export interface SeededDiscountCode {
  id: string;
  code: string;
  kind: 'percent' | 'fixed_amount' | 'free_shipping';
}

/** `POST /admin/discount-codes` y lo anota para el teardown. */
export async function seedDiscountCode(body: {
  code: string;
  kind: 'percent' | 'fixed_amount' | 'free_shipping';
  percentPct?: number;
  amountCents?: number;
}): Promise<SeededDiscountCode> {
  const dto = await apiAsOk<SeededDiscountCode>('admin', 'POST', '/admin/discount-codes', body);
  await remember(await codesKey(), dto.id);
  return { id: dto.id, code: dto.code, kind: dto.kind };
}

/** El id de un código por su texto (`?q=` es prefijo; se exige el texto exacto). `null` si no está. */
export async function findDiscountCodeId(code: string): Promise<string | null> {
  const r = await apiAsOk<{ data: { id: string; code: string }[] }>('admin', 'GET', `/admin/discount-codes?q=${encodeURIComponent(code)}`);
  return r.data.find((c) => c.code === code)?.id ?? null;
}

/** Lo anota para el teardown (el código que el dueño crea por PANTALLA). */
export async function rememberDiscountCode(id: string): Promise<void> {
  await remember(await codesKey(), id);
}

/** Archiva el código; con usos (`409 DISCOUNT_CODE_HAS_USES`) lo pausa. */
export async function retireDiscountCode(id: string): Promise<'archived' | 'paused' | 'gone'> {
  const del = await apiAs<{ code?: string }>('admin', 'DELETE', `/admin/discount-codes/${encodeURIComponent(id)}`);
  let out: 'archived' | 'paused' | 'gone';
  if (del.status === 204 || del.status === 200) out = 'archived';
  else if (del.status === 404) out = 'gone';
  else if (del.status === 409) {
    await apiAsOk('admin', 'POST', `/admin/discount-codes/${encodeURIComponent(id)}/pause`);
    out = 'paused';
  } else throw new Error(`DELETE /admin/discount-codes/${id} respondió ${del.status}: ${JSON.stringify(del.body)}`);
  await forget(await codesKey(), id);
  return out;
}

/** Pieza PROPIA del caso, `listed`, con su folio. */
export async function ownDiscountPiece(): Promise<{ id: string; folio: string }> {
  const key = await piecesKey();
  const item = await createHarnessPiece((id) => remember(key, id));
  if (item.status !== 'listed') throw new Error(`La pieza del arnés §DSC (${item.folio}) nació «${item.status}», no «listed».`);
  return { id: item.id, folio: item.folio };
}

/** Retira la pieza si sigue `listed` (el caso no llegó a pagarla); vendida o en bóveda, solo deja de anotarse. */
export async function releaseDiscountPiece(id: string): Promise<string> {
  const now = await apiAs<{ status: string }>('admin', 'GET', `/admin/inventory/items/${encodeURIComponent(id)}`);
  let out = now.status === 200 ? now.body.status : `http ${now.status}`;
  if (now.status === 200 && now.body.status === 'listed') {
    const r = await apiAs('admin', 'POST', '/admin/inventory/adjustments', {
      reason: 'error_captura',
      inventoryItemId: id,
      note: 'E2E §DSC: pieza dada de alta por el arnés, no existe físicamente',
    });
    out = r.status < 300 ? 'retired' : `listed (ajuste ${r.status})`;
    if (r.status >= 300) return out; // se queda anotada: la recoge el teardown
  }
  await forget(await piecesKey(), id);
  return out;
}

/** `globalTeardown`: lo que un caso caído dejó vivo. Avisa sin tumbar la corrida. */
export async function restoreDiscountScenario(): Promise<void> {
  if (!IS_REAL) return;
  try {
    const cKey = await codesKey();
    for (const id of readState<string[]>(cKey)?.value ?? []) {
      try {
        await retireDiscountCode(id);
      } catch (error) {
        console.warn(`[e2e] §DSC: no se pudo retirar el código ${id}: ${String(error)}`);
      }
    }
    clearState(cKey);
    const pKey = await piecesKey();
    for (const id of readState<string[]>(pKey)?.value ?? []) {
      try {
        await releaseDiscountPiece(id);
      } catch (error) {
        console.warn(`[e2e] §DSC: no se pudo revisar la pieza ${id}: ${String(error)}`);
      }
    }
  } catch (error) {
    console.warn(`[e2e] §DSC: no se pudo deshacer la huella: ${String(error)}`);
  }
}

// ── El doble de Stripe ──

export interface StripeDouble {
  fakeUrl: string;
  webhookSecret: string;
}

/**
 * El doble de Stripe del stack bajo prueba, o un error que dice qué falta. `E2E_FAKE_STRIPE_URL` /
 * `E2E_STRIPE_WEBHOOK_SECRET` ganan; si no, los del arnés de QA (`QA_FAKE_STRIPE_PORT`, `STRIPE_WEBHOOK_SECRET`), que
 * son las MISMAS variables con las que se levantó el backend. ⛔ El secreto nunca se imprime.
 */
export function stripeDouble(): StripeDouble {
  const port = process.env.QA_FAKE_STRIPE_PORT;
  const fakeUrl = process.env.E2E_FAKE_STRIPE_URL ?? (port ? `http://127.0.0.1:${port}` : '');
  const webhookSecret = process.env.E2E_STRIPE_WEBHOOK_SECRET ?? process.env.STRIPE_WEBHOOK_SECRET ?? '';
  if (!fakeUrl || !webhookSecret) {
    throw new Error(
      'ENTORNO (no producto): este caso cobra contra el DOBLE de Stripe y no lo encuentra. Exporta, con los mismos ' +
        'valores con los que levantaste el backend, QA_FAKE_STRIPE_PORT (o E2E_FAKE_STRIPE_URL) y STRIPE_WEBHOOK_SECRET ' +
        `(o E2E_STRIPE_WEBHOOK_SECRET). Falta: ${[!fakeUrl && 'URL del doble', !webhookSecret && 'secreto del webhook'].filter(Boolean).join(' y ')}.`,
    );
  }
  return { fakeUrl, webhookSecret };
}

/**
 * Cobra un PaymentIntent como lo haría Stripe: el doble lo marca `succeeded` y el backend recibe
 * `payment_intent.succeeded` FIRMADO (`t=…,v1=HMAC-SHA256(secreto, "t.payload")`, el esquema de `constructEvent`).
 * Devuelve el status HTTP del webhook (200 = aceptado).
 */
export async function settleByWebhook(double: StripeDouble, paymentIntentId: string): Promise<number> {
  const succeeded = await fetch(`${double.fakeUrl}/__qa/succeed/${encodeURIComponent(paymentIntentId)}`, { method: 'POST' });
  if (!succeeded.ok) throw new Error(`El doble de Stripe no conoce el PaymentIntent ${paymentIntentId} (${succeeded.status}).`);
  const pi = (await succeeded.json()) as { id: string; amount: number; currency: string; metadata?: Record<string, string> };
  const event = {
    id: `evt_e2e_dsc_${randomBytes(6).toString('hex')}`,
    object: 'event',
    type: 'payment_intent.succeeded',
    api_version: '2024-06-20',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: pi.id,
        object: 'payment_intent',
        amount: pi.amount,
        amount_received: pi.amount,
        currency: pi.currency,
        status: 'succeeded',
        latest_charge: `ch_${pi.id.slice(3)}`,
        metadata: pi.metadata ?? {},
      },
    },
  };
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', double.webhookSecret).update(`${t}.${payload}`).digest('hex');
  const res = await fetch(`${await resolveApiBaseUrl()}/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${v1}` },
    body: payload,
  });
  return res.status;
}

/** Espera a que `probe` devuelva algo distinto de `undefined` (sondeo cada 300 ms, tope `ms`). */
export async function pollFor<T>(probe: () => Promise<T | undefined>, ms = 20_000): Promise<T | undefined> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
}
