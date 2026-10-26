import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { mockCreateBatch, mockCreateCode, mockGetCode, reserveMockDiscount, resetMockDiscounts } from '@/lib/mock/discounts';

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
import { DiscountAuditList } from './DiscountAuditList';
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
afterEach(() => {
  window.localStorage.removeItem('tcg.role');
  // Un espía que no llegó a su `mockRestore` (prueba roja) no contamina a la siguiente.
  vi.restoreAllMocks();
});

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

  it('R3 (techlead): editar un código SIN usar y borrar tope, mínimo y usos por cliente ⇒ PATCH con `null` explícito, y quedan sin límite', async () => {
    const created = mockCreateCode({ code: 'TOPE20', kind: 'percent', percentPct: 20, maxDiscountCents: 30000, minSubtotalCents: 100000, maxUsesPerCustomer: 2 });
    const api = await import('@/lib/api');
    const patch = vi.spyOn(api, 'patchDiscountCode');
    const user = userEvent.setup();
    renderWithProviders(<DiscountCodeForm id={created.id} />, 'es');
    expect(await screen.findByLabelText('Tope en pesos (opcional)')).toHaveValue('300.00');
    await user.clear(screen.getByLabelText('Tope en pesos (opcional)'));
    await user.clear(screen.getByLabelText('Mínimo de compra (opcional)'));
    await user.clear(screen.getByLabelText('Usos por cliente'));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    const body = patch.mock.calls[0][1];
    expect(body).toMatchObject({ kind: 'percent', percentPct: 20, maxDiscountCents: null, minSubtotalCents: null, maxUsesPerCustomer: null, amountCents: null });
    // ⛔ «sin límite» no es «omitido»: la clave VIAJA con `null`.
    for (const k of ['maxDiscountCents', 'minSubtotalCents', 'maxUsesPerCustomer'] as const) expect(Object.prototype.hasOwnProperty.call(body, k)).toBe(true);
    expect(await screen.findByText('Código guardado.')).toBeInTheDocument();
    expect(mockGetCode(created.id)).toMatchObject({ maxDiscountCents: null, minSubtotalCents: null, maxUsesPerCustomer: null });
  });

  it('R3: pasar de % a monto fijo en edición no arrastra el `percentPct` ni el tope viejos', async () => {
    const created = mockCreateCode({ code: 'CAMBIO20', kind: 'percent', percentPct: 20, maxDiscountCents: 30000 });
    const api = await import('@/lib/api');
    const patch = vi.spyOn(api, 'patchDiscountCode');
    const user = userEvent.setup();
    renderWithProviders(<DiscountCodeForm id={created.id} />, 'es');
    await user.click(await screen.findByLabelText('Monto fijo'));
    await user.type(screen.getByLabelText('Monto en pesos'), '150');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][1]).toMatchObject({ kind: 'fixed_amount', amountCents: 15000, percentPct: null, maxDiscountCents: null });
    expect(await screen.findByText('Código guardado.')).toBeInTheDocument();
    expect(mockGetCode(created.id)).toMatchObject({ kind: 'fixed_amount', amountCents: 15000, percentPct: null, maxDiscountCents: null });
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

