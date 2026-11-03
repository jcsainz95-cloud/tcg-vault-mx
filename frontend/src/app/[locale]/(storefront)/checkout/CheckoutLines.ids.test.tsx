/**
 * IDS-F4 (API_CONTRACT §IDS.9, criterios 518 y 964) — carrito, pedido y seguimiento pintan la `version` DEL SERVIDOR;
 * dos versiones de la misma carta nunca se funden en «2×»; `PRICE_PENDING` con `details.items[].version` nombra la
 * versión.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { renderWithIntl } from '@/test/render';
import { useErrorMessage } from '@/components/ui/QueryState';
import { ApiClientError } from '@/lib/api-client';
import type { OrderItemCardDTO, OrderItemPreview } from '@/types/contract';
import { CheckoutLines } from './CheckoutLines';
import es from '../../../../../messages/es.json';
import en from '../../../../../messages/en.json';

const card: OrderItemCardDTO = {
  cardId: 'c-poffin',
  name: 'Buddy-Buddy Poffin',
  setName: 'Temporal Forces',
  number: '144',
  productType: 'raw',
  rawCondition: 'NM',
  gradingCompany: null,
  gradeValue: null,
  imageSmallUrl: null,
} as unknown as OrderItemCardDTO;

const PP = { type: 'prize_pack' as const, label: 'Cosmos Holo', productId: 703819 };
const lines: OrderItemPreview[] = [
  { inventoryItemId: 'inv-en', card, version: { key: 'en', language: 'en', stamp: null }, finishLabel: 'non_holo', unitPriceCents: 20000 },
  { inventoryItemId: 'inv-es-pp', card, version: { key: 'es.703819', language: 'es', stamp: PP }, finishLabel: 'cosmos_holo', unitPriceCents: 36000 },
];

describe('IDS-F4 · líneas del carrito', () => {
  it('cada pieza es su línea (nunca «2×»); la española de liga lleva insignias y «De liga (Prize Pack)» (petición 8: sin repetir «Español»)', () => {
    const { container } = renderWithIntl(<CheckoutLines items={lines} onRemove={vi.fn()} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(container.textContent).not.toMatch(/2\s*×|×\s*2/);
    const chips = screen.getAllByTestId('line-version-chips');
    expect(chips).toHaveLength(1); // inglés sin liga: sin insignia
    expect(chips[0].textContent).toBe('EspañolDe liga');
    expect(screen.getByTestId('line-version-text').textContent).toBe('De liga (Prize Pack)');
    // el `label` del proveedor no sale al cliente; tampoco «sello»
    expect(container.textContent).not.toMatch(/Cosmos Holo|sello/i);
  });

  it('EN: insignias «Spanish»+«Prize Pack» y sin línea (el tipo largo coincide con la insignia; petición 8)', () => {
    renderWithIntl(<CheckoutLines items={lines} onRemove={vi.fn()} />, 'en');
    expect(screen.getByTestId('line-version-chips').textContent).toBe('SpanishPrize Pack');
    expect(screen.queryByTestId('line-version-text')).toBeNull();
  });
});

function wrapper(locale: 'es' | 'en') {
  const W = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale={locale} messages={locale === 'es' ? es : en}>
      {children}
    </NextIntlClientProvider>
  );
  return W;
}

describe('IDS-F4 · PRICE_PENDING nombra la versión', () => {
  const err = (version: unknown) =>
    new ApiClientError(422, {
      code: 'PRICE_PENDING',
      message: 'pending',
      details: { items: [{ inventoryItemId: 'inv-es-pp', version }] },
    });

  it('español de liga ⇒ el mensaje dice «Español · De liga (Prize Pack)» y que no se cobra otra versión', () => {
    const { result } = renderHook(() => useErrorMessage(), { wrapper: wrapper('es') });
    const msg = result.current(err({ key: 'es.703819', language: 'es', stamp: PP }));
    expect(msg).toContain('Español · De liga (Prize Pack)');
    expect(msg).toMatch(/no te cobramos otra versión/);
  });
  it('inglés sin liga o sin details ⇒ el copy de siempre', () => {
    const { result } = renderHook(() => useErrorMessage(), { wrapper: wrapper('es') });
    expect(result.current(err({ key: 'en', language: 'en', stamp: null }))).toBe(es.error.PRICE_PENDING);
    expect(result.current(new ApiClientError(422, { code: 'PRICE_PENDING', message: 'x' }))).toBe(es.error.PRICE_PENDING);
  });
  it('EN', () => {
    const { result } = renderHook(() => useErrorMessage(), { wrapper: wrapper('en') });
    expect(result.current(err({ key: 'es', language: 'es', stamp: null }))).toContain('The Spanish version');
  });
});
