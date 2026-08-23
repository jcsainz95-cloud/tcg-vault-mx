import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { expectVisibleMicroNotice, sightedText } from '@/test/grading';
import type { GradedEstimateDTO, GroupedListingDTO } from '@/types/contract';
import {
  badgeEstimatesOf,
  blockEstimatesOf,
  oldestCapturedDate,
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

const listing = (over: Partial<GroupedListingDTO> = {}): GroupedListingDTO => ({
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
  referenceValue: { status: 'priced', referenceMxnCents: 128000, capturedDate: '2026-08-13' },
  currency: 'MXN',
  ...over,
});

const detail = (gradedEstimates?: GradedEstimateDTO[], productType: 'raw' | 'graded' = 'raw') => ({
  listings: [listing({ productType })],
  gradedEstimates,
});

describe('gancho de grading · predicados (contrato v1.44: presencia ⇔ elegibilidad)', () => {
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
   * D5 (techlead): un solo rótulo cubre TODAS las cifras del bloque, así que la fecha honesta es la
   * MÁS ANTIGUA. Con la más reciente, un PSA 10 de hoy junto a un PSA 9 de hace un mes rotularía
   * ambos como «hoy» — afirmar de más en una superficie con exposición legal.
   */
  it('la fecha de refresco es la MÁS ANTIGUA (conservadora), iterando (no `list[0]`)', () => {
    const items = [
      est('10', 290_000, { estimate: { status: 'priced', referenceMxnCents: 290_000, capturedDate: '2026-08-22' } }),
      est('9', 145_000, { estimate: { status: 'priced', referenceMxnCents: 145_000, capturedDate: '2026-07-24' } }),
    ];
    expect(oldestCapturedDate(items)).toBe('2026-07-24');
    expect(oldestCapturedDate([est('10', 1, { estimate: { status: 'priced', referenceMxnCents: 1 } })])).toBeUndefined();
  });
});

describe('§21 R3 · acoplamiento llamada ↔ nota al pie (fail-closed)', () => {
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

describe('§21.3 · bloque de la ficha', () => {
  const renderBlock = (items?: GradedEstimateDTO[], locale: 'es' | 'en' = 'es') =>
    renderWithIntl(
      <GradingFootnoteBoundary active={blockEstimatesOf(detail(items)) !== null}>
        <GradingEstimateBlock detail={detail(items)} />
      </GradingFootnoteBoundary>,
      locale,
    );

  it('pinta una celda por grado ITERANDO `gradeValue`, con chip hipotético y fecha de refresco', () => {
    renderBlock([est('10', 290_000), est('9', 145_000)]);

    expect(screen.getByText('VALOR ESTIMADO SI SE GRADEA')).toBeInTheDocument();
    expect(screen.getByText('MX$2,900.00')).toBeInTheDocument();
    expect(screen.getByText('MX$1,450.00')).toBeInTheDocument();
    expect(screen.getAllByText('SI SALE')).toHaveLength(2);
    expect(screen.getByText('PSA 10')).toBeInTheDocument();
    // D5: la fecha rotulada es la MÁS ANTIGUA de las dos cifras (aquí ambas son 22 ago).
    expect(screen.getByText('ESTIMADO · 22 ago 2026')).toBeInTheDocument();
    // El grado se anuncia como HIPOTÉTICO (§21.9), nunca como un slab.
    expect(
      screen.getByText('Grado hipotético: PSA 10. Esta carta no está gradeada.'),
    ).toBeInTheDocument();
  });

  it('el número de celdas lo decide el SERVIDOR: un tercer grado se pinta sin tocar el cliente', () => {
    renderBlock([est('10', 290_000), est('9', 145_000), est('8', 60_000)]);
    expect(screen.getAllByText('SI SALE')).toHaveLength(3);
    expect(screen.getByText('PSA 8')).toBeInTheDocument();
  });

  /**
   * Un solo grado disponible es el comportamiento NORMAL y especificado de la ficha: PROJECT
   * §N.3(1)/§N.4 («se muestra lo que haya»), contrato v1.44 y —desde su corrección— DESIGN_SYSTEM
   * §21.7, que además fija la forma: la retícula COLAPSA a una columna a ancho completo (D6).
   */
  it('un solo grado con dato pinta SU celda y la retícula COLAPSA a una columna (§21.7)', () => {
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
    // El asterisco vive al final del aviso y aquí SÍ es un enlace a la nota (§21.4a).
    const call = notice.querySelector('sup')!;
    expect(call.querySelector('a')).toHaveAttribute('href', '#nota-estimado');
    // El eyebrow se quedó sin llamada.
    const eyebrow = screen.getByText('VALOR ESTIMADO SI SE GRADEA');
    expect(eyebrow.querySelector('sup')).toBeNull();
  });

  it('el aviso NO se abrevia por haber una cifra menos (§21.7)', () => {
    const { container } = renderBlock([est('9', 145_000)]);
    expectVisibleMicroNotice(container as HTMLElement, 'es');
    // La etiqueta nombra el grado que ES: una ficha de un solo grado nunca es ambigua…
    expect(screen.getByText('PSA 9')).toBeInTheDocument();
    // …y NADA anuncia la ausencia del otro DENTRO del bloque (§N.4: el hueco tampoco se dibuja).
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

  it('EN: mismo bloque con el copy en inglés (paridad §N.3)', () => {
    renderBlock([est('10', 290_000), est('9', 145_000)], 'en');
    expect(screen.getByText('ESTIMATED VALUE IF GRADED')).toBeInTheDocument();
    expect(screen.getAllByText('IF IT GRADES')).toHaveLength(2);
    expect(screen.getByText(/ILLUSTRATIVE INFORMATION ONLY/)).toBeInTheDocument();
  });
});