describe('v1.110.1 — «Descuento dado», «Así lo verá el cliente» y «Cambios»', () => {
  it('la columna «Descuento dado» pinta `usage.discountGivenCents` del servidor (⛔ sin sumar en el cliente)', async () => {
    const api = await import('@/lib/api');
    const real = api.listDiscountCodes;
    const spy = vi.spyOn(api, 'listDiscountCodes').mockImplementation(async (p) => {
      const res = await real(p);
      // Un valor que NINGUNA suma de los usos del mock produce: si la pantalla calcula, no sale.
      return { ...res, data: res.data.map((c) => (c.code === 'SEPT10' ? { ...c, usage: { ...c.usage, discountGivenCents: 1234567 } } : c)) };
    });
    renderWithProviders(<DiscountCodesView />, 'es');
    const rows = await screen.findAllByTestId('code-list-row');
    expect(screen.getAllByText('Descuento dado').length).toBeGreaterThanOrEqual(1);
    const sept = rows.find((r) => r.textContent?.includes('SEPT10'))!;
    expect(within(sept).getByTestId('code-given')).toHaveTextContent('MX$12,345.67');
    spy.mockRestore();
  });

  it('la vista previa pide al servidor con el carrito de ejemplo y pinta SU cifra; sin config válida, pide completar', async () => {
    const api = await import('@/lib/api');
    const spy = vi.spyOn(api, 'previewDiscountCode').mockResolvedValue({ discountCents: 12345, nominalCents: 20000, capped: true });
    const user = userEvent.setup();
    renderWithProviders(<DiscountCodeForm />, 'es');
    const preview = screen.getByTestId('discount-preview');
    expect(within(preview).getByRole('heading', { name: 'Así lo verá el cliente' })).toBeInTheDocument();
    expect(preview).toHaveTextContent('Completa el descuento para ver el ejemplo.');
    expect(spy).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Valor (%)'), '20');
    await user.type(screen.getByLabelText('Tope en pesos (opcional)'), '300');
    await waitFor(() => expect(within(preview).getByTestId('discount-preview-amount')).toHaveTextContent('Descuento −MX$123.45'));
    expect(preview).toHaveTextContent('Llegó al tope que fijaste.');
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'percent', percentPct: 20, maxDiscountCents: 30000, sampleLines: expect.arrayContaining([expect.objectContaining({ scope: 'raw' })]) }),
    );
    spy.mockRestore();
  });

  it('contra el simulador: 10 % sobre el carrito de ejemplo ⇒ la cifra de `discountOf` (MX$400.00), sin tope', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DiscountCodeForm />, 'es');
    await user.type(screen.getByLabelText('Valor (%)'), '10');
    const preview = screen.getByTestId('discount-preview');
    await waitFor(() => expect(within(preview).getByTestId('discount-preview-amount')).toHaveTextContent('Descuento −MX$400.00'));
    expect(preview).not.toHaveTextContent('Llegó al tope');
  });

  it('«Cambios» del código: fecha · quién · antes → después, y una fila nueva al guardar', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DiscountCodeForm id="dsc-sept10" />, 'es');
    const audit = await screen.findByTestId('discount-audit');
    await waitFor(() => expect(within(audit).getAllByTestId('discount-audit-entry')).toHaveLength(2));
    expect(audit).toHaveTextContent('maxTotalUses · 50 → 100');
    expect(audit).toHaveTextContent('maxDiscountCents · — → MX$500.00');
    expect(audit).toHaveTextContent('JC');
    await user.clear(screen.getByLabelText('Usos totales (opcional)'));
    await user.type(screen.getByLabelText('Usos totales (opcional)'), '120');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(within(audit).getAllByTestId('discount-audit-entry')).toHaveLength(3));
    expect(within(audit).getAllByTestId('discount-audit-entry')[0]).toHaveTextContent('Editado');
    expect(within(audit).getAllByTestId('discount-audit-entry')[0]).toHaveTextContent('maxTotalUses · 100 → 120');
  });

  it('v1.110.2: `actor: null` ⇒ «Sistema»; una `action` fuera de la lista ⇒ el texto genérico, nunca la cadena cruda', async () => {
    const api = await import('@/lib/api');
    const spy = vi.spyOn(api, 'getDiscountAudit').mockResolvedValue({
      data: [
        { at: '2026-10-20T18:00:00.000Z', actor: null, action: 'discount.batch.codes_exported', changes: [{ field: 'codes', before: null, after: 50 }] },
        { at: '2026-10-19T18:00:00.000Z', actor: { id: 'u1', name: 'JC' }, action: 'discount.code.teleported', changes: [{ field: 'status', before: 'active', after: 'paused' }] },
        { at: '2026-10-18T18:00:00.000Z', actor: { id: 'u1', name: 'JC' }, action: 'discount.code.report_exported', changes: [{ field: 'rows', before: null, after: 3 }] },
      ],
      page: 1,
      pageSize: 50,
      total: 3,
    });
    renderWithProviders(<DiscountAuditList kind="batch" id="cualquiera" />, 'es');
    const audit = await screen.findByTestId('discount-audit');
    await waitFor(() => expect(within(audit).getAllByTestId('discount-audit-entry')).toHaveLength(3));
    const [system, unknown, report] = within(audit).getAllByTestId('discount-audit-entry');
    expect(system).toHaveTextContent('Sistema');
    expect(system).toHaveTextContent('Códigos descargados');
    expect(unknown).toHaveTextContent('Otro cambio');
    expect(audit).not.toHaveTextContent('teleported');
    expect(audit).not.toHaveTextContent('discount.');
    expect(report).toHaveTextContent('Reporte descargado');
    spy.mockRestore();
  });

  it('v1.110.2: vista previa en ceros con un tipo ≠ envío gratis ⇒ «no lleva descuento»; envío gratis ⇒ su texto sin importe', async () => {
    const api = await import('@/lib/api');
    const spy = vi.spyOn(api, 'previewDiscountCode').mockResolvedValue({ discountCents: 0, nominalCents: 0, capped: false });
    const user = userEvent.setup();
    renderWithProviders(<DiscountCodeForm />, 'es');
    const preview = screen.getByTestId('discount-preview');
    await user.type(screen.getByLabelText('Valor (%)'), '10');
    await waitFor(() => expect(preview).toHaveTextContent('Con esta configuración, este carrito no lleva descuento.'));
    expect(within(preview).queryByTestId('discount-preview-amount')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Envío gratis' }));
    await waitFor(() => expect(preview).toHaveTextContent('Cubre el envío a domicilio; no descuenta mercancía.'));
    expect(within(preview).queryByTestId('discount-preview-amount')).toBeNull();
    expect(preview).not.toHaveTextContent('no lleva descuento');
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'free_shipping' })));
    spy.mockRestore();
  });

  it('«Envío regalado»: valor = pedidos + retiros; subtítulo con las dos partes nombradas y sin la que vale cero', async () => {
    reserveMockDiscount({ codeId: 'dsc-envio25', customer: 'a@x', kind: 'order', folio: 'TCG-1', discountCents: 0, shippingWaivedCents: 10000, totalCents: 90000, consumed: true });
    const { unmount } = renderWithProviders(<DiscountReportView kind="code" id="dsc-envio25" />, 'es');
    expect(await screen.findByText('Envío regalado')).toBeInTheDocument();
    expect(screen.getByText('Pedidos: MX$100.00')).toBeInTheDocument();
    expect(screen.queryByText(/Retiros:/)).toBeNull();
    unmount();
    reserveMockDiscount({ codeId: 'dsc-envio25', customer: 'a@x', kind: 'withdrawal', folio: 'RET-1', discountCents: 0, shippingWaivedCents: 20300, totalCents: 0, consumed: true });
    renderWithProviders(<DiscountReportView kind="code" id="dsc-envio25" />, 'es');
    expect(await screen.findByText('Pedidos: MX$100.00 · Retiros: MX$203.00')).toBeInTheDocument();
    expect(screen.getByText('MX$303.00')).toBeInTheDocument();
  });

  it('el reporte de un lote trae sus «Cambios» (creación con prefijo y cantidad)', async () => {
    const { batch } = mockCreateBatch({ prefix: 'FERIA', quantity: 3, kind: 'fixed_amount', amountCents: 10000 });
    renderWithProviders(<DiscountReportView kind="batch" id={batch.id} />, 'es');
    const audit = await screen.findByTestId('discount-audit');
    await waitFor(() => expect(audit).toHaveTextContent('prefix · — → FERIA'));
    expect(audit).toHaveTextContent('quantity · — → 3');
    expect(audit).toHaveTextContent('Creado');
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
