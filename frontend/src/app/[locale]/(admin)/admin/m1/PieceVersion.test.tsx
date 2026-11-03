/**
 * §IDS-UX.3 / IDS-UX.4 — superficies internas: lista de inventario (Idioma «EN» gris / «Español»; Sello insignia +
 * detalle o «—») y hoja «Pedidos por preparar» (insignias de 26 px + la línea interna de backend como texto).
 * IDS-F6 (5): «sello» SÍ vive aquí (admin y preparación), nunca en superficies de cliente.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { PieceVersion, PieceVersionFilters } from './PieceVersion';
import { CardInfo } from '../m4/prep-shared';

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
  it('filtros de un toque: Idioma Todos/Inglés/Español y Sello Todos/Con sello/Sin sello', () => {
    const onLanguage = vi.fn();
    const onStamped = vi.fn();
    renderWithIntl(<PieceVersionFilters language="all" stamped="all" onLanguage={onLanguage} onStamped={onStamped} />);
    fireEvent.click(screen.getByRole('button', { name: 'Español' }));
    fireEvent.click(screen.getByRole('button', { name: 'Con sello' }));
    expect(onLanguage).toHaveBeenCalledWith('es');
    expect(onStamped).toHaveBeenCalledWith('true');
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
