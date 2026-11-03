/**
 * IDS-F5 (API_CONTRACT §IDS.9, criterios 963–965; §IDS.6; DESIGN_SYSTEM §IDS-UX.5) — `DeckAvailability` con `units[]`:
 * un tramo por versión en el orden del servidor; inglés puro sin insignia; una sola versión no inglesa ⇒ insignias +
 * `detail()` (petición 9a: nunca repite el idioma); el «de jalón» agrega lo de siempre (`unitInventoryItemIds`, el surtido lo decide backend).
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

  it('una sola versión de liga: insignias + «De liga (Prize Pack)» bajo el nombre (petición 9a)', () => {
    renderWithProviders(
      <DeckAvailability
        groups={groups(line({ availableQty: 1, unitInventoryItemIds: ['inv-pp'], units: [{ version: ES_PP, qty: 1, unitPriceMxnCents: 36000, inventoryItemIds: ['inv-pp'] }] }))}
      />,
    );
    expect(screen.getByTestId('deck-version-chips').textContent).toBe('EspañolDe liga');
    // Petición 9a (IDS-UX.5/IDS-UX.7): junto a insignias, `detail()` — nunca repite el idioma.
    expect(screen.getByText('De liga (Prize Pack)')).toBeInTheDocument();
    expect(screen.queryByText('Español · De liga (Prize Pack)')).toBeNull();
  });

  it('petición 9a · ES sin liga: solo la insignia «Español», sin un segundo «Español» en el renglón', () => {
    renderWithProviders(
      <DeckAvailability
        groups={groups(line({ availableQty: 1, unitInventoryItemIds: ['inv-es'], units: [{ version: ES, qty: 1, unitPriceMxnCents: 15000, inventoryItemIds: ['inv-es'] }] }))}
      />,
    );
    const row = screen.getByTestId('deck-line-version');
    expect(row.textContent).toBe('Español');
    expect(row.textContent!.match(/Español/g)).toHaveLength(1);
  });

  it('petición 9a · tienda en inglés, EN de liga coincidente (Prize Pack): solo la insignia, sin línea muted', () => {
    const EN_PP = { key: 'en.565451', language: 'en' as const, stamp: { type: 'prize_pack' as const, label: null, productId: 565451 } };
    renderWithProviders(
      <DeckAvailability
        groups={groups(line({ availableQty: 1, unitInventoryItemIds: ['inv-pp'], units: [{ version: EN_PP, qty: 1, unitPriceMxnCents: 36000, inventoryItemIds: ['inv-pp'] }] }))}
      />,
      'en',
    );
    const row = screen.getByTestId('deck-line-version');
    expect(row.querySelector('p')).toBeNull();
    expect(screen.getByTestId('deck-version-chips').textContent).toBe('Prize Pack');
    expect(row.textContent).toBe('Prize Pack');
  });
});
