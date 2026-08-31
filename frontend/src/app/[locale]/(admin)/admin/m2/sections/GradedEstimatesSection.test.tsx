import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { expectCreditsFigureQualified } from '@/test/grading';
import * as api from '@/lib/api';
import type { GradedEstimateConfigDTO } from '@/types/contract';
import { ApiClientError } from '@/lib/api-client';
import { GradedEstimatesSection } from './GradedEstimatesSection';
import { M10View } from '@/app/[locale]/(admin)/admin/m10/M10View';

// `@/i18n/navigation` (next-intl) no resuelve bajo vitest. Lo necesita `M10View`, que se monta
// junto a esta sección en el check de §22.14(f)(f) — el enlace del aviso de apagado del gancho.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

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
  manualFreshnessDays: null,
  maxRawMultiple: 100,
  minSampleCount: 5,
  sourceStat: 'median',
  ingestMaxCardsPerRun: 250,
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

/**
 * §22.14 — **el tope de cartas por corrida gana campo**. Hasta hoy `ingestMaxCardsPerRun` no se
 * pintaba ni viajaba en el `PUT`: la única cota entre un `PUT` y la factura del proveedor
 * (ARCHITECTURE §4.38r.3) solo se movía por `curl`, mientras el aviso de M10 le decía al dueño que
 * «ese tope se edita en M2». Ese es el mismo defecto que costó el rediseño a dial único, una
 * pantalla más allá: una palanca declarada gobernable y nunca dibujada.
 *
 * **Nunca 5 000**: ese valor salió del contrato en v1.51-a y §22.14(e) prohíbe escribirlo también
 * aquí — un test es un sitio tan bueno como cualquiera para reintroducir un número muerto.
 */
