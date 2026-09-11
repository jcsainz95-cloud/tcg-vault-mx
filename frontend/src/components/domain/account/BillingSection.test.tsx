import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { BillingSection } from './BillingSection';

const getBillingProfile = vi.fn();
const putBillingProfile = vi.fn();
vi.mock('@/lib/api', () => ({
  getBillingProfile: () => getBillingProfile(),
  putBillingProfile: (...a: unknown[]) => putBillingProfile(...a),
}));

const PROFILE = {
  rfcMasked: 'XAX**********',
  razonSocial: 'Ash Ketchum',
  regimenFiscal: '612',
  usoCfdi: 'G03',
  postalCode: '06600',
  email: 'ash@example.com',
};

/**
 * DESIGN_SYSTEM §33.6d · contrato v1.67.1 (QA, ronda de gates 2026-09-11): sin perfil (`null`, que
 * es el `404`) la sección pinta el VACÍO con su CTA, nunca seis «—» con «Editar»; con perfil, la
 * retícula con `rfcMasked` y «Editar»; el PUT devuelve la misma forma y se pinta sin segunda llamada.
 */
describe('BillingSection · vacío (404 ⇒ null) vs perfil (rfcMasked)', () => {
  beforeEach(() => {
    getBillingProfile.mockReset();
    putBillingProfile.mockReset();
  });

  it('sin perfil: «Sin datos de facturación» + «Agregar datos de facturación», y NINGÚN «—» ni «Editar»', async () => {
    getBillingProfile.mockResolvedValue(null);
    renderWithProviders(<BillingSection accountEmail="ash@example.com" />, 'es');
    expect(await screen.findByText('Sin datos de facturación')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar datos de facturación' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('«Agregar» abre el formulario EN LÍNEA con el correo de la cuenta prellenado; al guardar, PUT con los seis campos (RFC en mayúsculas) y se pinta el rfcMasked de la respuesta', async () => {
    getBillingProfile.mockResolvedValue(null);
    putBillingProfile.mockResolvedValue(PROFILE);
    renderWithProviders(<BillingSection accountEmail="ash@example.com" />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar datos de facturación' }));

    const section = screen.getByRole('region', { name: 'Facturación (CFDI)' });
    expect(within(section).getByLabelText('Correo para la factura')).toHaveValue('ash@example.com');
    fireEvent.change(within(section).getByLabelText('RFC'), { target: { value: 'xaxx010101000' } });
    fireEvent.change(within(section).getByLabelText('Razón social'), { target: { value: 'Ash Ketchum' } });
    fireEvent.change(within(section).getByLabelText('Régimen fiscal (clave SAT)'), { target: { value: '612' } });
    fireEvent.change(within(section).getByLabelText('Uso de CFDI (clave SAT)'), { target: { value: 'G03' } });
    fireEvent.change(within(section).getByLabelText('Código postal fiscal'), { target: { value: '06600' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(putBillingProfile).toHaveBeenCalledWith({
        rfc: 'XAXX010101000',
        razonSocial: 'Ash Ketchum',
        regimenFiscal: '612',
        usoCfdi: 'G03',
        postalCode: '06600',
        email: 'ash@example.com',
      }),
    );
    // La respuesta del PUT (misma forma que el GET) se pinta sin segunda llamada al GET.
    expect(await screen.findByText('XAX**********')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('GUARDADO');
    expect(getBillingProfile).toHaveBeenCalledTimes(1);
  });

  it('con perfil: retícula con el RFC ENMASCARADO y «Editar» (el RFC no se prellena: hay que teclearlo completo)', async () => {
    getBillingProfile.mockResolvedValue(PROFILE);
    renderWithProviders(<BillingSection accountEmail="ash@example.com" />, 'es');
    expect(await screen.findByText('XAX**********')).toBeInTheDocument();
    expect(screen.getByText('Ash Ketchum')).toBeInTheDocument();
    expect(screen.queryByText('Sin datos de facturación')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    expect(screen.getByLabelText('RFC')).toHaveValue('');
    expect(screen.getByLabelText('Razón social')).toHaveValue('Ash Ketchum');
  });

  it('todos los campos son obligatorios: sin RFC no hay PUT y el campo marca «Campo requerido»', async () => {
    getBillingProfile.mockResolvedValue(null);
    renderWithProviders(<BillingSection accountEmail="ash@example.com" />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar datos de facturación' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getAllByText('Campo requerido').length).toBeGreaterThan(0);
    expect(putBillingProfile).not.toHaveBeenCalled();
  });
});
