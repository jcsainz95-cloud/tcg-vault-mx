import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { mockSettings } from '@/lib/mock/fixtures';
import { BuylistCycleSection } from './BuylistCycleSection';

/**
 * 💰 rev BSD-1 — los dos diales del cierre sin guía en M10 (DESIGN_SYSTEM §BSD-UX.6e · contrato §BSD.9).
 * Subgrupo PROPIO después de «Plazos (días hábiles)», con la nota de que son naturales y aplican también a las en curso;
 * `PUT` con solo la clave tocada (M10-BL-2); el `422` por clave pinta SU regla (⛔ el texto del servidor).
 */
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getSettings').mockResolvedValue({ ...mockSettings, buylistGuideCloseCalendarDays: 7, buylistGuideWarnDaysBeforeClose: 2 });
});

describe('§BSD-UX.6e · «Cierre sin guía (días naturales)»', () => {
  it('subgrupo propio, después de «Plazos (días hábiles)», con su nota; los dos diales con el valor del GET', async () => {
    renderWithProviders(<BuylistCycleSection />, 'es');
    const close = await screen.findByTestId('m10-cycle-buylistGuideCloseCalendarDays');
    expect(close).toHaveValue('7');
    expect(screen.getByTestId('m10-cycle-buylistGuideWarnDaysBeforeClose')).toHaveValue('2');
    expect(screen.getByLabelText('Cierre de una aceptada sin guía')).toBe(close);
    expect(screen.getByLabelText('Aviso antes del cierre sin guía')).toBeInTheDocument();
    const headings = within(screen.getByTestId('m10-buylist-cycle')).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings.indexOf('Cierre sin guía (días naturales)')).toBe(headings.indexOf('Plazos (días hábiles)') + 1);
    expect(screen.getByTestId('m10-cycle-guide-close-note')).toHaveTextContent(
      'Cuentan sábados y domingos. A diferencia del resto del grupo, aplican también a las solicitudes en curso: se leen cada día.',
    );
  });

  it('editar uno ⇒ `PUT` con SOLO esa clave', async () => {
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<BuylistCycleSection />, 'es');
    fireEvent.change(await screen.findByTestId('m10-cycle-buylistGuideWarnDaysBeforeClose'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('m10-cycle-save'));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ buylistGuideWarnDaysBeforeClose: 0 }));
  });

  it('`422` por clave ⇒ SU regla, ⛔ el texto del servidor', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    vi.spyOn(api, 'updateSettings').mockRejectedValue(
      new ApiClientError(422, { code: 'VALIDATION_ERROR', message: 'buylistGuideCloseCalendarDays must be <= 60', details: { errors: { buylistGuideCloseCalendarDays: 'max' } } }),
    );
    renderWithProviders(<BuylistCycleSection />, 'es');
    fireEvent.change(await screen.findByTestId('m10-cycle-buylistGuideCloseCalendarDays'), { target: { value: '99' } });
    fireEvent.click(screen.getByTestId('m10-cycle-save'));
    expect(await screen.findByText('Número entero, de 1 a 60.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('must be <= 60');
  });
});
