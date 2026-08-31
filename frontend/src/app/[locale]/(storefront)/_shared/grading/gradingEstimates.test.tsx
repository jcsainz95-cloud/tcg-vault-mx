import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import esMessages from '../../../../../../messages/es.json';
import enMessages from '../../../../../../messages/en.json';
import { expectVisibleMicroNotice, sightedText } from '@/test/grading';
import type {
  GradedEstimateDTO,
  GroupedListingDTO,
  GroupedListingSummaryDTO,
} from '@/types/contract';
import {
  badgeEstimatesOf,
  blockEstimatesOf,
  pageHasGradingFigures,
  renderableEstimates,
} from './estimates';
import { GradingFootnoteBoundary } from './GradingFootnote';
import { GradingEstimateBlock } from './GradingEstimateBlock';
import { GradingEstimateBadge } from './GradingEstimateBadge';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function est(gradeValue: string, cents: number | undefined, over: Partial<GradedEstimateDTO> = {}): GradedEstimateDTO {
  return {
    gradingCompany: 'PSA',
    gradeValue,
    gradeKey: `graded:PSA:${gradeValue}`,
    estimate: { status: 'priced', referenceMxnCents: cents, capturedDate: '2026-08-22' },
    ...over,
  };
}

// v1.50.2: `gradingHighlight` vive en el DTO de la REJILLA (`GroupedListingSummaryDTO`), que es
// el que reciben la teja de Compra y la vitrina. La FICHA no lo lee: usa `gradedEstimates`.
const listing = (over: Partial<GroupedListingSummaryDTO> = {}): GroupedListingSummaryDTO => ({
  representativeInventoryItemId: 'inv-a',
  card: {
    id: 'c-1',
    externalId: 'base1-2',
    name: 'Blastoise',
    number: '2',
    rarity: 'Rare Holo',
    supertype: 'Pokémon',
    subtypes: ['Stage 2'],
    setId: 'base1',
    setName: 'Base Set',
    imageSmallUrl: 'https://img.example/s.png',
    imageLargeUrl: 'https://img.example/l.png',
    availableFinishes: ['normal'],
  },
  productType: 'raw',
  rawCondition: 'NM',
  finish: 'normal',
  gradeKey: 'raw:NM',
  stockCount: 1,
  salePriceCents: 140800,
  currency: 'MXN',
  ...over,
});

/**
 * La FICHA recibe `GroupedListingDTO` (con `priceBasis`/`referenceValue`, D2) y sus estimados en la
 * RAÍZ. Es un tipo DISTINTO del de la rejilla a propósito: es lo que impide releer el marcador de
 * promoción desde `listings[i]` (camino derogado por el contrato v1.50.2).
 */
const detailListing = (productType: 'raw' | 'graded' = 'raw'): GroupedListingDTO => ({
  ...listing({ productType }),
  priceBasis: 'market',
  referenceValue: { status: 'priced', referenceMxnCents: 128000, capturedDate: '2026-08-13' },
});

const detail = (gradedEstimates?: GradedEstimateDTO[], productType: 'raw' | 'graded' = 'raw') => ({
  listings: [detailListing(productType)],
  gradedEstimates,
});

