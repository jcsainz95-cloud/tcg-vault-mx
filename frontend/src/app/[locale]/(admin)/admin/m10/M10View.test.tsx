import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M10View } from './M10View';

describe('M10View · Config y bitácora', () => {
  it('carga los diales con el valor de la API (cents → pesos)', async () => {
    renderWithProviders(<M10View />, 'es');
    // shippingFeeCents 17500 → MX$175 mostrado en pesos.
    const shipping = (await screen.findByLabelText(/Tarifa de envío/)) as HTMLInputElement;
    expect(shipping.value).toBe('175');
  });

  it('habilita guardar solo tras editar un dial (PUT parcial)', async () => {
    renderWithProviders(<M10View />, 'es');
    const shipping = (await screen.findByLabelText(/Tarifa de envío/)) as HTMLInputElement;
    // Botón de guardar deshabilitado sin cambios.
    const saveBtn = screen.getByRole('button', { name: /Guardar 0/ });
    expect(saveBtn).toBeDisabled();
    fireEvent.change(shipping, { target: { value: '200' } });
    expect(screen.getByRole('button', { name: /Guardar 1/ })).toBeEnabled();
  });

  it('muestra la bitácora de auditoría desde la API', async () => {
    renderWithProviders(<M10View />, 'es');
    expect((await screen.findAllByText('settings.update')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('order.refund')).length).toBeGreaterThan(0);
  });

  it('ya NO muestra los diales dedup de dinero (salesMarkupPct / fxBufferPct)', async () => {
    renderWithProviders(<M10View />, 'es');
    // Espera a que carguen los diales.
    await screen.findByLabelText(/Tarifa de envío/);
    // salesMarkupPct (dial MUERTO) y fxBufferPct (duplicado de M2 §3 FX) se quitaron del UI.
    expect(screen.queryByLabelText(/Markup de venta/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Colchón FX/)).not.toBeInTheDocument();
  });

  /**
   * D2 (techlead): sin este dial en la UI, encender la feature exigía `curl` — y el criterio 92(e)
   * pide «desde el back-office, sin redeploy, auditado». El PUT parcial de M10 ya es auditado.
   */
  it('v1.44 · el gancho de grading tiene su interruptor maestro (Select off/on, no texto libre)', async () => {
    renderWithProviders(<M10View />, 'es');
    const dial = (await screen.findByLabelText(/Valor estimado si se gradea/)) as HTMLSelectElement;
    expect(dial.tagName).toBe('SELECT');
    expect(Array.from(dial.options).map((o) => o.value)).toEqual(['off', 'on']);
  });

  it('v1.44 · al encenderlo la UI advierte que publica una afirmación comercial sin visto bueno legal', async () => {
    renderWithProviders(<M10View />, 'es');
    const dial = (await screen.findByLabelText(/Valor estimado si se gradea/)) as HTMLSelectElement;

    fireEvent.change(dial, { target: { value: 'off' } });
    expect(screen.queryByText(/afirmación comercial/i)).not.toBeInTheDocument();

    fireEvent.change(dial, { target: { value: 'on' } });
    // El aviso sube a `role="alert"` justo cuando se está encendiendo (aún sin guardar).
    const warning = screen.getByRole('alert');
    expect(warning.textContent).toMatch(/disclaimer|visto bueno/i);
    expect(warning.textContent).toMatch(/no cambia ningún precio de venta/i);
    // Y se guarda como un dial más: PUT parcial auditado, sin redeploy.
    expect(screen.getByRole('button', { name: /Guardar 1/ })).toBeEnabled();
  });

  it('el proveedor de referencia por-carta es un Select validado (no texto libre)', async () => {
    renderWithProviders(<M10View />, 'es');
    const raw = (await screen.findByLabelText(/Proveedor de referencia por-carta \(raw\)/)) as
      | HTMLSelectElement
      | HTMLInputElement;
    // Es un <select> con las 4 opciones válidas del contrato (PriceSource).
    expect(raw.tagName).toBe('SELECT');
    const options = Array.from((raw as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(['pokemontcg_io', 'pokemonpricetracker', 'poketrace', 'manual']);
  });
});