describe('GradedEstimatesSection · tope de cartas por corrida (§22.14)', () => {
  const capInput = () => screen.getByLabelText('Tope de cartas por corrida') as HTMLInputElement;

  it('(a) el campo EXISTE, trae el tope del servidor y vive en su BLOQUE PROPIO', async () => {
    renderWithProviders(<GradedEstimatesSection />, 'es');
    await screen.findByText(/Escalones de costo de gradeo/);

    expect(capInput().value).toBe('250');
    expect(screen.getByText(/Cuántas cartas tuyas mira el barrido/)).toBeInTheDocument();
    // No es una tercera celda de la retícula de margen/frescura: esos dos son gates de PUBLICACIÓN
    // y éste GASTA (§22.14b). La frescura sí vive en la retícula; el tope, no.
    expect(screen.getByLabelText(/Frescura del dato/).closest('.grid')).not.toBeNull();
    expect(capInput().closest('.grid')).toBeNull();
    // En reposo (borrador = guardado) NO se pinta cifra de créditos: el techo permanente es de M10.
    expect(screen.queryByText(/créditos al día/)).not.toBeInTheDocument();
  });

  it('(b) subir el tope avisa en `warning`, con la cifra DEL BORRADOR y su supuesto pegado', async () => {
    renderWithProviders(<GradedEstimatesSection />, 'es');
    await screen.findByText(/Escalones de costo de gradeo/);

    fireEvent.change(capInput(), { target: { value: '500' } });
    const banner = screen.getByText(/Estás subiendo el techo de gasto/).closest('[role="status"]')!;
    // `status`, nunca `alert`: se teclea en un borrador y una región asertiva por pulsación es
    // hostil con lector de pantalla (§22.14c).
    expect(banner).toBeTruthy();
    // El color no es el único canal (§2.4), pero además ES el de subida: regla de acento.
    expect(banner.className).toContain('border-accent');
    // 500 × 2 créditos × 2 corridas = 2000/día, con la aritmética del MISMO módulo que M10.
    expect(banner.textContent).toMatch(/2000 créditos al día/);
    // La cifra del BORRADOR, no la guardada (§22.14f b).
    expect(banner.textContent).not.toMatch(/1000 créditos al día/);
    // Y el invariante de §22.13(d.1), aquí sin excepción: ninguna oración publica el techo sin su
    // régimen de cobro. Mismo candado que M10, mismo módulo.
    expectCreditsFigureQualified(banner.textContent!);
    // Guardar NO se bloquea: el aviso informa, no es un error (§22.14e).
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
    // Y dice que guardar no cobra: sin esa frase el aviso desanima tocar la única palanca.
    expect(banner.textContent).toMatch(/Guardar no cobra nada/);
  });

  it('(c/d) bajarlo avisa en `info` con OTRO título, y volver al valor guardado retira el aviso', async () => {
    renderWithProviders(<GradedEstimatesSection />, 'es');
    await screen.findByText(/Escalones de costo de gradeo/);

    fireEvent.change(capInput(), { target: { value: '100' } });
    const banner = screen.getByText(/Estás bajando el techo de gasto/).closest('[role="status"]')!;
    expect(banner.className).not.toContain('border-accent');
    expect(banner.textContent).toMatch(/400 créditos al día/);
    expect(screen.queryByText(/Estás subiendo el techo de gasto/)).not.toBeInTheDocument();

    fireEvent.change(capInput(), { target: { value: '250' } });
    expect(screen.queryByText(/techo de gasto/)).not.toBeInTheDocument();
    expect(screen.queryByText(/créditos al día/)).not.toBeInTheDocument();
  });

  it('(e) fuera de [1, 1000] o vacío: `rangeError`, guardado BLOQUEADO y NINGUNA cifra de créditos', async () => {
    renderWithProviders(<GradedEstimatesSection />, 'es');
    await screen.findByText(/Escalones de costo de gradeo/);

    for (const value of ['0', '', '1001', '10.5']) {
      fireEvent.change(capInput(), { target: { value } });
      expect(screen.getByText('Un número entero entre 1 y 1 000.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
      // No se calcula un techo con un número que no se puede guardar (§22.14d).
      expect(screen.queryByText(/créditos al día/)).not.toBeInTheDocument();
    }

    fireEvent.change(capInput(), { target: { value: '1000' } });
    expect(screen.queryByText('Un número entero entre 1 y 1 000.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
  });

  it('el tope viaja en el PUT (money-safe: un campo vacío NO se guarda como 0 ni como el default)', async () => {
    const spy = vi.spyOn(api, 'updateGradedEstimateConfig').mockResolvedValue(seed());
    renderWithProviders(<GradedEstimatesSection />, 'es');
    await screen.findByText(/Escalones de costo de gradeo/);

    // Vacío: el guardado no sale (y si alguien quitara el bloqueo, tampoco mandaría 0).
    fireEvent.change(capInput(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(spy).not.toHaveBeenCalled();

    fireEvent.change(capInput(), { target: { value: '400' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0].ingestMaxCardsPerRun).toBe(400);
  });

  /**
   * §22.14(f)(f) — **el check que cierra el círculo**: el aviso de M10 promete que el tope «se edita
   * en M2», así que guardar en M2 tiene que mover la cifra que M10 enseña, **sin recargar**. Las dos
   * pantallas comparten la `queryKey` `['graded-estimates-config']` y la invalidación ya existía;
   * lo que faltaba era el campo. Se montan JUNTAS a propósito: es el único modo de probar que la
   * palanca y el aviso son la misma feature y no dos textos que se parecen.
   */
  it('(f) guardar el tope en M2 mueve la cifra del aviso de M10 sin recargar', async () => {
    // El doble del servidor GUARDA lo que recibe: si el `PUT` no llevara el tope, el `GET` de la
    // invalidación devolvería el viejo y la cifra de M10 no se movería. Un mock que devuelve 500
    // pase lo que pase probaría solo la invalidación, no el círculo entero.
    let servedCap = 250;
    vi.spyOn(api, 'getGradedEstimateConfig').mockImplementation(async () => ({
      ...seed(),
      ingestMaxCardsPerRun: servedCap,
    }));
    vi.spyOn(api, 'updateGradedEstimateConfig').mockImplementation(async (input) => {
      if (input.ingestMaxCardsPerRun != null) servedCap = input.ingestMaxCardsPerRun;
      return { ...seed(), ingestMaxCardsPerRun: servedCap };
    });
    renderWithProviders(
      <>
        <GradedEstimatesSection />
        <M10View />
      </>,
      'es',
    );
    await screen.findByText(/Escalones de costo de gradeo/);

    // El aviso de M10 (dial guardado en `on`) cifra el techo con el tope VIVO: 250 × 2 × 2.
    const aviso = await screen.findByText(/Y gasta\./);
    const banner = aviso.closest('[role="status"]') as HTMLElement;
    await waitFor(() => expect(banner.textContent).toMatch(/1000 créditos al día/));

    fireEvent.change(capInput(), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    // Sin recargar: la invalidación de la sección refresca la MISMA query que lee M10.
    await waitFor(() => expect(banner.textContent).toMatch(/2000 créditos al día/));
    expect(banner.textContent).not.toMatch(/1000 créditos al día/);
    // Y sigue calificada al otro lado: mover la cifra no puede desnudarla.
    expectCreditsFigureQualified(banner.textContent!);
  });
});