describe('gancho de grading · predicados (contrato v1.50: presencia ⇔ elegibilidad)', () => {
  it('campo ausente ⇒ null (nunca un arreglo vacío que invite a pintar un contenedor)', () => {
    expect(renderableEstimates(undefined)).toBeNull();
    expect(renderableEstimates([])).toBeNull();
    expect(blockEstimatesOf(detail(undefined))).toBeNull();
    expect(badgeEstimatesOf(listing())).toBeNull();
  });

  it('money-safe: una cifra sin monto (o en 0) NO es pintable — jamás $0 ni guion', () => {
    expect(renderableEstimates([est('10', undefined)])).toBeNull();
    expect(renderableEstimates([est('10', 0)])).toBeNull();
    expect(
      renderableEstimates([{ ...est('10', 100), estimate: { status: 'pending' } }]),
    ).toBeNull();
    // Con una cifra buena y una mala, solo sobrevive la buena.
    expect(renderableEstimates([est('10', 290_000), est('9', 0)])).toHaveLength(1);
  });

  it('la feature es SOLO de raw: una gradeada nunca pinta nada', () => {
    expect(blockEstimatesOf(detail([est('10', 290_000)], 'graded'))).toBeNull();
    expect(
      badgeEstimatesOf(listing({ productType: 'graded', gradingHighlight: [est('10', 290_000)] })),
    ).toBeNull();
  });

  it('pageHasGradingFigures usa el MISMO predicado que el badge (acoplamiento R3 sin regla duplicada)', () => {
    expect(pageHasGradingFigures([listing(), listing()])).toBe(false);
    expect(pageHasGradingFigures([listing(), listing({ gradingHighlight: [est('10', 290_000)] })])).toBe(true);
  });

  /**
   * Criterio 119(b): cero apariciones de la clave en `messages/`, **ES y EN**. Se comprueba sobre
   * el catálogo y no sobre la pantalla porque una clave viva es una recaída a un `git revert` de
   * distancia — y porque retirarla en un solo idioma es exactamente lo que el candado de paridad
   * (`i18n-parity.test.ts`) tendría que cazar.
   */
  it.each([
    ['es', esMessages],
    ['en', enMessages],
  ])('criterio 119 · %s ya no define `catalog.gradingEstimate.updatedAt`', (_locale, catalog) => {
    const gradingEstimate = (catalog as { catalog: { gradingEstimate: Record<string, string> } })
      .catalog.gradingEstimate;
    expect(gradingEstimate.eyebrow).toBeTruthy(); // el grupo sigue vivo: no se borró de más
    expect(Object.keys(gradingEstimate)).not.toContain('updatedAt');
  });
});

