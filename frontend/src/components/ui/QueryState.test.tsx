import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { useErrorMessage } from './QueryState';
import { ApiClientError } from '@/lib/api-client';
import type { ErrorAudience } from '@/lib/error-audience';
import es from '../../../messages/es.json';

/*
 * DESIGN_SYSTEM §26 — el mecanismo, de punta a punta.
 *
 * Los candados de `lib/error-audience.test.ts` miden el catálogo y el cableado; éste mide **lo que
 * se pinta**: que un `422` de la mesa de emisión ya no le pida al operador que suba **su** INE.
 */

/** Sonda mínima: hace lo mismo que cualquier `Banner` de error de la app. */
function Probe({ error, audience }: { error: unknown; audience?: ErrorAudience }) {
  const getMessage = useErrorMessage(audience);
  return <p data-testid="msg">{getMessage(error)}</p>;
}

const message = () => screen.getByTestId('msg').textContent ?? '';

describe('useErrorMessage · §26 «el destinatario manda»', () => {
  it('OPERADOR · `INE_REQUIRED` de la emisión: habla del VENDEDOR, no le pide su INE al operador', () => {
    // Forma exacta del backend en `POST /admin/buylist/:id/offer` (§M5-A.7): sin `thresholdCents`.
    const error = new ApiClientError(422, {
      code: 'INE_REQUIRED',
      message: 'INE on file is required for the offered gross',
      details: { sellRequestId: 'sr-3004', grossCents: 340000 },
    });
    renderWithIntl(<Probe error={error} audience="operator" />, 'es');
    expect(message()).toBe(es.error.INE_REQUIRED_OPERATOR);
    // Los tres modos de fallo, por lo negativo: ni el copy del vendedor, ni el inglés del
    // servidor, ni el umbral de cumplimiento de un tercero.
    expect(message()).not.toBe(es.error.INE_REQUIRED);
    expect(message()).not.toContain('INE on file is required');
    expect(message()).not.toMatch(/\btu INE\b/);
  });

  it('VENDEDOR · el mismo código en el intake sigue leyéndose como siempre', () => {
    const error = new ApiClientError(422, {
      code: 'INE_REQUIRED',
      message: 'INE required above threshold',
      details: { thresholdCents: 300000 },
    });
    renderWithIntl(<Probe error={error} />, 'es');
    expect(message()).toBe(es.error.INE_REQUIRED);
  });

  it('el `details` del SERVIDOR manda sobre la superficie: `thresholdCents` en pantalla de admin ⇒ copy de vendedor', () => {
    // No es un capricho: si esto pasa, el servidor mandó el error de la otra puerta y el operador
    // tiene que ver lo mismo que vería el vendedor. La superficie solo decide cuando `details` calla.
    const error = new ApiClientError(422, {
      code: 'INE_REQUIRED',
      message: 'INE required above threshold',
      details: { thresholdCents: 300000 },
    });
    renderWithIntl(<Probe error={error} audience="operator" />, 'es');
    expect(message()).toBe(es.error.INE_REQUIRED);
  });

  it('OPERADOR · `BUYLIST_LIMIT_EXCEEDED` con `scope: per_month_offer` interpola los DOS montos', () => {
    const error = new ApiClientError(422, {
      code: 'BUYLIST_LIMIT_EXCEEDED',
      message: 'Monthly cap exceeded by the offered gross',
      details: { scope: 'per_month_offer', capCents: 1000000, wouldBeCents: 1234500 },
    });
    renderWithIntl(<Probe error={error} audience="operator" />, 'es');
    expect(message()).toContain('MX$12,345.00');
    expect(message()).toContain('MX$10,000.00');
    expect(message()).not.toMatch(/\bsuperas\b/i);
  });

  it('OPERADOR · si falta un monto cae a la variante SIN cifras, nunca a «MX$ undefined»', () => {
    const error = new ApiClientError(422, {
      code: 'BUYLIST_LIMIT_EXCEEDED',
      message: 'Monthly cap exceeded by the offered gross',
      details: { scope: 'per_month_offer', capCents: 1000000 },
    });
    renderWithIntl(<Probe error={error} audience="operator" />, 'es');
    expect(message()).toBe(es.error.BUYLIST_LIMIT_EXCEEDED_OPERATOR);
    expect(message()).not.toContain('undefined');
  });

  it('VENDEDOR · `scope: per_month` sigue siendo su mensaje, y SIN cifras del tope', () => {
    const error = new ApiClientError(422, {
      code: 'BUYLIST_LIMIT_EXCEEDED',
      message: 'Monthly cap exceeded',
      details: { scope: 'per_month', capCents: 1000000, wouldBeCents: 1234500 },
    });
    renderWithIntl(<Probe error={error} />, 'es');
    // §26.5: «no hay variante con cifras para el cliente» — su copy es accionable sin números y
    // meter el tope mensual en el cotizador abriría una superficie pública de diales.
    expect(message()).toBe(es.error.BUYLIST_LIMIT_EXCEEDED);
    expect(message()).not.toContain('MX$');
  });

  it('los códigos SOLO-ADMIN de §26 ya no caen al inglés del servidor (prohibición 7)', () => {
    for (const [code, expected] of [
      ['REQUEST_NOT_RECEIVED', es.error.REQUEST_NOT_RECEIVED],
      ['PICKUP_ADDRESS_MISSING', es.error.PICKUP_ADDRESS_MISSING],
      ['OFFER_PRICE_IMMUTABLE', es.error.OFFER_PRICE_IMMUTABLE],
      ['APPROVED_PRICE_CAP_EXCEEDED', es.error.APPROVED_PRICE_CAP_EXCEEDED],
    ] as const) {
      const error = new ApiClientError(422, {
        code,
        message: 'This sell request has no record of receipt',
      });
      const { unmount } = renderWithIntl(<Probe error={error} audience="operator" />, 'es');
      expect(message(), code).toBe(expected);
      unmount();
    }
  });

  it('`PICKUP_ADDRESS_LOCKED` se desdobla por SUPERFICIE (no tiene discriminador en `details`)', () => {
    const error = new ApiClientError(409, {
      code: 'PICKUP_ADDRESS_LOCKED',
      message: 'Pickup address is locked',
      details: { status: 'en_transito', guideSentAt: '2026-09-01T10:00:00Z' },
    });
    const admin = renderWithIntl(<Probe error={error} audience="operator" />, 'es');
    expect(message()).toBe(es.error.PICKUP_ADDRESS_LOCKED_OPERATOR);
    admin.unmount();
    renderWithIntl(<Probe error={error} />, 'es');
    expect(message()).toBe(es.error.PICKUP_ADDRESS_LOCKED);
  });

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * §27.1 · `ITEMS_NOT_DECIDED` — el LOTE 1, el único de §27 que bloquea el release.
   * §27.1.2 es normativa en el punto delicado: **la cifra sale de la lista que mandó ESTE error**.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('con `pendingDecisionItemIds` pinta la variante con cifra, y la cifra es la LONGITUD de esa lista', () => {
    const error = new ApiClientError(422, {
      code: 'ITEMS_NOT_DECIDED',
      message: 'Payment requires a verification verdict on every purchased line',
      details: { sellRequestId: 'sr-3005', pendingDecisionItemIds: ['a', 'b', 'c'] },
    });
    renderWithIntl(<Probe error={error} audience="operator" />, 'es');
    expect(message()).toContain('quedan 3 cartas sin decidir');
    // ⛔ Ni el inglés del servidor (MEN-2) ni un `{count}` crudo.
    expect(message()).not.toContain('Payment requires');
    expect(message()).not.toContain('{count}');
    // Y dice lo que NO pasó, con las dos mitades que §27.1.3 exige en la pantalla del pago.
    expect(message()).toContain('no salió dinero');
  });

  it('sin lista utilizable cae a la BASE — nunca a la cifra inventada ni al inglés', () => {
    // §27.1.2: «ausente, no-array o vacío ⇒ se pinta la base». Los tres, uno por uno.
    for (const details of [undefined, { pendingDecisionItemIds: [] }, { pendingDecisionItemIds: 2 }]) {
      const error = new ApiClientError(422, {
        code: 'ITEMS_NOT_DECIDED',
        message: 'Payment requires a verification verdict on every purchased line',
        details: details as Record<string, unknown> | undefined,
      });
      const { unmount } = renderWithIntl(<Probe error={error} audience="operator" />, 'es');
      expect(message(), JSON.stringify(details)).toBe(es.error.ITEMS_NOT_DECIDED);
      unmount();
    }
  });

  it('lo que NO cambia: un código sin copy sigue cayendo al mensaje del servidor', () => {
    // El fallback no se retira —cubre los códigos que el catálogo aún no tiene, y ocultarlos sería
    // peor—; lo que §26 exige es que **los siete suyos** no lleguen nunca hasta aquí.
    const error = new ApiClientError(422, {
      code: 'OFFER_LINES_MISMATCH',
      message: 'Offer lines do not match the request lines',
    });
    renderWithIntl(<Probe error={error} audience="operator" />, 'es');
    expect(message()).toBe('Offer lines do not match the request lines');
  });
});
