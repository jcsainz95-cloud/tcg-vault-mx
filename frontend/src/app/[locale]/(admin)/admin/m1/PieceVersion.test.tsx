/**
 * §IDS-UX.3 / IDS-UX.4 — superficies internas: lista de inventario (Idioma «EN» gris / «Español»; Liga insignia +
 * detalle o «—») y hoja «Pedidos por preparar» (insignias de 26 px + la línea interna de backend como texto).
 * IDS-F6 (5): «sello» SÍ vive en la línea interna mono de preparación (nombra el sello físico), pero desde HECHOS
 * 2026-11-04 («En el admin también se dice «de liga»») NO en los rótulos visibles del admin: columna «Liga» y filtro
 * `Liga: Todas | De liga | Sin liga`, en las mismas burbujas de 44 px que la captura (`PillToggleGroup`).
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import es from '../../../../../../messages/es.json';
import en from '../../../../../../messages/en.json';
import { PieceVersion, PieceVersionFilters } from './PieceVersion';
import { CardInfo } from '../m4/prep-shared';

/** Todas las cadenas hoja de un catálogo de mensajes, con su ruta. */
function strings(v: unknown, prefix = ''): [string, string][] {
  if (typeof v === 'string') return [[prefix, v]];
  if (v && typeof v === 'object')
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => strings(x, prefix ? `${prefix}.${k}` : k));
  return [];
}

describe('PieceVersion (lista de inventario admin)', () => {
  it('inglés sin liga: «EN» mono gris (no insignia) y «—»', () => {
    renderWithIntl(<PieceVersion version={{ key: 'en', language: 'en', stamp: null }} />);
    const cell = screen.getByTestId('piece-version');
    expect(cell.textContent).toBe('EN—');
    expect(cell.querySelector('[data-version-chip]')).toBeNull();
  });
  it('español de liga: insignias «Español» y «De liga» + el detalle del proveedor en texto', () => {
    renderWithIntl(
      <PieceVersion version={{ key: 'es.703819', language: 'es', stamp: { type: 'prize_pack', label: 'Cosmos Holo', productId: 703819 } }} />,
    );
    expect(screen.getByTestId('piece-version').textContent).toBe('EspañolDe ligaCosmos Holo');
  });
  it('sin `version` (servidor anterior) ⇒ inglés sin liga', () => {
    renderWithIntl(<PieceVersion />);
    expect(screen.getByTestId('piece-version').textContent).toBe('EN—');
  });
  it('la celda de liga se anuncia como «Liga» (nunca «Sello»)', () => {
    renderWithIntl(<PieceVersion version={{ key: 'en', language: 'en', stamp: null }} />);
    const cell = screen.getByTestId('piece-version');
    expect(cell.querySelector('[aria-label="Liga"]')).not.toBeNull();
    expect(cell.querySelector('[aria-label="Sello"]')).toBeNull();
    expect(es.admin.m1.ids.column).toEqual({ language: 'Idioma', stamp: 'Liga' });
    expect(en.admin.m1.ids.column).toEqual({ language: 'Language', stamp: 'League' });
  });
});