describe('§22 R3 · acoplamiento llamada ↔ nota al pie (fail-closed)', () => {
  it('FUERA de una boundary activa, ninguna cifra se pinta (ni bloque ni badge)', () => {
    const items = [est('10', 290_000), est('9', 145_000)];
    const { container } = renderWithIntl(
      <>
        <GradingEstimateBlock detail={detail(items)} />
        <GradingEstimateBadge listing={listing({ gradingHighlight: [est('10', 290_000)] })} />
      </>,
      'es',
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('con `active={false}` la boundary no publica contexto NI nota: cero cifras, cero aviso', () => {
    renderWithIntl(
      <GradingFootnoteBoundary active={false}>
        <GradingEstimateBadge listing={listing({ gradingHighlight: [est('10', 290_000)] })} />
      </GradingFootnoteBoundary>,
      'es',
    );
    expect(screen.queryByText(/En PSA 10 vale/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no evaluamos esta carta/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/INFORMACIÓN ILUSTRATIVA/)).not.toBeInTheDocument();
  });

  it('con `active` la nota se renderiza SIN interacción: titular + los 6 párrafos + regreso', () => {
    renderWithIntl(<GradingFootnoteBoundary active>{null}</GradingFootnoteBoundary>, 'es');

    const note = document.getElementById('nota-estimado')!;
    expect(note).toBeInTheDocument();
    // Nada de <details>/acordeón: es contenido real, imprimible y encontrable con Ctrl+F.
    expect(note.querySelector('details')).toBeNull();
    expect(screen.getByText(/INFORMACIÓN ILUSTRATIVA\. NO ES UNA VALUACIÓN DE ESTA CARTA\./)).toBeInTheDocument();
    expect(note.querySelectorAll('p')).toHaveLength(7); // titular + 6 párrafos del disclaimer
    // El encabezado recibe el foco al saltar y no queda tapado por el header sticky.
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(note.className).toContain('scroll-mt-[calc(var(--app-header-h,0px)+16px)]');
    // Viaje de ida y VUELTA.
    expect(note.querySelector('a[href="#llamada-estimado"]')).not.toBeNull();
  });
});

describe('§22.3 · bloque de la ficha', () => {
  const renderBlock = (items?: GradedEstimateDTO[], locale: 'es' | 'en' = 'es') =>
    renderWithIntl(
      <GradingFootnoteBoundary active={blockEstimatesOf(detail(items)) !== null}>
        <GradingEstimateBlock detail={detail(items)} />
      </GradingFootnoteBoundary>,
      locale,
    );

  it('pinta una celda por grado ITERANDO `gradeValue`, con chip hipotético (y SIN fecha)', () => {
    renderBlock([est('10', 290_000), est('9', 145_000)]);

    expect(screen.getByText('VALOR ESTIMADO SI SE GRADEA')).toBeInTheDocument();
    expect(screen.getByText('MX$2,900.00')).toBeInTheDocument();
    expect(screen.getByText('MX$1,450.00')).toBeInTheDocument();
    expect(screen.getAllByText('SI SALE')).toHaveLength(2);
    expect(screen.getByText('PSA 10')).toBeInTheDocument();
    // Criterio 119: el eyebrow derecho («ESTIMADO · {date}») se retiró — ninguna fecha aquí.
    expect(screen.queryByText(/ESTIMADO · /)).not.toBeInTheDocument();
    // El grado se anuncia como HIPOTÉTICO (§22.9), nunca como un slab.
    expect(
      screen.getByText('Grado hipotético: PSA 10. Esta carta no está gradeada.'),
    ).toBeInTheDocument();
  });

  /**
   * PROJECT.md decisión 62 / criterio 119 — **VERIFICACIÓN NEGATIVA**. Aquí vivía el test de la
   * fecha «más antigua» del eyebrow (deuda D5). La decisión no fue afinar cuál fecha se pinta: fue
   * **no pintar ninguna**. `capturedDate` es cuándo BAJAMOS el dato, no cuándo ocurrió la venta —
   * `evidenceDate` no se persiste—, así que «ESTIMADO · 22 ago 2026» se podía leer como la fecha de
   * la venta, que es justo el dato que no tenemos.
   *
   * El test se invierte en vez de borrarse: si alguien vuelve a cablear una fecha al bloque, esto
   * tiene que ponerse rojo. Ojo con el alcance — **no** cubre la frescura interna (criterio 118,
   * server-side, que sigue usando `capturedDate`) ni la fecha del valor de mercado (criterio 119e).
   */
  it('criterio 119 · el bloque NO pinta ninguna fecha, ni siquiera con capturas distintas', () => {
    const { container } = renderBlock([
      est('10', 290_000, { estimate: { status: 'priced', referenceMxnCents: 290_000, capturedDate: '2026-08-22' } }),
      est('9', 145_000, { estimate: { status: 'priced', referenceMxnCents: 145_000, capturedDate: '2026-07-24' } }),
    ]);

    // Las cifras sí se pintan: lo que se retira es la fecha, no el bloque.
    expect(screen.getByText('MX$2,900.00')).toBeInTheDocument();
    // Se mira EL BLOQUE, no la página: la nota al pie (§O.5) sí habla de que los precios de mercado
    // «pueden quedar desactualizados», y eso es el disclaimer, no una fecha de este dato.
    const bloque = container.querySelector('section')!;
    // Ni el rótulo viejo, ni la fecha de ninguna de las dos capturas, ni un «actualizado» suavizado.
    expect(screen.queryByText(/ESTIMADO · /)).not.toBeInTheDocument();
    expect(bloque.textContent).not.toMatch(/22 ago 2026|24 jul 2026/);
    expect(bloque.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(bloque.textContent).not.toMatch(/2026/);
    expect(bloque.textContent).not.toMatch(/actualizad|refresc/i);
    // Y tampoco escondida en un atributo: nada de tooltip, `title` ni `datetime`.
    expect(bloque.querySelector('time, [title], [datetime]')).toBeNull();
    // Ni en el TEXTO ACCESIBLE. El candado anterior miraba `textContent` y tres selectores, así que
    // un `<span aria-label="Capturado el 22 de agosto de 2026" />` pasaba con la suite en verde (lo
    // demostró QA). Una fecha que solo existe para el lector de pantalla **sigue siendo una fecha
    // mostrada** — y para quien usa lector de pantalla es LA fecha. Se barre el valor de TODOS los
    // atributos del subárbol (no solo `aria-*`): un dato que no debe existir no debe existir en
    // ningún canal, y así el candado no depende de acertar qué atributo elegirá el próximo.
    const textoAccesible = [
      bloque.textContent ?? '',
      ...Array.from(bloque.querySelectorAll('*')).flatMap((el) =>
        Array.from(el.attributes).map((a) => a.value),
      ),
    ].join(' § ');
    expect(textoAccesible).not.toMatch(/22 ago 2026|24 jul 2026/);
    expect(textoAccesible).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(textoAccesible).not.toMatch(/2026/);
    expect(textoAccesible).not.toMatch(
      /enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre/i,
    );
  });

  it('el número de celdas lo decide el SERVIDOR: un tercer grado se pinta sin tocar el cliente', () => {
    renderBlock([est('10', 290_000), est('9', 145_000), est('8', 60_000)]);
    expect(screen.getAllByText('SI SALE')).toHaveLength(3);
    expect(screen.getByText('PSA 8')).toBeInTheDocument();
  });

  /**
   * Un solo grado disponible es el comportamiento NORMAL y especificado de la ficha: PROJECT
   * §O.3(1)/§O.4 («se muestra lo que haya»), contrato v1.44 y —desde su corrección— DESIGN_SYSTEM
   * §22.7, que además fija la forma: la retícula COLAPSA a una columna a ancho completo (D6).
   */
  it('un solo grado con dato pinta SU celda y la retícula COLAPSA a una columna (§22.7)', () => {
    const { container } = renderBlock([est('10', 290_000)]);
    expect(screen.getAllByText('SI SALE')).toHaveLength(1);
    expect(screen.getByText('MX$2,900.00')).toBeInTheDocument();
    expect(screen.queryByText('PSA 9')).not.toBeInTheDocument();
    // Sin `sm:grid-cols-2` no queda media retícula vacía ni un `sm:border-l` huérfano.
    const grid = container.querySelector('section > div.grid')!;
    expect(grid.className).not.toContain('sm:grid-cols-2');
    expect(container.querySelector('.sm\\:border-l')).toBeNull();
  });

  it('con DOS grados la retícula sí es de dos columnas (misma del bloque de precio)', () => {
    const { container } = renderBlock([est('10', 290_000), est('9', 145_000)]);
    const grid = container.querySelector('section > div.grid')!;
    expect(grid.className).toContain('sm:grid-cols-2');
  });

  /** EL BLOQUEANTE DE QA, en la ficha: el aviso sobrevive a ocultar todo lo `sr-only`. */
  it('R3.1 · micro-aviso VISIBLE con las dos ideas, y la llamada `*` lo CIERRA (no el eyebrow)', () => {
    const { container } = renderBlock([est('10', 290_000), est('9', 145_000)]);
    expectVisibleMicroNotice(container as HTMLElement, 'es');

    const notice = screen.getByText(/No evaluamos el estado de esta carta/i).closest('p')!;
    expect(notice.className).not.toContain('sr-only');
    // El asterisco vive al final del aviso y aquí SÍ es un enlace a la nota (§22.4a).
    const call = notice.querySelector('sup')!;
    expect(call.querySelector('a')).toHaveAttribute('href', '#nota-estimado');
    // El eyebrow se quedó sin llamada.
    const eyebrow = screen.getByText('VALOR ESTIMADO SI SE GRADEA');
    expect(eyebrow.querySelector('sup')).toBeNull();
  });

  it('el aviso NO se abrevia por haber una cifra menos (§22.7)', () => {
    const { container } = renderBlock([est('9', 145_000)]);
    expectVisibleMicroNotice(container as HTMLElement, 'es');
    // La etiqueta nombra el grado que ES: una ficha de un solo grado nunca es ambigua…
    expect(screen.getByText('PSA 9')).toBeInTheDocument();
    // …y NADA anuncia la ausencia del otro DENTRO del bloque (§O.4: el hueco tampoco se dibuja).
    // La nota al pie sí nombra ambos grados: es el texto legal, no una celda vacía.
    const block = container.querySelector('section:not([id])') as HTMLElement;
    expect(sightedText(block)).not.toMatch(/PSA 10|sin dato|—/);
  });

  it('R5 · no aparece NINGUNA pieza del cálculo (ganancia, multiplicador, costo, margen, ROI)', () => {
    const { container } = renderBlock([est('10', 290_000), est('9', 145_000)]);
    expect(container.textContent).not.toMatch(/ganancia|multiplic|×\s?\d|ROI|margen|costo de grade/i);
  });

  it('sin ningún estimado no se pinta NADA: ni bloque, ni regla huérfana, ni nota al pie', () => {
    const { container } = renderBlock(undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it('EN: mismo bloque con el copy en inglés (paridad §O.3)', () => {
    renderBlock([est('10', 290_000), est('9', 145_000)], 'en');
    expect(screen.getByText('ESTIMATED VALUE IF GRADED')).toBeInTheDocument();
    expect(screen.getAllByText('IF IT GRADES')).toHaveLength(2);
    expect(screen.getByText(/ILLUSTRATIVE INFORMATION ONLY/)).toBeInTheDocument();
  });
});
