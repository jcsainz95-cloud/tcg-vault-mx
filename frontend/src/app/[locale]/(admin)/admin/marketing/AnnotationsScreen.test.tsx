/**
 * Candados de las anotaciones del panel (`DESIGN_SYSTEM §MKT-UX.8`, §MKT-UX.16): UX-MKT-12 (aviso de datos personales
 * ANTES de cualquier error; un `422` conserva el texto, `aria-invalid` + foco en el campo) y UX-MKT-13 («Destino» solo
 * con «Promoción»; al cambiar de tipo se vacía y no se envía). Más alta, borrado y vacío.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { ApiClientError } from '@/lib/api-client';
import type { MarketingAnnotationDTO } from '@/types/contract';

const api = vi.hoisted(() => ({
  listMarketingAnnotations: vi.fn(),
  createMarketingAnnotation: vi.fn(),
  updateMarketingAnnotation: vi.fn(),
  deleteMarketingAnnotation: vi.fn(),
}));
vi.mock('@/lib/marketing-api', () => api);

// eslint-disable-next-line import/first
import { AnnotationsScreen } from './AnnotationsScreen';

const ROW: MarketingAnnotationDTO = {
  id: 'n1',
  date: '2026-10-07',
  kind: 'promocion',
  label: 'Historia con enlace',
  destino: 'Perfil',
  createdAt: '2026-10-07T12:00:00Z',
};
const PERIOD = { from: '2026-10-05', to: '2026-10-11' };

beforeEach(() => {
  api.listMarketingAnnotations.mockResolvedValue([ROW]);
  api.createMarketingAnnotation.mockImplementation(async (i) => ({ id: 'n2', createdAt: 'x', destino: null, ...i }));
  api.deleteMarketingAnnotation.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

async function openNew() {
  const u = userEvent.setup();
  renderWithProviders(<AnnotationsScreen period={PERIOD} />);
  await screen.findByTestId('mkt-ann-table');
  await u.click(screen.getByTestId('mkt-ann-new'));
  const dlg = screen.getByTestId('mkt-ann-dialog');
  return { u, dlg: within(dlg) };
}

describe('lista', () => {
  it('pide el rango del periodo; «Todas» lo pide sin rango; la etiqueta se pinta como texto', async () => {
    renderWithProviders(<AnnotationsScreen period={PERIOD} />);
    const table = await screen.findByTestId('mkt-ann-table');
    expect(api.listMarketingAnnotations).toHaveBeenCalledWith({ from: '2026-10-05', to: '2026-10-11' });
    expect(within(table).getByText('Historia con enlace')).toBeInTheDocument();
    expect(within(table).getByText('Promoción')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Todas' }));
    await waitFor(() => expect(api.listMarketingAnnotations).toHaveBeenLastCalledWith({}));
  });

  it('vacío del periodo y vacío total tienen textos distintos', async () => {
    api.listMarketingAnnotations.mockResolvedValue([]);
    renderWithProviders(<AnnotationsScreen period={PERIOD} />);
    expect(await screen.findByTestId('mkt-ann-empty')).toHaveTextContent('Todavía no hay anotaciones en este periodo.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Todas' }));
    await waitFor(() => expect(screen.getByTestId('mkt-ann-empty')).toHaveTextContent('Aún no has marcado ningún día.'));
  });
});

describe('UX-MKT-12 · aviso de datos personales y 422', () => {
  it('el aviso se ve sobre la lista y dentro del formulario ANTES de escribir nada', async () => {
    const { dlg } = await openNew();
    expect(screen.getAllByTestId('mkt-ann-pii').length).toBeGreaterThanOrEqual(2);
    expect(dlg.getByTestId('mkt-ann-pii')).toHaveTextContent('Nada de nombres de clientes, @usuarios, correos');
    expect(dlg.queryByRole('alert')).toBeNull();
  });

  it('un 422 conserva el texto, marca el campo (aria-invalid + aria-describedby) y le pone el foco', async () => {
    api.createMarketingAnnotation.mockRejectedValue(new ApiClientError(422, { code: 'VALIDATION_ERROR', message: 'label no puede…' }));
    const { u, dlg } = await openNew();
    await u.selectOptions(dlg.getByLabelText('Tipo'), 'evento');
    await u.type(dlg.getByLabelText('Etiqueta'), 'Visita de ana@correo.com');
    await u.click(screen.getByTestId('mkt-ann-save'));
    const label = dlg.getByLabelText('Etiqueta') as HTMLInputElement;
    await waitFor(() => expect(label).toHaveAttribute('aria-invalid', 'true'));
    expect(label.value).toBe('Visita de ana@correo.com');
    expect(document.activeElement).toBe(label);
    const err = document.getElementById(label.getAttribute('aria-describedby') as string);
    expect(err).toHaveTextContent('Quita los datos personales (correo, @usuario, teléfono, CURP o RFC) y vuelve a intentarlo.');
    // ⛔ nunca el mensaje crudo del servidor
    expect(screen.queryByText(/label no puede/)).toBeNull();
  });

  it('con `details.field: destino` el error va bajo «Destino»', async () => {
    api.createMarketingAnnotation.mockRejectedValue(new ApiClientError(422, { code: 'VALIDATION_ERROR', message: 'x', details: { field: 'destino' } }));
    const { u, dlg } = await openNew();
    await u.selectOptions(dlg.getByLabelText('Tipo'), 'promocion');
    await u.type(dlg.getByLabelText('Etiqueta'), 'Historia');
    await u.type(dlg.getByLabelText('Destino'), '5512345678');
    await u.click(screen.getByTestId('mkt-ann-save'));
    const dest = dlg.getByLabelText('Destino') as HTMLInputElement;
    await waitFor(() => expect(dest).toHaveAttribute('aria-invalid', 'true'));
    expect(dest.value).toBe('5512345678');
    expect(dlg.getByLabelText('Etiqueta')).not.toHaveAttribute('aria-invalid');
  });
});

describe('UX-MKT-13 · «Destino» solo con «Promoción»', () => {
  it('no existe sin Promoción; al cambiar de tipo se vacía y no se envía', async () => {
    const { u, dlg } = await openNew();
    expect(dlg.queryByLabelText('Destino')).toBeNull();
    await u.selectOptions(dlg.getByLabelText('Tipo'), 'promocion');
    await u.type(dlg.getByLabelText('Destino'), 'Perfil de la tienda');
    await u.selectOptions(dlg.getByLabelText('Tipo'), 'evento');
    expect(dlg.queryByLabelText('Destino')).toBeNull();
    await u.selectOptions(dlg.getByLabelText('Tipo'), 'promocion');
    expect((dlg.getByLabelText('Destino') as HTMLInputElement).value).toBe('');
    await u.selectOptions(dlg.getByLabelText('Tipo'), 'despliegue');
    await u.type(dlg.getByLabelText('Etiqueta'), 'Nueva versión');
    await u.click(screen.getByTestId('mkt-ann-save'));
    await waitFor(() => expect(api.createMarketingAnnotation).toHaveBeenCalledTimes(1));
    expect(api.createMarketingAnnotation.mock.calls[0][0]).toEqual({ date: '2026-10-05', kind: 'despliegue', label: 'Nueva versión' });
  });

  it('editar una promoción y pasarla a evento manda `destino: ""` para borrarlo (PATCH)', async () => {
    api.updateMarketingAnnotation.mockImplementation(async (_id, i) => ({ ...ROW, ...i, destino: null }));
    const u = userEvent.setup();
    renderWithProviders(<AnnotationsScreen period={PERIOD} />);
    const table = await screen.findByTestId('mkt-ann-table');
    await u.click(within(table).getByRole('button', { name: 'Editar' }));
    const dlg = within(screen.getByTestId('mkt-ann-dialog'));
    await u.selectOptions(dlg.getByLabelText('Tipo'), 'evento');
    await u.click(screen.getByTestId('mkt-ann-save'));
    await waitFor(() => expect(api.updateMarketingAnnotation).toHaveBeenCalledWith('n1', { date: '2026-10-07', kind: 'evento', label: 'Historia con enlace', destino: '' }));
    await waitFor(() => expect(screen.getByTestId('mkt-ann-status')).toHaveTextContent('Anotación guardada.'));
  });
});

describe('borrar', () => {
  it('confirmación con fecha y etiqueta; tras borrar anuncia «Anotación borrada.»', async () => {
    const u = userEvent.setup();
    renderWithProviders(<AnnotationsScreen period={PERIOD} />);
    const table = await screen.findByTestId('mkt-ann-table');
    await u.click(within(table).getByRole('button', { name: 'Borrar' }));
    const dlg = within(screen.getByTestId('mkt-ann-delete-dialog'));
    expect(dlg.getByRole('heading', { name: '¿Borrar esta anotación?' })).toBeInTheDocument();
    expect(dlg.getByText('Historia con enlace')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mkt-ann-delete-confirm'));
    await waitFor(() => expect(api.deleteMarketingAnnotation).toHaveBeenCalledWith('n1'));
    await waitFor(() => expect(screen.getByTestId('mkt-ann-status')).toHaveTextContent('Anotación borrada.'));
  });

  it('un 404 cierra y avisa que ya no existe', async () => {
    api.deleteMarketingAnnotation.mockRejectedValue(new ApiClientError(404, { code: 'NOT_FOUND', message: 'x' }));
    const u = userEvent.setup();
    renderWithProviders(<AnnotationsScreen period={PERIOD} />);
    const table = await screen.findByTestId('mkt-ann-table');
    await u.click(within(table).getByRole('button', { name: 'Borrar' }));
    await u.click(screen.getByTestId('mkt-ann-delete-confirm'));
    await waitFor(() => expect(screen.getByTestId('mkt-ann-status')).toHaveTextContent('Esa anotación ya no existe. Se actualizó la lista.'));
    expect(screen.queryByTestId('mkt-ann-delete-dialog')).toBeNull();
  });
});
