import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { SealedRestockForm } from './SealedRestockForm';
import { ApiClientError } from '@/lib/api-client';
import * as api from '@/lib/api';

beforeEach(() => {
  vi.restoreAllMocks();
});

function fillEmail(value = 'yo@ejemplo.com') {
  fireEvent.change(screen.getByLabelText('Correo'), { target: { value } });
}

describe('SealedRestockForm · flag ENCENDIDO (suscripción acepta)', () => {
  it('el CTA queda deshabilitado hasta que el correo es válido', async () => {
    renderWithProviders(<SealedRestockForm cardId="c-1" sealedCondition="mint" />, 'es');

    expect(await screen.findByText('Avísame cuando vuelva')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Avisarme' })).toBeDisabled();
    fillEmail();
    expect(screen.getByRole('button', { name: 'Avisarme' })).toBeEnabled();
  });

  it('al suscribir con éxito muestra la confirmación neutra', async () => {
    vi.spyOn(api, 'subscribeSealedRestock').mockResolvedValue({ subscribed: true });
    renderWithProviders(<SealedRestockForm cardId="c-1" sealedCondition="mint" />, 'es');

    fillEmail();
    fireEvent.click(await screen.findByRole('button', { name: 'Avisarme' }));

    expect(await screen.findByText('Listo. Te avisaremos por correo cuando vuelva.')).toBeInTheDocument();
  });
});

describe('SealedRestockForm · flag APAGADO (404 FEATURE_DISABLED)', () => {
  it('si el endpoint responde 404 FEATURE_DISABLED el componente se oculta limpio', async () => {
    vi.spyOn(api, 'subscribeSealedRestock').mockRejectedValue(
      new ApiClientError(404, { code: 'FEATURE_DISABLED', message: 'off' }),
    );
    renderWithProviders(<SealedRestockForm cardId="c-1" sealedCondition="mint" />, 'es');

    fillEmail();
    fireEvent.click(await screen.findByRole('button', { name: 'Avisarme' }));

    await waitFor(() => expect(screen.queryByText('Avísame cuando vuelva')).toBeNull());
  });

  it('un error genérico (no 404) mantiene el formulario y avisa del fallo', async () => {
    vi.spyOn(api, 'subscribeSealedRestock').mockRejectedValue(
      new ApiClientError(500, { code: 'INTERNAL', message: 'boom' }),
    );
    renderWithProviders(<SealedRestockForm cardId="c-1" sealedCondition="mint" />, 'es');

    fillEmail();
    fireEvent.click(await screen.findByRole('button', { name: 'Avisarme' }));

    // El formulario sigue presente (no se oculta) y muestra el error genérico.
    expect(await screen.findByText('No se pudo cargar la información.')).toBeInTheDocument();
    expect(screen.getByText('Avísame cuando vuelva')).toBeInTheDocument();
  });
});
