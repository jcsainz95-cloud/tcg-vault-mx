import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { mockCreateBatch, reserveMockDiscount, resetMockDiscounts } from '@/lib/mock/discounts';

const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/admin/codes',
}));

// eslint-disable-next-line import/first
import { DiscountCodesView } from './DiscountCodesView';
// eslint-disable-next-line import/first
import { DiscountCodeForm } from './DiscountCodeForm';
// eslint-disable-next-line import/first
import { DiscountReportView } from './DiscountReportView';
// eslint-disable-next-line import/first
import DiscountCodesPage from './page';

/**
 * Panel «Códigos de descuento» (§DSC-UX.5/.6, contrato §DSC.7) contra el simulador: lista con filtros y lote plegado,
 * pausar suelto (sin confirmación) y lote (con confirmación), crear, editar con lo bloqueado tras el primer uso, reporte.
 */

beforeEach(() => {
  resetMockDiscounts();
  push.mockReset();
});
afterEach(() => window.localStorage.removeItem('tcg.role'));

describe('lista', () => {
  it('h1 = rótulo del menú; filtros por estado del servidor; un lote es UNA fila con «n de N usados», plegable', async () => {
    mockCreateBatch({ prefix: 'FERIA', quantity: 3, kind: 'fixed_amount', amountCents: 10000 });
    renderWithProviders(<DiscountCodesView />, 'es');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Códigos de descuento');
    const rows = await screen.findAllByTestId('code-list-row');
    const sept = rows.find((r) => r.textContent?.includes('SEPT10'))!;
    expect(sept).toHaveTextContent('10 % · tope MX$500.00');
    expect(sept).toHaveTextContent('Activo');
    expect(sept).toHaveTextContent('2 · 1 · 100'); // usados · apartados · límite (del servidor)
    const batch = screen.getByTestId('batch-list-row');
    expect(batch).toHaveTextContent('lote de 3');
    expect(batch).toHaveTextContent('0 de 3 usados');
    // Los 3 códigos del lote NO salen sueltos en la lista.
    expect(rows.some((r) => r.textContent?.startsWith('FERIA-'))).toBe(false);
    await userEvent.setup().click(within(batch).getByRole('button', { name: 'Ver códigos del lote FERIA' }));
    await waitFor(() => expect(within(batch).getAllByText(/^FERIA-/)).toHaveLength(3));

    await userEvent.setup().click(screen.getByRole('button', { name: 'Pausados' }));
    await waitFor(() => expect(screen.getAllByTestId('code-list-row').map((r) => r.textContent)).toEqual([expect.stringContaining('BOVEDA10')]));
    expect(screen.getByRole('button', { name: 'Pausados' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Vencidos' }));
    await waitFor(() => expect(screen.getAllByTestId('code-list-row').map((r) => r.textContent)).toEqual([expect.stringContaining('VERANO15')]));
  });

  it('pausar un código suelto: un clic, sin confirmación, con aviso; pausar un LOTE pide confirmación (D6)', async () => {
    mockCreateBatch({ prefix: 'FERIA', quantity: 3, kind: 'fixed_amount', amountCents: 10000 });
    const user = userEvent.setup();
    renderWithProviders(<DiscountCodesView />, 'es');
    const sept = (await screen.findAllByTestId('code-list-row')).find((r) => r.textContent?.includes('SEPT10'))!;
    await user.click(within(sept).getByRole('button', { name: 'Pausar' }));
    expect(await screen.findByText('SEPT10 pausado. Ya no aplica a pagos nuevos.')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() =>
      expect(screen.getAllByTestId('code-list-row').find((r) => r.textContent?.includes('SEPT10'))).toHaveTextContent('Pausado'),
    );

    await user.click(within(screen.getByTestId('batch-list-row')).getByRole('button', { name: 'Pausar lote' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('¿Pausar el lote FERIA?');
    expect(dialog).toHaveTextContent('Se pausan sus 3 códigos sin usar.');
    await user.click(within(dialog).getByRole('button', { name: 'Pausar lote' }));
    await waitFor(() => expect(screen.getByTestId('batch-list-row')).toHaveTextContent('Pausado'));
    // Reanudar nunca pide confirmación.
    await user.click(within(screen.getByTestId('batch-list-row')).getByRole('button', { name: 'Reanudar lote' }));
    await waitFor(() => expect(screen.getByTestId('batch-list-row')).toHaveTextContent('Activo'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('DL7: como operador, la página es el acceso denegado y la API responde 403', async () => {
    window.localStorage.setItem('tcg.role', 'vault_operator');
    renderWithProviders(<DiscountCodesPage />, 'es');
    expect(await screen.findByText('Acceso restringido')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Códigos de descuento' })).toBeNull();
  });
});

describe('crear y editar', () => {
  it('crea un 10 % con tope y mínimo; las cuatro casillas marcadas = todos (`[]`); vuelve a la lista', async () => {
    const api = await import('@/lib/api');
    const spy = vi.spyOn(api, 'createDiscountCode');
    const user = userEvent.setup();
    renderWithProviders(<DiscountCodeForm />, 'es');
    await user.type(screen.getByLabelText('Texto del código'), 'otono 10');
    expect(screen.getByLabelText('Texto del código')).toHaveValue('OTONO10');
    await user.type(screen.getByLabelText('Valor (%)'), '10');
    await user.type(screen.getByLabelText('Tope en pesos (opcional)'), '500');
    await user.type(screen.getByLabelText('Mínimo de compra (opcional)'), '1000');
    await user.click(screen.getByRole('button', { name: 'Guardar código' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/codes'));
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'OTONO10', kind: 'percent', percentPct: 10, maxDiscountCents: 50000, minSubtotalCents: 100000, productScopes: [], destinations: [] }),
    );
    spy.mockRestore();
  });

  it('409 DISCOUNT_CODE_TAKEN ⇒ error bajo «Texto del código»; sin tipos de producto ⇒ no se guarda', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DiscountCodeForm />, 'es');
    await user.type(screen.getByLabelText('Texto del código'), 'SEPT10');
    await user.type(screen.getByLabelText('Valor (%)'), '5');
    await user.click(screen.getByRole('button', { name: 'Guardar código' }));
    expect(await screen.findByText('Ese texto ya existe (también entre los pausados). Elige otro.')).toBeInTheDocument();
    for (const s of ['Cartas sueltas', 'Cartas gradeadas', 'Sellado', 'Accesorios y energías']) await user.click(screen.getByLabelText(s));
    await user.clear(screen.getByLabelText('Texto del código'));
    await user.type(screen.getByLabelText('Texto del código'), 'NUEVO99');
    await user.click(screen.getByRole('button', { name: 'Guardar código' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Marca al menos un tipo de producto.');
    expect(push).not.toHaveBeenCalled();
  });

  it('912 / D7: con usos, tipo, valor, tope, mínimo y filtros van bloqueados con aviso; fin y usos totales se editan', async () => {
    const api = await import('@/lib/api');
    const patch = vi.spyOn(api, 'patchDiscountCode');
    const user = userEvent.setup();
    renderWithProviders(<DiscountCodeForm id="dsc-sept10" />, 'es');
    expect(await screen.findByText(/Este código ya tiene 2 usos y 1 apartados ahora\./)).toBeInTheDocument();
    for (const label of ['Valor (%)', 'Tope en pesos (opcional)', 'Mínimo de compra (opcional)', 'Usos por cliente', 'Texto del código']) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    expect(screen.getByLabelText('Sellado')).toBeDisabled();
    expect(screen.getByLabelText('Termina (opcional)')).toBeEnabled();
    expect(screen.getByLabelText('Usos totales (opcional)')).toBeEnabled();
    expect(screen.getByText('Mínimo 3 (los ya consumidos).')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Usos totales (opcional)'));
    await user.type(screen.getByLabelText('Usos totales (opcional)'), '1');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Los usos totales no pueden bajar de 3.')).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('Usos totales (opcional)'));
    await user.type(screen.getByLabelText('Usos totales (opcional)'), '150');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('dsc-sept10', { endsAt: null, maxTotalUses: 150 }));
    expect(await screen.findByText('Código guardado.')).toBeInTheDocument();
    patch.mockRestore();
  });
});

describe('reporte', () => {
  it('tarjetas y filas son las del servidor; «Un reembolso no devuelve el uso.»; un código sin usos = ceros, no error', async () => {
    reserveMockDiscount({ codeId: 'dsc-nuevo20', customer: 'email:x@y.mx', kind: 'order', folio: 'TCG-777', discountCents: 20000, shippingWaivedCents: 0, totalCents: 100000, consumed: true });
    renderWithProviders(<DiscountReportView kind="code" id="dsc-nuevo20" />, 'es');
    expect(await screen.findByText('Descuento dado')).toBeInTheDocument();
    expect(screen.getAllByText('MX$200.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Un reembolso no devuelve el uso.')).toBeInTheDocument();
    expect(screen.getByText('TCG-777')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Reporte · NUEVO20');
  });
});
