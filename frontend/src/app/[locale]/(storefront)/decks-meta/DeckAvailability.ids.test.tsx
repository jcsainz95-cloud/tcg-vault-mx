/**
 * IDS-F5 (API_CONTRACT §IDS.9, criterios 963–965; §IDS.6; DESIGN_SYSTEM §IDS-UX.5) — `DeckAvailability` con `units[]`:
 * un tramo por versión en el orden del servidor; inglés puro sin insignia; una sola versión no inglesa ⇒ insignias +
 * texto largo; el «de jalón» agrega lo de siempre (`unitInventoryItemIds`, el surtido lo decide backend).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import type { MetaDeckGroupsDTO, MetaDeckLineDTO } from '@/types/contract';

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { DeckAvailability } from './DeckAvailability';

const EN = { key: 'en', language: 'en' as const, stamp: null };
const ES = { key: 'es', language: 'es' as const, stamp: null };
const ES_PP = { key: 'es.565451', language: 'es' as const, stamp: { type: 'prize_pack' as const, label: null, productId: 565451 } };

function line(over: Partial<MetaDeckLineDTO>): MetaDeckLineDTO {
  return {
    rawName: 'Buddy-Buddy Poffin',
    setCode: 'TEF',
    number: '144',
    quantity: 4,
    group: 'trainer',
    matchStatus: 'matched',
    card: { cardId: 'c1', name: 'Buddy-Buddy Poffin', imageUrl: 'https://img/x.png' },
    availableQty: 3,
    unitPriceMxnCents: 15000,
    unitInventoryItemIds: ['inv-es', 'inv-en', 'inv-pp'],
    ...over,
  };
}
const groups = (l: MetaDeckLineDTO): MetaDeckGroupsDTO => ({ pokemon: [], trainer: [l], energy: [] });

describe('IDS-F5 · DeckAvailability con units[]', () => {
  it('mezcla: un tramo por units[] en su orden; el inglés como texto, los demás con insignia', () => {
    renderWithProviders(
      <DeckAvailability
        groups={groups(
          line({
            units: [
              { version: ES, qty: 1, unitPriceMxnCents: 15000, inventoryItemIds: ['inv-es'] },
              { version: EN, qty: 1, unitPriceMxnCents: 20000, inventoryItemIds: ['inv-en'] },
              { version: ES_PP, qty: 1, unitPriceMxnCents: 36000, inventoryItemIds: ['inv-pp'] },
            ],
          }),
        )}
      />,
    );
    const tramos = screen.getAllByTestId('deck-unit-tramo');
    expect(tramos.map((t) => t.textContent)).toEqual([
      'Español×1 · MX$150.00',
      'Inglés×1 · MX$200.00',
      'EspañolDe liga×1 · MX$360.00',
    ]);
    expect(tramos[1].querySelector('[data-version-chip]')).toBeNull();
  });

  it('inglés puro (o sin units[]): ninguna insignia ni tramo', () => {
    const { unmount } = renderWithProviders(
      <DeckAvailability groups={groups(line({ units: [{ version: EN, qty: 3, unitPriceMxnCents: 15000, inventoryItemIds: ['a', 'b', 'c'] }] }))} />,
    );
    expect(screen.queryByTestId('deck-line-version')).toBeNull();
    expect(document.querySelector('[data-version-chip]')).toBeNull();
    unmount();
    renderWithProviders(<DeckAvailability groups={groups(line({}))} />);
    expect(screen.queryByTestId('deck-line-version')).toBeNull();
  });

  it('una sola versión de liga: insignias + «Español · De liga (Prize Pack)» bajo el nombre', () => {
    renderWithProviders(
      <DeckAvailability
        groups={groups(line({ availableQty: 1, unitInventoryItemIds: ['inv-pp'], units: [{ version: ES_PP, qty: 1, unitPriceMxnCents: 36000, inventoryItemIds: ['inv-pp'] }] }))}
      />,
    );
    expect(screen.getByTestId('deck-version-chips').textContent).toBe('EspañolDe liga');
    expect(screen.getByText('Español · De liga (Prize Pack)')).toBeInTheDocument();
  });
});
