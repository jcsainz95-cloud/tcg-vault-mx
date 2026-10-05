import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockSettings } from '@/lib/mock/fixtures';
import type { UserDTO } from '@/types/contract';
import { SpendControlSection } from './SpendControlSection';
import { ShippingSection } from './ShippingSection';

/**
 * Candados de «Configuración › Control del gasto» y de lo que cambia en «Envíos» (`DESIGN_SYSTEM §43.19.10`, UX-GAS-4)
 * y la parte de pantalla de PS-164 (`API_CONTRACT §M4-SHIP.19.30.2 (1)`, §19.30.3): los diales son del DUEÑO.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const ME = (isOwner: boolean): UserDTO => ({ id: 'u-sa1', email: 'd@x.mx', name: 'Dueño', role: 'super_admin', locale: 'es', isOwner });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getSettings').mockResolvedValue({ ...mockSettings, shippingProvider: 'skydropx', shippingLabelPurchase: 'super_admin_only', spendAlertsDisabled: [] });
  vi.spyOn(api, 'getShippingBalance').mockResolvedValue({ balanceCents: 96516, currency: 'MXN', lowBalance: true, thresholdCents: 100000, fetchedAt: '2026-10-04T16:00:00Z' });
  vi.spyOn(api, 'getShippingCatalogs').mockResolvedValue({ packagings: [], consignmentNote: { code: '49101600', description: 'Coleccionables' }, addressTemplates: [] });
  vi.spyOn(api, 'listShippingPackages').mockResolvedValue([]);
});

const save = () => screen.getByRole('button', { name: 'Guardar control del gasto' });
async function ready() {
  await screen.findByTestId('spend-control-section');
  await waitFor(() => expect(save()).toBeEnabled());
}

describe('UX-GAS-4 · «Control del gasto»: rangos, apagar pregunta, se mandan los DESMARCADOS', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getMe').mockResolvedValue(ME(true));
  });

  it('`operatorLabelCap24hCents` en 0 ⇒ error bajo el campo y 0 `PUT`', async () => {
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<SpendControlSection />, 'es');
    await ready();
    fireEvent.change(screen.getByLabelText('Tope de guías por persona en 24 horas'), { target: { value: '0' } });
    fireEvent.click(save());
    expect(await screen.findByText(/^El tope mínimo es MX\$1\.00\./)).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });
  it('desmarcar AG-6 y guardar ⇒ diálogo; «Volver» ⇒ 0 `PUT`; confirmar ⇒ `PUT` con `spendAlertsDisabled:[AG-6]` y los diales en centavos', async () => {
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<SpendControlSection />, 'es');
    await ready();
    const alerts = screen.getByTestId('spend-control-alerts');
    const ag6 = within(alerts).getByRole('checkbox', { name: /^AG-6 · Cargo extra de la paquetería/ });
    expect(ag6).toBeChecked(); // marcada = encendido
    fireEvent.click(ag6);
    fireEvent.click(save());
    let dialog = await screen.findByRole('dialog', { name: '¿Apagar 1 aviso?' });
    expect(dialog).toHaveTextContent('AG-6 · Cargo extra de la paquetería');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Volver' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(save());
    dialog = await screen.findByRole('dialog', { name: '¿Apagar 1 aviso?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sí, apagarlos' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toEqual({
      operatorLabelCap24hCents: 250000,
      shippingLabelReissueMaxPerShipment: 1,
      spendAlertLabelCapWarnPct: 80,
      spendAlertShipmentCancelCount: 2,
      spendAlertPersonCancelCount24h: 3,
      spendAlertChargeDriftImmediateCents: 2000,
      spendAlertExtraChargeImmediateCents: 15000,
      spendAlertCancelRefundDays: 3,
      spendAlertLabelNotShippedDays: 3,
      spendAlertsDisabled: ['AG-6'],
    });
    expect(await screen.findByText('Ajustes de control del gasto guardados.')).toBeInTheDocument();
  });
  it('marcar uno de vuelta (encender) ⇒ `PUT` SIN diálogo', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue({ ...mockSettings, spendAlertsDisabled: ['AG-6', 'AG-12'] });
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<SpendControlSection />, 'es');
    await ready();
    fireEvent.click(within(screen.getByTestId('spend-control-alerts')).getByRole('checkbox', { name: /^AG-6 ·/ }));
    fireEvent.click(save());
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(put.mock.calls[0][0].spendAlertsDisabled).toEqual(['AG-12']);
  });
  it('`422 {field}` del servidor ⇒ el error bajo SU campo', async () => {
    vi.spyOn(api, 'updateSettings').mockRejectedValue(
      new ApiClientError(422, { code: 'VALIDATION_ERROR', message: 'x', details: { field: 'spendAlertCancelRefundDays' } }),
    );
    renderWithProviders(<SpendControlSection />, 'es');
    await ready();
    fireEvent.click(save());
    const input = await screen.findByLabelText(/^Avisar si Skydropx no confirma el reembolso/);
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getAllByText('Del 1 al 30.').length).toBeGreaterThan(0);
  });
});

describe('PS-164 (pantalla) · los diales del dueño, deshabilitados para los demás; el `403` se pinta por `keys`', () => {
  it('no dueño: «Control del gasto», el interruptor de compra y el saldo bajo deshabilitados con «Solo el dueño puede cambiar esto.»', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue(ME(false));
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(
      <>
        <ShippingSection />
        <SpendControlSection />
      </>,
      'es',
    );
    await screen.findByTestId('spend-control-section');
    expect(await screen.findByTestId('spend-control-owner-only')).toHaveTextContent('Solo el dueño puede cambiar esto.');
    expect(save()).toBeDisabled();
    expect(screen.getByLabelText('Tope de guías por persona en 24 horas')).toBeDisabled();
    for (const box of within(screen.getByTestId('spend-control-alerts')).getAllByRole('checkbox')) expect(box).toBeDisabled();
    const purchase = await screen.findByTestId('shipping-purchase');
    expect(within(purchase).getByTestId('shipping-purchase-owner-only')).toHaveTextContent('Solo el dueño puede cambiar esto.');
    for (const r of within(purchase).getAllByRole('radio')) expect(r).toBeDisabled();
    expect(screen.getByLabelText('Avisar si el saldo baja de')).toBeDisabled();
    fireEvent.click(within(purchase).getByRole('radio', { name: /Nadie/ }));
    expect(put).not.toHaveBeenCalled();
  });
  it('dueño: el interruptor vive en `#compra-guias`, la sección en `#control-gasto` y el saldo bajo dice cuándo llega el correo', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue(ME(true));
    const { container } = renderWithProviders(
      <>
        <ShippingSection />
        <SpendControlSection />
      </>,
      'es',
    );
    await screen.findByTestId('shipping-purchase');
    expect(container.querySelector('fieldset#compra-guias')).not.toBeNull();
    expect(container.querySelector('section#control-gasto')).not.toBeNull();
    expect(await screen.findByText(/^Debajo de esta cifra le llega un correo al dueño \(aviso AG-7\)/)).toBeInTheDocument();
    expect(screen.getByText('Solo los súper-admin')).toBeInTheDocument();
    expect(screen.getByText('También el personal')).toBeInTheDocument();
    // ⛔ «No hay tope aparte del saldo» era falso con TG-1 (§43.19.0).
    expect(document.body.textContent).not.toMatch(/No hay tope aparte del saldo/);
  });
  it('`403 OWNER_ONLY_SETTING {keys}` ⇒ «No se guardó nada: solo el dueño puede cambiar …» con los campos de sus keys (⛔ nunca el `message`)', async () => {
    // El front cree que es el dueño (p. ej. la marca cambió entre leer y guardar): decide el servidor.
    vi.spyOn(api, 'getMe').mockResolvedValue(ME(true));
    vi.spyOn(api, 'updateSettings').mockRejectedValue(
      new ApiClientError(403, {
        code: 'OWNER_ONLY_SETTING',
        message: 'MENSAJE_CRUDO',
        details: { keys: ['operatorLabelCap24hCents', 'spendAlertsDisabled'] },
      }),
    );
    renderWithProviders(<SpendControlSection />, 'es');
    await ready();
    fireEvent.click(save());
    expect(
      await screen.findByText('No se guardó nada: solo el dueño puede cambiar el tope de guías por persona y qué avisos están encendidos.'),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('MENSAJE_CRUDO');
  });
});

describe('UX-GAS-11 (Configuración) · AG-21 y AG-22 «Siempre encendido»; la nota ya no dice que lo apagado no se registra (§43.20.5)', () => {
  it('AG-21 y AG-22 marcadas y deshabilitadas con `alwaysOn`; desmarcar los trece ⇒ el `PUT` NO las incluye; gravedad por código', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue(ME(true));
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<SpendControlSection />, 'es');
    await ready();
    const alerts = screen.getByTestId('spend-control-alerts');
    for (const [code, title, sev] of [
      ['AG-21', 'Cambió la cuenta del dueño', 'Correo inmediato'],
      ['AG-22', 'Cambios de otro súper-admin', 'Correo inmediato si toca a un súper-admin o la cuenta o los ajustes del dueño; si no, resumen diario'],
    ] as const) {
      const box = within(alerts).getByRole('checkbox', { name: new RegExp(`^${code} · ${title}`) });
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
      expect(box).toHaveAccessibleDescription('Siempre encendido: vigila la cuenta y los ajustes del dueño.');
      expect(screen.getByTestId(`spend-control-always-${code}`)).toHaveTextContent(sev);
    }
    expect(within(alerts).getByRole('checkbox', { name: /^AG-1 ·/ }).closest('label')).toHaveTextContent(
      'Correo inmediato si cambió destinatario, calle, CP, municipio, estado o país; si no, resumen diario',
    );
    expect(within(alerts).getByRole('checkbox', { name: /^AG-9 ·/ }).closest('label')).toHaveTextContent(
      'Correo inmediato; la guía de más que cancelamos solos va en el resumen diario',
    );
    expect(alerts.textContent).not.toMatch(/según el caso/);
    for (const box of within(alerts).getAllByRole('checkbox')) if (!(box as HTMLInputElement).disabled) fireEvent.click(box);
    // Las dos siguen marcadas (deshabilitadas: el clic no las cambia).
    expect(within(alerts).getByRole('checkbox', { name: /^AG-21 ·/ })).toBeChecked();
    fireEvent.click(save());
    const dialog = await screen.findByRole('dialog', { name: '¿Apagar 13 avisos?' });
    expect(dialog).toHaveTextContent('seguirán apareciendo en «Avisos de gasto» marcados «Apagado»');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sí, apagarlos' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const sent = put.mock.calls[0][0].spendAlertsDisabled ?? [];
    expect(sent).toHaveLength(13);
    expect(sent).not.toContain('AG-21');
    expect(sent).not.toContain('AG-22');
  });
  it('la sección ya no dice «no se registra» ni «no se podrá ver»; dice que se sigue registrando', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue(ME(true));
    renderWithProviders(<SpendControlSection />, 'es');
    await ready();
    const section = screen.getByTestId('spend-control-section');
    expect(section.textContent).not.toMatch(/no se registra|no se podrá ver|no se puede ver después/);
    expect(section).toHaveTextContent('pero se sigue registrando: aparece en «Avisos de gasto» marcado «Apagado»');
  });
});

describe('UX-GAS-13 (OWN-1) · lo que lee un súper-admin que no es el dueño no le habla de «tú» como si fuera el dueño (§43.20.6)', () => {
  it('`isOwner:false`: Configuración en ES sin «Tú no tienes tope», «la compras tú» ni «sin correo sí»; el subtítulo dice «Solo el dueño»', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue(ME(false));
    renderWithProviders(
      <>
        <ShippingSection />
        <SpendControlSection />
      </>,
      'es',
    );
    await screen.findByTestId('spend-control-owner-only');
    await screen.findByTestId('shipping-purchase');
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/Tú no tienes tope|la compras tú|sin correo sí|te llega un correo/);
    expect(screen.getByTestId('spend-control-section')).toHaveTextContent(
      'Solo el dueño cambia estos ajustes; los demás súper-admin los ven.',
    );
    expect(body).toContain('El dueño no tiene tope; los demás súper-admin sí.');
    expect(body).toContain('la siguiente la compra el dueño');
  });
});
