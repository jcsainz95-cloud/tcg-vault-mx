import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import type { GradedEstimateConfigDTO } from '@/types/contract';
import { ApiClientError } from '@/lib/api-client';
import { GradedEstimatesSection } from './GradedEstimatesSection';

/**
 * D2 (techlead) / criterio **110(e)**: el dueño tiene que poder **añadir, quitar y editar** los
 * escalones de costo de gradeo **desde el back-office**, sin redeploy y con auditoría. Estos tests
 * fijan lo que hace que el editor sea seguro: los invariantes del contrato (contigüidad, escalón
 * final abierto, `costMxnCents ≥ 1`) se cumplen **por construcción** y el 422 del servidor se
 * muestra **accionable**, no como «error genérico».
 */
/** Seed de §O.2.1 en centavos, servido FRESCO en cada test (el mock del módulo es mutable). */
const seed = (): GradedEstimateConfigDTO => ({
  enabled: true,
  grades: ['10', '9'],
  highlightGrades: ['10'],
  freshnessDays: 30,
  minUpsidePct: 30,
  gradingCostTiers: [
    { minValueMxnCents: 0, maxValueMxnCents: 200_000, costMxnCents: 70_000 },
    { minValueMxnCents: 200_000, maxValueMxnCents: 500_000, costMxnCents: 110_000 },
    { minValueMxnCents: 500_000, maxValueMxnCents: 1_000_000, costMxnCents: 180_000 },
    { minValueMxnCents: 1_000_000, maxValueMxnCents: 2_000_000, costMxnCents: 300_000 },
    { minValueMxnCents: 2_000_000, maxValueMxnCents: 5_000_000, costMxnCents: 600_000 },
    { minValueMxnCents: 5_000_000, maxValueMxnCents: null, costMxnCents: 1_200_000 },
  ],
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getGradedEstimateConfig').mockResolvedValue(seed());
});

const rowsOf = () => screen.getAllByLabelText(/Costo de gradeo del escalón/);