describe('PieceVersionFilters (filtros de un toque del cajón de piezas, HECHOS 2026-11-04)', () => {
  function setup(language: 'all' | 'en' | 'es' = 'all', stamped: 'all' | 'true' | 'false' = 'all') {
    const onLanguage = vi.fn();
    const onStamped = vi.fn();
    renderWithIntl(<PieceVersionFilters language={language} stamped={stamped} onLanguage={onLanguage} onStamped={onStamped} />);
    return { onLanguage, onStamped };
  }
  it('Idioma: Todos | Inglés | Español y Liga: Todas | De liga | Sin liga; eligen con un toque', () => {
    const { onLanguage, onStamped } = setup();
    const groups = screen.getAllByRole('radiogroup');
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveAccessibleName('Idioma');
    expect(groups[1]).toHaveAccessibleName('Liga');
    expect(within(groups[0]).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Todos', 'Inglés', 'Español']);
    expect(within(groups[1]).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Todas', 'De liga', 'Sin liga']);
    fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
    fireEvent.click(screen.getByRole('radio', { name: 'De liga' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Sin liga' }));
    expect(onLanguage).toHaveBeenCalledWith('es');
    expect(onStamped).toHaveBeenNthCalledWith(1, 'true');
    expect(onStamped).toHaveBeenNthCalledWith(2, 'false');
  });
  it('la palabra «sello» no aparece en ningún texto del bloque de filtros (ES y EN)', () => {
    const { container, unmount } = renderWithIntl(<PieceVersionFilters language="all" stamped="all" onLanguage={vi.fn()} onStamped={vi.fn()} />);
    expect(container.textContent).not.toMatch(/sello/i);
    unmount();
    const en2 = renderWithIntl(<PieceVersionFilters language="all" stamped="all" onLanguage={vi.fn()} onStamped={vi.fn()} />, 'en');
    expect(en2.container.textContent).not.toMatch(/stamp/i);
    expect(within(en2.getAllByRole('radiogroup')[1]).getAllByRole('radio').map((r) => r.textContent)).toEqual(['All', 'League', 'Regular']);
  });
  it('burbujas de la captura reutilizadas: `role="radio"` + `aria-checked`, 44 px (`min-h-11`) y relleno tinta en la elegida', () => {
    setup('es', 'true');
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(6);
    for (const r of radios) {
      expect(r.className).toContain('min-h-11');
      expect(r).toHaveAttribute('aria-checked');
      expect(r).not.toHaveAttribute('aria-pressed');
    }
    const on = radios.filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(on.map((r) => r.textContent)).toEqual(['Español', 'De liga']);
    for (const r of on) expect(r.className).toContain('bg-text');
    for (const r of radios.filter((r) => r.getAttribute('aria-checked') === 'false')) expect(r.className).not.toContain('bg-text');
  });
  it('catálogo de textos: `admin.m1.ids.filter` dice Liga en ES/EN y «Con sello»/«Sin sello» no existen en es.json', () => {
    expect(es.admin.m1.ids.filter).toEqual({
      language: 'Idioma',
      languageAll: 'Todos',
      stamp: 'Liga',
      stampAll: 'Todas',
      stampYes: 'De liga',
      stampNo: 'Sin liga',
    });
    // EN: «League» como la insignia de la tienda (`version.chip.league`) y «Regular» como la versión sin liga que ya usa la
    // captura (`admin.m1.ids.noStamp`, HECHOS 2026-11-03 «Copy EN de §IDS»).
    expect(en.admin.m1.ids.filter).toEqual({
      language: 'Language',
      languageAll: 'All',
      stamp: 'League',
      stampAll: 'All',
      stampYes: 'League',
      stampNo: 'Regular',
    });
    expect(en.admin.m1.ids.filter.stampNo).toBe(en.admin.m1.ids.noStamp);
    expect(strings(es).filter(([, v]) => /\b(con|sin) sello\b/i.test(v))).toEqual([]);
    expect(strings(en).filter(([, v]) => /\bnot stamped\b|^stamped$/i.test(v))).toEqual([]);
  });
});

describe('Hoja «Pedidos por preparar» (CardInfo)', () => {
  const card = { name: 'Nest Ball', setName: 'Scarlet & Violet', finish: 'holofoil' as const, conditionLabel: 'NM', imageSmallUrl: null };
  const t = ((k: string) => k) as never;
  it('insignias de 26 px por pieza + la línea interna tal cual la manda backend', () => {
    renderWithIntl(
      <CardInfo
        card={card}
        folio="INV-1"
        quantity={1}
        t={t}
        version={{ key: 'es.703819', language: 'es', stamp: { type: 'prize_pack', label: 'Cosmos Holo', productId: 703819 } }}
        versionInternalLine="ES · LIGA · Prize Pack — sello Play! Pokémon, Cosmos Holo"
      />,
    );
    const chips = screen.getByTestId('prep-version-chips');
    expect(chips.textContent).toBe('EspañolDe liga');
    for (const c of Array.from(chips.children)) expect(c.className).toContain('h-[26px]');
    expect(screen.getByTestId('prep-version-line').textContent).toBe('ES · LIGA · Prize Pack — sello Play! Pokémon, Cosmos Holo');
  });
  it('inglés sin liga (`versionInternalLine` null): nada nuevo', () => {
    renderWithIntl(<CardInfo card={card} folio="INV-1" quantity={1} t={t} version={{ key: 'en', language: 'en', stamp: null }} versionInternalLine={null} />);
    expect(screen.queryByTestId('prep-version-chips')).toBeNull();
    expect(screen.queryByTestId('prep-version-line')).toBeNull();
  });
});
