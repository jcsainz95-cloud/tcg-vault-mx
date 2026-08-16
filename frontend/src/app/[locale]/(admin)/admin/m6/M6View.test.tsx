import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M6View } from './M6View';
import * as api from '@/lib/api';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('M6View · Usuarios / KYC', () => {
  it('renderiza la tabla de usuarios desde la API', async () => {
    renderWithProviders(<M6View />, 'es');
    expect(screen.getByRole('heading', { level: 1, name: /Usuarios/ })).toBeInTheDocument();
    expect((await screen.findAllByText('Ana López')).length).toBeGreaterThan(0);
  });

  it('filtra por búsqueda (q) sobre correo/nombre', async () => {
    renderWithProviders(<M6View />, 'es');
    await screen.findAllByText('Ana López');
    fireEvent.change(screen.getByLabelText('Buscar (correo o nombre)'), { target: { value: 'bruno' } });
    await waitForRemoved();
    expect((await screen.findAllByText('Bruno Díaz')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Ana López')).not.toBeInTheDocument();
  });

  it('abre la ficha 360° con CLABE enmascarada', async () => {
    renderWithProviders(<M6View />, 'es');
    const viewButtons = await screen.findAllByRole('button', { name: 'Ver ficha' });
    fireEvent.click(viewButtons[0]);
    expect(await screen.findByRole('dialog', { name: /Ficha 360/ })).toBeInTheDocument();
    // CLABE enmascarada del usuario u-777 (contrato §3.4).
    expect(await screen.findByText('****1234')).toBeInTheDocument();
  });

  it('el form de KYC refleja el usuario cargado y no arrastra estado al cambiar de usuario', async () => {
    renderWithProviders(<M6View />, 'es');
    const viewButtons = await screen.findAllByRole('button', { name: 'Ver ficha' });

    // Ana (u-777) está 'verified': el Select debe reflejarlo tras cargar el detalle.
    fireEvent.click(viewButtons[0]);
    await screen.findByRole('dialog', { name: /Ficha 360/ });
    const statusSelect = () => screen.getByLabelText('Estado KYC') as HTMLSelectElement;
    await waitFor(() => expect(statusSelect().value).toBe('verified'));

    // El admin teclea un borrador de tope para Ana pero NO guarda.
    fireEvent.change(screen.getByLabelText('Tope por solicitud'), { target: { value: '4500' } });
    expect((screen.getByLabelText('Tope por solicitud') as HTMLInputElement).value).toBe('4500');

    // Abre Bruno (u-778, 'none'): el form debe reflejar a Bruno, sin arrastrar el borrador de Ana.
    fireEvent.click(viewButtons[1]);
    await waitFor(() => expect(statusSelect().value).toBe('none'));
    expect((screen.getByLabelText('Tope por solicitud') as HTMLInputElement).value).toBe('');
  });

  it('guardar sin tocar el estado NO degrada el kycStatus cargado', async () => {
    const spy = vi.spyOn(api, 'updateUserKyc');
    renderWithProviders(<M6View />, 'es');
    const viewButtons = await screen.findAllByRole('button', { name: 'Ver ficha' });

    // Abre Ana (verified) y ajusta SOLO un tope, sin tocar el estado KYC.
    fireEvent.click(viewButtons[0]);
    await screen.findByRole('dialog', { name: /Ficha 360/ });
    await waitFor(() =>
      expect((screen.getByLabelText('Estado KYC') as HTMLSelectElement).value).toBe('verified'),
    );
    fireEvent.change(screen.getByLabelText('Tope por solicitud'), { target: { value: '4500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar KYC' }));

    // El payload debe conservar el kycStatus del servidor ('verified'), nunca 'none'.
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith('u-777', {
      kycStatus: 'verified',
      capPerRequestCents: 450000,
      capPerMonthCents: undefined,
    });
  });
});

// Pequeña espera para que el debounce/refetch del filtro asiente.
async function waitForRemoved() {
  await new Promise((r) => setTimeout(r, 200));
}
