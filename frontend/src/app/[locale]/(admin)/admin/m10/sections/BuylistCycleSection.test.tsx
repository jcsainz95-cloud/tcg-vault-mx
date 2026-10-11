import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockSettings } from '@/lib/mock/fixtures';
import { formatMoneyCents } from '@/lib/format';
import es from '../../../../../../../messages/es.json';
import { BuylistCycleSection } from './BuylistCycleSection';

/**
 * F-9 · DESIGN_SYSTEM §60.7 b · contrato §E2E-ADM.3/.4 (M10-BL-1…4).
 * - **M10-BL-1**: los diez nombres de la tabla de §M10 se pintan y son editables. ⚠️ La lista se LEE de la tabla del
 *   contrato (`docs/API_CONTRACT.md`, §M10 «DIEZ diales»), no del componente.
 * - **M10-BL-2**: editar uno manda un `PUT` con SOLO esa clave.
 * - **M10-BL-3**: ni «umbral de guía» ni «recorte material».
 * - **M10-BL-4**: el `422` cruzado pinta el copy con las tres cifras de `details`.
 * - **M10-UI**: el `422` por clave NO pinta el texto del servidor: marca el campo y pinta SU regla.
 */
const CONTRACT = readFileSync(resolve(__dirname, '../../../../../../../../docs/API_CONTRACT.md'), 'utf8');
function tenDialsFromContract(): string[] {
  const start = CONTRACT.indexOf('DIEZ** diales nuevos del CICLO DE ADQUISICIÓN DEL BUYLIST');
  expect(start, 'no se encontró la tabla «DIEZ diales» de §M10').toBeGreaterThan(0);
  const table = CONTRACT.slice(start, start + 8000);
  const rows = [...table.matchAll(/^\s*\|\s*\*{0,2}`(buylist[A-Za-z]+)`\*{0,2}\s*\|/gm)].map((m) => m[1]);
  // La fila tachada (~~`buylistShippingThresholdCents`~~) no casa con el patrón: está RETIRADA (D31).
  return [...new Set(rows)];
}
const L = es.admin.m10.buylistCycle.labels as Record<string, string>;
const R = es.admin.m10.buylistCycle.rule as Record<string, string>;

beforeEach(() => vi.restoreAllMocks());

describe('§60.7 b · «Ciclo de venta» en M10', () => {
  it('M10-BL-1 · los DIEZ diales de la tabla del contrato se pintan y son editables (con el valor del GET)', async () => {
    const keys = tenDialsFromContract();
    expect(keys).toHaveLength(10);
    renderWithProviders(<BuylistCycleSection />, 'es');
    await screen.findByTestId('m10-buylist-cycle');
    await screen.findByTestId('m10-cycle-buylistMinimumRequestCents');
    for (const k of keys) {
      const input = screen.getByTestId(`m10-cycle-${k}`) as HTMLInputElement;
      expect(input).toBeEnabled();
      expect(screen.getByLabelText(L[k])).toBe(input);
    }
    expect((screen.getByTestId('m10-cycle-buylistMinimumRequestCents') as HTMLInputElement).value).toBe(
      String((mockSettings.buylistMinimumRequestCents ?? 0) / 100),
    );
  });

  it('M10-BL-2 · editar UNO manda un PUT con SOLO esa clave (pesos → centavos)', async () => {
    const spy = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<BuylistCycleSection />, 'es');
    fireEvent.change(await screen.findByTestId('m10-cycle-buylistShippingFeeCents'), { target: { value: '190' } });
    fireEvent.click(screen.getByTestId('m10-cycle-save'));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith({ buylistShippingFeeCents: 19000 });
  });

  it('M10-BL-3 · ni «umbral de guía» ni «recorte material» en la sección', async () => {
    renderWithProviders(<BuylistCycleSection />, 'es');
    const sec = await screen.findByTestId('m10-buylist-cycle');
    await within(sec).findByTestId('m10-cycle-buylistVariantPositionCap');
    expect(sec.textContent).not.toMatch(/umbral de gu[ií]a|recorte material/i);
  });

  it('M10-BL-4 · 422 cruzado ⇒ los tres montos marcados y el copy con las cifras de `details`', async () => {
    vi.spyOn(api, 'updateSettings').mockRejectedValue(
      new ApiClientError(422, {
        code: 'VALIDATION_ERROR',
        message: 'cross rule',
        details: { rule: 'buylist_fee_plus_min_net_le_min_request', shippingFeeCents: 40000, minimumOfferNetCents: 20000, minimumRequestCents: 50000 },
      }),
    );
    renderWithProviders(<BuylistCycleSection />, 'es');
    fireEvent.change(await screen.findByTestId('m10-cycle-buylistShippingFeeCents'), { target: { value: '400' } });
    fireEvent.click(screen.getByTestId('m10-cycle-save'));
    const m = (c: number) => formatMoneyCents(c, 'es');
    expect(await screen.findByTestId('m10-cycle-error')).toHaveTextContent(
      `La guía que se descuenta (${m(40000)}) más el mínimo que recibe el vendedor (${m(20000)}) no puede pasar del mínimo para cotizar (${m(50000)}). No se guardó nada.`,
    );
    for (const k of ['buylistShippingFeeCents', 'buylistMinimumOfferNetCents', 'buylistMinimumRequestCents']) {
      expect(screen.getByTestId(`m10-cycle-${k}`)).toHaveAttribute('aria-invalid', 'true');
    }
  });

  it('M10-UI · 422 por clave ⇒ el campo marcado pinta SU regla; ⛔ nunca el texto del servidor', async () => {
    vi.spyOn(api, 'updateSettings').mockRejectedValue(
      new ApiClientError(422, {
        code: 'VALIDATION_ERROR',
        message: 'invalid',
        details: { errors: { buylistShipDeadlineBusinessDays: 'must be an integer >= 1 (got 0)' } },
      }),
    );
    renderWithProviders(<BuylistCycleSection />, 'es');
    fireEvent.change(await screen.findByTestId('m10-cycle-buylistShipDeadlineBusinessDays'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('m10-cycle-save'));
    expect(await screen.findByTestId('m10-cycle-error')).toHaveTextContent('Revisa los campos marcados. No se guardó nada.');
    expect(screen.getByTestId('m10-cycle-buylistShipDeadlineBusinessDays')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(R.buylistShipDeadlineBusinessDays)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('must be an integer');
  });

  it('el aviso preventivo de la regla cruzada no bloquea el botón', async () => {
    renderWithProviders(<BuylistCycleSection />, 'es');
    fireEvent.change(await screen.findByTestId('m10-cycle-buylistShippingFeeCents'), { target: { value: '400' } });
    expect(await screen.findByText(/no puede pasar del mínimo para cotizar/)).toBeInTheDocument();
    expect(screen.getByTestId('m10-cycle-save')).toBeEnabled();
  });
});
