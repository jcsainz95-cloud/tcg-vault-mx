import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { AdminShipmentDTO, LabelPendingDTO, LabelReleaseVia } from '@/types/contract';
import { CaptureLabelDialog, POLL_MS } from './CaptureLabelDialog';
import { PACKAGES, TARGET, labelFor, quote, rateOf, shipment } from './capture/sdx-test-fixtures';

/**
 * Candados de la ventana «Capturar guía» del diseño **v4.20** (`DESIGN_SYSTEM §43.19.15`: UX-SDX-27…31) contra el
 * contrato `§M4-SHIP.19.26…19.29` (PS-128, PS-158 negativa, PS-136 parte ventana), con la API espiada (equivalente a
 * MSW: el backend de compra se está construyendo). El canario de cada uno está en `docs/FRONTEND_NOTES.md` §92.
 */

const role = vi.hoisted(() => ({ superAdmin: false }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: role.superAdmin ? 'super_admin' : 'vault_operator',
    setRole: () => {},
    isSuperAdmin: role.superAdmin,
    canSwitchRole: false,
  }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const Q = quote();
const T0 = Date.parse('2026-10-04T16:00:00Z');

beforeEach(() => {
  vi.restoreAllMocks();
  role.superAdmin = false;
  vi.spyOn(api, 'listShippingPackages').mockResolvedValue(PACKAGES);
});
afterEach(() => {
  vi.useRealTimers();
});

function open(s: AdminShipmentDTO = shipment(), locale: 'es' | 'en' = 'es') {
  const get = vi.spyOn(api, 'getAdminShipment').mockResolvedValue(s);
  const quoteSpy = vi.spyOn(api, 'quoteShipment').mockResolvedValue(Q);
  renderWithProviders(<CaptureLabelDialog target={TARGET} onClose={() => {}} onSaved={() => {}} />, locale);
  const dialog = () => screen.getByRole('dialog');
  return { get, quoteSpy, dialog };
}
async function toStep3(locale: 'es' | 'en' = 'es') {
  fireEvent.click(await screen.findByRole('button', { name: locale === 'es' ? 'Ver opciones de envío' : /shipping options/i }));
  await screen.findByRole('radio', { name: '99minutos · Next Day Nacional' });
  fireEvent.click(screen.getByRole('button', { name: locale === 'es' ? /^Continuar con/ : /^Continue with/ }));
  await screen.findByText(locale === 'es' ? 'Paso 3 de 4 · Comprar' : /^Step 3 of 4/);
}
/**
 * SK11 — sin cifras de tope, gasto ni porcentaje. UX-SDX-28 (c) **sustituida** por `DESIGN_SYSTEM §43.20.8`: «24 horas»
 * es la REGLA (la ventana del tope, igual para todos), no un dato de la persona; se quita SOLO esa ventana, anclada
 * (`(?<!\d)…\b`: «124 horas» no se cuela), y lo demás debe quedar sin dígitos, `MX$` ni `%`.
 */
const figures = (text: string | null) => (text ?? '').replace(/(?<!\d)24 (horas|hours)\b/g, '').match(/\d|MX\$|%/g) ?? [];
const buyButtons = () => screen.queryAllByRole('button', { name: /^(Comprar guía|Buy label)/ });
const manualButtons = () => screen.queryAllByRole('button', { name: /^(Capturar a mano|Enter by hand)/ });

function pending(over: Partial<LabelPendingDTO> = {}): LabelPendingDTO {
  return {
    since: new Date(T0).toISOString(),
    state: 'in_flight',
    carrierLabel: '99minutos',
    serviceName: 'Next Day Nacional',
    chosenBy: { userId: 'u-op1', name: 'Ana' },
    priceCents: 14850,
    providerReference: 'ENV-000045-01',
    verifyingUntil: new Date(T0 + 15 * 60_000).toISOString(),
    ...over,
  };
}

describe('UX-SDX-27 · comprar también el personal: el dial habla de súper-admins, ⛔ nunca de «el dueño»', () => {
  it.each(['es', 'en'] as const)("super_admin_only + operador ⇒ `buy.superAdminOnly` y el DOM sin /dueño|owner/ (%s)", async (locale) => {
    const { dialog } = open(shipment({}, { purchase: 'super_admin_only', canPurchase: false }), locale);
    await toStep3(locale);
    expect(buyButtons()).toHaveLength(0);
    expect(screen.getByTestId('sdx-cannot-buy')).toHaveTextContent(locale === 'es' ? /^Ahora mismo solo los súper-admin compran guías/ : /^Right now only super admins buy labels/);
    expect(dialog().textContent).not.toMatch(/dueño|owner/i);
  });
  it('`403 FORBIDDEN {reason:label_purchase_super_admin_only}` ⇒ `error.superAdminOnly`, sin «dueño»', async () => {
    vi.spyOn(api, 'purchaseShipmentLabel').mockRejectedValue(
      new ApiClientError(403, { code: 'FORBIDDEN', message: 'x', details: { reason: 'label_purchase_super_admin_only' } }),
    );
    const { dialog } = open();
    await toStep3();
    fireEvent.click(buyButtons()[0]);
    expect(await screen.findByText('Ahora mismo solo los súper-admin compran guías. No se cobró nada y el intento quedó en bitácora.')).toBeInTheDocument();
    expect(dialog().textContent).not.toMatch(/dueño/i);
  });
});

describe('UX-SDX-28 💰 = PS-158 (negativa) · el tope niega sin cifras y «Capturar a mano» es la primaria', () => {
  it('(c) §43.20.8 · el canario muerde: la ventana «24 horas» pasa; el tope, lo gastado, el porcentaje, «MX$24.00» y «124 horas» no', () => {
    expect(figures('Llegaste a tu tope de guías de las últimas 24 horas.')).toEqual([]);
    expect(figures("You've reached your label limit for the last 24 hours.")).toEqual([]);
    for (const leak of [
      'Llegaste a tu tope de MX$2,500.00 de las últimas 24 horas.',
      'Llegaste a tu tope de 2500 de las últimas 24 horas.',
      'Llegaste a tu tope de MX$24.00.',
      'Llegaste a tu tope de las últimas 24 horas (llevas el 80 %).',
      'Llegaste a tu tope de las últimas 124 horas.',
    ]) {
      expect(figures(leak), leak).not.toEqual([]);
    }
  });
  it.each([
    ['daily_spend', 'Llegaste a tu tope de guías de las últimas 24 horas.', 'llegaste a tu tope de las últimas 24 horas'],
    ['reissue', 'Este envío ya tuvo su recompra de guía.', 'este envío ya tuvo su recompra'],
  ] as const)('(a) `labelOptions.limit:%s` ⇒ cero «Comprar», su frase en el sitio del botón, «a mano» primaria y la nota del paso 2', async (limit, text, note) => {
    open(shipment({}, { purchase: 'operators', canPurchase: true, limit }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ver opciones de envío' }));
    expect(await screen.findByTestId('sdx-limit-note')).toHaveTextContent(note);
    expect(figures(screen.getByTestId('sdx-limit-note').textContent)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /^Continuar con/ }));
    await screen.findByText('Paso 3 de 4 · Comprar');
    expect(buyButtons()).toHaveLength(0);
    expect(screen.getByTestId('sdx-cannot-buy')).toHaveTextContent(text);
    expect(figures(screen.getByTestId('sdx-cannot-buy').textContent)).toEqual([]);
    expect(manualButtons()).toHaveLength(1);
    expect(manualButtons()[0].className).toMatch(/bg-primary/);
  });
  it.each([
    ['daily_spend', /^Llegaste a tu tope de guías de las últimas 24 horas\. El dueño puede comprarla/],
    ['reissue', /^Este envío ya tuvo su recompra de guía\. La siguiente la compra el dueño/],
  ] as const)('(b)(c) `403 LABEL_PURCHASE_LIMIT {limit:%s}` ⇒ su texto sin cifras, el botón desaparece y 0 compras más', async (limit, text) => {
    const buy = vi.spyOn(api, 'purchaseShipmentLabel').mockRejectedValue(
      new ApiClientError(403, { code: 'LABEL_PURCHASE_LIMIT', message: 'x', details: { limit } }),
    );
    open();
    await toStep3();
    fireEvent.click(buyButtons()[0]);
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(text);
    expect(banner).toHaveTextContent('No se cobró nada y el intento quedó en bitácora.');
    expect(figures(banner.textContent)).toEqual([]); // SK11: ni tope, ni lo usado, ni porcentaje
    expect(buyButtons()).toHaveLength(0);
    expect(manualButtons()[0].className).toMatch(/bg-primary/);
    expect(buy).toHaveBeenCalledTimes(1);
  });
});

describe('UX-SDX-29 💰 · `409 CONFLICT` de la compra: un texto por `reason` (⛔ nunca el mismo texto ni por status)', () => {
  const conflict = (details: Record<string, unknown>) => new ApiClientError(409, { code: 'CONFLICT', message: 'x', details });
  const OLD = 'El envío cambió mientras comprabas';

  it('rate_already_purchased ⇒ su texto + «Elegir otra opción» (paso 2) y «Capturar a mano» presente, sin enlace al otro envío', async () => {
    vi.spyOn(api, 'purchaseShipmentLabel').mockRejectedValue(conflict({ reason: 'rate_already_purchased', otherShipmentId: 'shp-other-uuid' }));
    const { dialog } = open();
    await toStep3();
    fireEvent.click(buyButtons()[0]);
    expect(await screen.findByText(/ya se usó para comprar la guía de otro envío/)).toBeInTheDocument();
    expect(dialog().textContent).not.toContain(OLD);
    expect(dialog().textContent).not.toContain('shp-other-uuid');
    expect(manualButtons()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Elegir otra opción' }));
    expect(await screen.findByText('Paso 2 de 4 · Opciones')).toBeInTheDocument();
  });
  it('attempts_exhausted ⇒ su texto en el sitio del botón y «a mano» primaria', async () => {
    vi.spyOn(api, 'purchaseShipmentLabel').mockRejectedValue(conflict({ reason: 'attempts_exhausted' }));
    open();
    await toStep3();
    fireEvent.click(buyButtons()[0]);
    expect(await screen.findByText(/ya no admite más intentos de compra con Skydropx/)).toBeInTheDocument();
    expect(buyButtons()).toHaveLength(0);
    expect(manualButtons()[0].className).toMatch(/bg-primary/);
  });
  it('provider_id_taken ⇒ relee, paso 4 con su texto encima y SIN «Comprar» ni «Capturar a mano»', async () => {
    vi.spyOn(api, 'purchaseShipmentLabel').mockRejectedValue(conflict({ reason: 'provider_id_taken', otherShipmentId: 'shp-other-uuid' }));
    const { get, dialog } = open();
    await toStep3();
    get.mockResolvedValue(shipment({ labelPending: pending() }));
    fireEvent.click(buyButtons()[0]);
    expect(await screen.findByText(/Skydropx contestó con una guía que ya es de otro envío\. No se guardó en éste/)).toBeInTheDocument();
    expect(screen.getByText('Paso 4 de 4 · Guía')).toBeInTheDocument();
    expect(buyButtons()).toHaveLength(0);
    expect(manualButtons()).toHaveLength(0);
    expect(dialog().textContent).not.toContain('shp-other-uuid');
    // sustituye `verify.body`: no se está comprobando nada útil
    expect(dialog().textContent).not.toMatch(/Suele resolverse en pocos minutos/);
  });
  it('stale_purchase_response ⇒ relee y decide por el estado, con su texto como información', async () => {
    vi.spyOn(api, 'purchaseShipmentLabel').mockRejectedValue(conflict({ reason: 'stale_purchase_response' }));
    const { get, dialog } = open();
    await toStep3();
    fireEvent.click(buyButtons()[0]);
    expect(await screen.findByText(/La respuesta de Skydropx llegó tarde/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    expect(dialog().textContent).not.toContain(OLD);
  });
  it('sin `reason` ⇒ el texto de hoy (`error.conflict`)', async () => {
    vi.spyOn(api, 'purchaseShipmentLabel').mockRejectedValue(conflict({}));
    open();
    await toStep3();
    fireEvent.click(buyButtons()[0]);
    expect(await screen.findByText(/El envío cambió mientras comprabas/)).toBeInTheDocument();
  });

  it('purchase_in_flight sin folio ⇒ se queda en el paso 3, botón DESHABILITADO hasta `retryAfterSeconds`, luego habilitado; 0 compras sin clic nuevo; cero enlaces y sin paréntesis', async () => {
    const buy = vi.spyOn(api, 'purchaseShipmentLabel').mockRejectedValue(
      conflict({ reason: 'purchase_in_flight', otherShipmentId: null, otherFolio: null, retryAfterSeconds: 3 }),
    );
    const { dialog } = open();
    await toStep3();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await act(async () => {
      fireEvent.click(buyButtons()[0]);
    });
    const box = await screen.findByTestId('sdx-purchase-in-flight');
    expect(box).toHaveTextContent('Otra guía se está comprando en este momento. Se compran de una en una');
    expect(box).toHaveTextContent('unos segundos');
    expect(box).toHaveTextContent('panel de Skydropx');
    expect(box.textContent).not.toMatch(/\(/);
    expect(within(dialog()).queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText('Paso 3 de 4 · Comprar')).toBeInTheDocument();
    expect(buyButtons()).toHaveLength(1);
    expect(buyButtons()[0]).toBeDisabled();
    expect(buyButtons()[0].getAttribute('aria-describedby')).toBe(box.id);
    expect(manualButtons()[0]).toBeEnabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(buyButtons()[0]).toBeEnabled();
    expect(screen.getByTestId('sdx-purchase-in-flight')).toHaveTextContent('Ya puedes intentarlo de nuevo. No se compró nada todavía.');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(buy).toHaveBeenCalledTimes(1); // ⛔ no compra sola al llegar a 0 (SK2)
  });
  it('purchase_in_flight con `otherFolio` ⇒ «(envío ENV-000046)», espera en minutos; ⛔ nunca el uuid', async () => {
    vi.spyOn(api, 'purchaseShipmentLabel').mockRejectedValue(
      conflict({ reason: 'purchase_in_flight', otherShipmentId: 'shp-other-uuid', otherFolio: 'ENV-000046', retryAfterSeconds: 75 }),
    );
    const { dialog } = open();
    await toStep3();
    fireEvent.click(buyButtons()[0]);
    const box = await screen.findByTestId('sdx-purchase-in-flight');
    expect(box).toHaveTextContent('(envío ENV-000046)');
    expect(box).toHaveTextContent('1:15 minutos');
    expect(dialog().textContent).not.toContain('shp-other-uuid');
  });
});

describe('UX-SDX-30 · `processing` con `providerError` ⇒ el mensaje de Skydropx literal', () => {
  it('«Guía en proceso» + «Skydropx dice: “X”»; cero «Capturar a mano»', async () => {
    const r = rateOf(Q, 'rate-99min');
    vi.spyOn(api, 'purchaseShipmentLabel').mockResolvedValue({
      outcome: 'processing',
      shipment: shipment({ labelPending: pending({ state: 'processing', verifyingUntil: null }) }),
      providerError: { code: 'E42', message: 'X' },
    });
    void r;
    open();
    await toStep3();
    fireEvent.click(buyButtons()[0]);
    expect(await screen.findByText('Guía en proceso')).toBeInTheDocument();
    expect(screen.getByText('Skydropx dice: “X”')).toBeInTheDocument();
    expect(screen.getByText(/Skydropx reportó un problema al crear la guía/)).toBeInTheDocument();
    expect(screen.queryByText('E42')).not.toBeInTheDocument();
    expect(manualButtons()).toHaveLength(0);
  });
});

describe('UX-SDX-31 💰 = PS-128 · «Verificando con Skydropx…» y sus resultados (decide la relectura, ⛔ nunca el reloj)', () => {
  it('(a) `in_flight` + `verifyingUntil` sin `label_unknown` ⇒ «Verificando…», folio «Pedido ENV-000045-01», cero compra/a mano; relee cada 30 s pasados 2 min y para en `verifyingUntil + 60 s`', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(T0);
    const s = shipment({ labelPending: pending() });
    const { get } = open(s);
    expect(await screen.findByText('Verificando con Skydropx…')).toBeInTheDocument();
    expect(screen.getByText('Folio en Skydropx: Pedido ENV-000045-01')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copiar folio' })).toBeInTheDocument();
    expect(screen.getByText(/a más tardar a las/)).toBeInTheDocument();
    expect(buyButtons()).toHaveLength(0);
    expect(manualButtons()).toHaveLength(0);
    const calls = () => get.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    const at2min = calls();
    expect(at2min).toBeGreaterThanOrEqual(23); // cada 5 s los primeros 2 min
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(calls() - at2min).toBe(4); // 4 lecturas en los 2 min siguientes: cada 30 s, no cada 5
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(screen.getByText('Puedes cerrar: el resultado aparecerá en la tarjeta del envío.')).toBeInTheDocument();
    const stopped = calls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(calls()).toBe(stopped);
    // Releyó MÁS ALLÁ de los 2 min de §43.5 (el canario «dejar de releer a los 2 min» lo pone rojo).
    expect(stopped).toBeGreaterThan(at2min + 20);
  });

  it.each([
    ['auto_verified', 'Comprobamos con Skydropx: no se creó la guía ni se cobró. Puedes comprarla de nuevo.'],
    ['auto_not_sent', 'La compra no llegó a salir hacia Skydropx: no se creó la guía ni se cobró. Puedes comprarla de nuevo.'],
    ['manual_verified', 'Un súper-admin la liberó después de que comprobamos con Skydropx que no se creó. Puedes comprarla de nuevo.'],
    ['manual', /^Un súper-admin la liberó tras revisarla en el panel de Skydropx\./],
  ] as const)('(b) relectura sin reclamo y `via:%s` ⇒ su texto y «Cotizar de nuevo»; 0 compras hasta el clic', async (via, text) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(T0);
    const buy = vi.spyOn(api, 'purchaseShipmentLabel');
    const { get, quoteSpy } = open(shipment({ labelPending: pending() }));
    await screen.findByText('Verificando con Skydropx…');
    get.mockResolvedValue(shipment({ lastLabelRelease: { at: new Date(T0 + 60_000).toISOString(), via: via as LabelReleaseVia } }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    vi.useRealTimers();
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(manualButtons()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cotizar de nuevo' }));
    expect(await screen.findByText('Paso 2 de 4 · Opciones')).toBeInTheDocument();
    expect(quoteSpy).toHaveBeenLastCalledWith(TARGET.id, {}); // sin `force`: el servidor reutiliza la vigente
    expect(buy).toHaveBeenCalledTimes(0);
  });

  it('(c) la relectura trae `label` ⇒ «Guía comprada» + «la encontramos por su folio»', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(T0);
    const { get } = open(shipment({ labelPending: pending() }));
    await screen.findByText('Verificando con Skydropx…');
    get.mockResolvedValue(shipment({ labelSource: 'skydropx', label: labelFor(rateOf(Q, 'rate-99min')) }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    vi.useRealTimers();
    expect(await screen.findByText('Skydropx sí la había creado: la encontramos por su folio. No se compró otra.')).toBeInTheDocument();
    expect(screen.getByTestId('sdx-labeled')).toBeInTheDocument();
  });

  it('(d) `labelAlert.kind=label_unknown` con `reason` ⇒ «Compra sin confirmar» con la frase de su motivo, sin «Liberar»', async () => {
    open(shipment({ labelPending: pending(), labelAlert: { kind: 'label_unknown', since: new Date(T0).toISOString(), canRelease: true, reason: 'ambiguous' } }));
    expect(await screen.findByText('Compra sin confirmar')).toBeInTheDocument();
    expect(screen.getByText(/no pudo comprobar solo si se creó la guía: Encontramos un envío parecido en Skydropx, pero no pudimos confirmar que sea éste\. No la vuelvas a comprar/)).toBeInTheDocument();
    expect(screen.getByText('Folio en Skydropx: Pedido ENV-000045-01')).toBeInTheDocument();
    expect(screen.queryByText('Verificando con Skydropx…')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Liberar' })).not.toBeInTheDocument();
  });
});

describe('UX-SDX-34 (ventana) = PS-136 · la cabecera dice «Envío ENV-…», ⛔ sin uuid', () => {
  it('con pedido ⇒ «TCG-000123 · Envío ENV-000045»; retiro ⇒ «Retiro de bóveda · Envío ENV-000045»', async () => {
    vi.spyOn(api, 'getAdminShipment').mockResolvedValue(shipment());
    vi.spyOn(api, 'quoteShipment').mockResolvedValue(Q);
    const { unmount } = renderWithProviders(
      <CaptureLabelDialog target={{ ...TARGET, folio: 'ENV-000045', orderNumber: 'TCG-000123' }} onClose={() => {}} onSaved={() => {}} />,
      'es',
    );
    expect(await screen.findByTestId('sdx-dialog-ref')).toHaveTextContent('TCG-000123 · Envío ENV-000045');
    expect(screen.getByRole('dialog').textContent).not.toContain(TARGET.id);
    unmount();
    renderWithProviders(
      <CaptureLabelDialog target={{ ...TARGET, ref: 'ENV-000045', folio: 'ENV-000045', orderNumber: null }} onClose={() => {}} onSaved={() => {}} />,
      'es',
    );
    expect(await screen.findByTestId('sdx-dialog-ref')).toHaveTextContent('Retiro de bóveda · Envío ENV-000045');
    expect(screen.getByRole('dialog').textContent).not.toContain(TARGET.id);
  });
});
