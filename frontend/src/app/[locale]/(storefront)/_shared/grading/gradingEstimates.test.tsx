import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import type { GradedEstimateDTO, GroupedListingDTO } from '@/types/contract';
import {
  badgeEstimatesOf,
  blockEstimatesOf,
  latestCapturedDate,
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

  it('la fecha de refresco es la MÁS RECIENTE, iterando (no `list[0]`)', () => {
    const items = [
      est('10', 290_000, { estimate: { status: 'priced', referenceMxnCents: 290_000, capturedDate: '2026-08-20' } }),
      est('9', 145_000, { estimate: { status: 'priced', referenceMxnCents: 145_000, capturedDate: '2026-08-22' } }),
    ];
    expect(latestCapturedDate(items)).toBe('2026-08-22');
    expect(latestCapturedDate([est('10', 1, { estimate: { status: 'priced', referenceMxnCents: 1 } })])).toBeUndefined();
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
    expect(screen.queryByText(/ESTIMADO SI SE GRADEA/)).not.toBeInTheDocument();
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
   * PROJECT §N.3(1) y §N.4 (que MANDAN sobre el contrato y sobre DESIGN_SYSTEM, ver CLAUDE.md ›
   * Regla de conflicto): «si solo existe uno de los dos grados, se muestra el que exista» / la ficha
   * «se muestra lo que haya (PSA 10 y/o PSA 9)». El contrato v1.44 lo confirma: «una carta con
   * PSA 10 y sin PSA 9 emite un arreglo de un elemento».
   * ⚠️ §21.7 de DESIGN_SYSTEM dice lo contrario («falta PSA 9 ⇒ Nada» en la ficha) y lo justifica
   * citando §N.4, que en realidad dice «lo que haya». Discrepancia reportada a PO/ux-ui; mientras
   * tanto se aplica la fuente de mayor autoridad, que además es la degradación que §21.7 ya
   * describe como contingencia («se pinta la celda que exista en la misma retícula»).
   */
  it('un solo grado con dato pinta SU celda (PROJECT §N.3(1)); ver discrepancia con §21.7', () => {
    renderBlock([est('10', 290_000)]);
    expect(screen.getAllByText('SI SALE')).toHaveLength(1);
    expect(screen.getByText('MX$2,900.00')).toBeInTheDocument();
    expect(screen.queryByText('PSA 9')).not.toBeInTheDocument();
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