describe('GradedEstimatesSection · escalones de costo de gradeo (§M2 / §O.2.1)', () => {
  it('carga la tabla del servidor: primer escalón desde MX$0 y último ABIERTO', async () => {
    renderWithProviders(<GradedEstimatesSection />, 'es');

    expect(await screen.findByText(/Escalones de costo de gradeo/)).toBeInTheDocument();
    // Seed de §O.2.1: 6 escalones, el primero desde $0 (cobertura desde cero) y el último abierto.
    expect(rowsOf()).toHaveLength(6);
    expect(screen.getByText('MX$0.00')).toBeInTheDocument();
    expect(screen.getByText('En adelante')).toBeInTheDocument();
    // El costo se edita en pesos (70000 centavos → 700).
    expect((rowsOf()[0] as HTMLInputElement).value).toBe('700');
  });

  it('el `min` NO es editable: se deriva del fin del escalón anterior (contigüidad por construcción)', async () => {
    renderWithProviders(<GradedEstimatesSection />, 'es');
    await screen.findByText(/Escalones de costo de gradeo/);

    // No existe campo «desde»: I3/I4 son irrompibles desde esta UI.
    expect(screen.queryByLabelText(/Inicio del escalón/)).not.toBeInTheDocument();
    const end = screen.getByLabelText('Fin del escalón 1') as HTMLInputElement;
    expect(end.value).toBe('2000');
    // Mover el fin del escalón 1 mueve el inicio del 2: no puede abrirse un hueco.
    fireEvent.change(end, { target: { value: '2500' } });
    expect(screen.getByText('MX$2,500.00')).toBeInTheDocument();
  });

  it('añadir un escalón lo inserta ANTES del abierto; el último sigue abierto (I5)', async () => {
    renderWithProviders(<GradedEstimatesSection />, 'es');
    await screen.findByText(/Escalones de costo de gradeo/);

    fireEvent.click(screen.getByRole('button', { name: /Añadir escalón/ }));
    expect(rowsOf()).toHaveLength(7);
    expect(screen.getAllByText('En adelante')).toHaveLength(1);
  });

  it('quitar escalones fusiona sin dejar huecos, y el ÚLTIMO no se puede quitar (I1)', async () => {
    renderWithProviders(<GradedEstimatesSection />, 'es');
    await screen.findByText(/Escalones de costo de gradeo/);

    fireEvent.click(screen.getByRole('button', { name: 'Quitar el escalón 1' }));
    expect(rowsOf()).toHaveLength(5);
    // El nuevo primer escalón sigue arrancando en MX$0 y el último sigue abierto.
    expect(screen.getByText('MX$0.00')).toBeInTheDocument();
    expect(screen.getAllByText('En adelante')).toHaveLength(1);

    // Se quitan todos menos uno: el botón de quitar queda deshabilitado (tabla nunca vacía).
    for (const label of ['Quitar el escalón 1', 'Quitar el escalón 1', 'Quitar el escalón 1', 'Quitar el escalón 1']) {
      fireEvent.click(screen.getByRole('button', { name: label }));
    }
    expect(rowsOf()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Quitar el escalón 1' })).toBeDisabled();
  });

  it('money-safe: un costo en 0 (o vacío) marca la fila y BLOQUEA el guardado', async () => {
    renderWithProviders(<GradedEstimatesSection />, 'es');
    await screen.findByText(/Escalones de costo de gradeo/);

    fireEvent.change(rowsOf()[0], { target: { value: '0' } });
    expect(screen.getByText(/El costo debe ser al menos MX\$0\.01/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();

    fireEvent.change(rowsOf()[0], { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();

    fireEvent.change(rowsOf()[0], { target: { value: '750' } });
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
  });

  it('un fin de escalón menor que su inicio marca la fila y bloquea (no llega al servidor)', async () => {
    renderWithProviders(<GradedEstimatesSection />, 'es');
    await screen.findByText(/Escalones de costo de gradeo/);

    fireEvent.change(screen.getByLabelText('Fin del escalón 2'), { target: { value: '100' } });
    expect(screen.getByText(/debe ser mayor que su inicio/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('guarda la tabla COMPLETA en centavos, con el último `max` en null y sin mandar `enabled`', async () => {
    const spy = vi.spyOn(api, 'updateGradedEstimateConfig').mockResolvedValue(seed());
    renderWithProviders(<GradedEstimatesSection />, 'es');
    await screen.findByText(/Escalones de costo de gradeo/);

    fireEvent.change(rowsOf()[0], { target: { value: '800' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const payload = spy.mock.calls[0][0];
    expect(payload.gradingCostTiers![0]).toEqual({
      minValueMxnCents: 0,
      maxValueMxnCents: 200_000,
      costMxnCents: 80_000,
    });
    expect(payload.gradingCostTiers!.at(-1)!.maxValueMxnCents).toBeNull();
    expect(payload).not.toHaveProperty('enabled');
    expect(payload.minUpsidePct).toBe(30);
    expect(payload.freshnessDays).toBe(30);
  });

  it('el margen mínimo y la frescura se validan antes de salir (rango del contrato)', async () => {
    renderWithProviders(<GradedEstimatesSection />, 'es');
    await screen.findByText(/Escalones de costo de gradeo/);

    fireEvent.change(screen.getByLabelText(/Frescura del dato/), { target: { value: '400' } });
    expect(screen.getByText(/entero de días entre 1 y 365/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('un 422 del servidor se muestra ACCIONABLE (no «error genérico»)', async () => {
    vi.spyOn(api, 'updateGradedEstimateConfig').mockRejectedValue(
      new ApiClientError(422, {
        code: 'GRADING_TIERS_NOT_CONTIGUOUS',
        message: 'tiers not contiguous',
      }),
    );
    renderWithProviders(<GradedEstimatesSection />, 'es');
    await screen.findByText(/Escalones de costo de gradeo/);

    fireEvent.change(rowsOf()[0], { target: { value: '800' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/sin huecos ni solapes/)).toBeInTheDocument();
  });

  it('espeja el interruptor maestro de M10 (read-only) y avisa si está apagado', async () => {
    vi.spyOn(api, 'getGradedEstimateConfig').mockResolvedValue({
      ...seed(),
      enabled: false,
      gradingCostTiers: [{ minValueMxnCents: 0, maxValueMxnCents: null, costMxnCents: 70_000 }],
    });
    renderWithProviders(<GradedEstimatesSection />, 'es');

    expect(await screen.findByText(/La feature está apagada/)).toBeInTheDocument();
    expect(screen.getByText(/Se enciende y se apaga en M10/)).toBeInTheDocument();
  });

  it('R5 · esta pantalla es de ADMIN: el cálculo se configura aquí, jamás se le enseña al cliente', async () => {
    const { container } = renderWithProviders(<GradedEstimatesSection />, 'es');
    await screen.findByText(/Escalones de costo de gradeo/);
    // El aviso de que nada de esto viaja al storefront es explícito en el subtítulo.
    expect(container.textContent).toMatch(/Nada de esto se le muestra al cliente/);
  });
});
