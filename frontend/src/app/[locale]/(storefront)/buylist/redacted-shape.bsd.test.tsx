import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { setStoredUser } from '@/lib/session';
import * as fx from '@/lib/mock/fixtures';
import type { SellItemDTO, SellRequestDTO, SellRequestDetailDTO, SellRequestExpiryReason } from '@/types/contract';
import { MyRequestsSection } from './MyRequestsSection';
import { SellRequestDetailView } from './requests/[id]/SellRequestDetailView';

/**
 * 💰 rev BSD-1 — **la forma REAL del servidor en un cierre redactado** (errata BSD-1.4 punto 8, `toCustomerSellRequestDTO`,
 * `BACKEND_NOTES §78.B5` p. 8, prueba BSD-B41): en `expirada` + `no_offer`/`not_continued`, `quotedTotalCents = null`, las
 * cuatro cifras de cada línea (`quotedPriceCents`, `approvedPriceCents`, `offeredPriceCents`, `marketMxnCents`) `null`
 * explícito y, en el detalle, `offer: null` (el stepper pierde las fechas de la oferta).
 *
 * Afirma que el portal, la lista de «Ventas» y el detalle se pintan sin romperse y sin `MX$`, «MX$0.00», `NaN`,
 * `undefined` ni «pendiente», con líneas en varios estados (incluida una `ajustada`, cuyo bloque leería
 * `approvedPriceCents` sin guarda). Y que el servidor FALSO proyecta esa misma forma (B41: ninguna `*Cents` ≠ `null`).
 */
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/buylist/requests/sr-x',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const CARD = {
  id: 'c-1', externalId: 'x-1', name: 'Charizard VMAX', number: '020/189', rarity: 'Rare Holo', supertype: 'Pokémon',
  subtypes: [], setId: 's-1', setName: 'Darkness Ablaze', setPtcgoCode: null, imageSmallUrl: '', imageLargeUrl: '',
  availableFinishes: ['holofoil' as const],
};
/** Línea TAL COMO la manda el servidor redactado: las cuatro claves presentes con `null`. */
function redactedLine(id: string, itemStatus: SellItemDTO['itemStatus']): SellItemDTO {
  return {
    id, card: { ...CARD, id: `c-${id}` }, productType: 'raw', rawCondition: 'NM', finish: 'holofoil', itemStatus,
    quotedPriceCents: null, approvedPriceCents: null, offeredPriceCents: null, marketMxnCents: null, offerDecision: 'buy',
  };
}
const LINES = [redactedLine('a', 'cotizada'), redactedLine('b', 'ajustada'), redactedLine('c', 'rechazada')];
function listRow(reason: SellRequestExpiryReason): SellRequestDTO {
  return {
    sellRequestId: `sr-${reason}`, status: 'expirada', expiredReason: reason, isTerminal: true, quotedTotalCents: null,
    ineRequired: false, labelPdfAvailable: false, createdAt: '2026-09-20T14:00:00.000Z', items: LINES,
  };
}
function detailRow(reason: SellRequestExpiryReason): SellRequestDetailDTO {
  return {
    ...listRow(reason), offer: null, lastOfferCancelledAt: null,
    pickupAddress: { line1: 'Calle 1', neighborhood: 'Centro', city: 'Guadalajara', state: 'Jalisco', postalCode: '44100', country: 'MX', phone: '3300000000', capturedAt: '2026-09-20T14:00:00.000Z' },
  };
}
const BAD = /MX\$|NaN|undefined|pendiente|null/i;

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  setStoredUser({ id: 'u-1', email: 'ash@example.com', name: 'Ash', role: 'customer', locale: 'es', emailVerified: true });
});

describe.each(['not_continued', 'no_offer'] as const)('forma redactada real · `%s`', (reason) => {
  it('«Ventas»: el renglón se pinta, con su insignia, sin cifras ni restos', async () => {
    vi.spyOn(api, 'getSellRequests').mockResolvedValue([listRow(reason)]);
    renderWithProviders(<MyRequestsSection ready isAuthenticated />);
    await screen.findByText(`sr-${reason}`);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(BAD);
    expect(text).toContain(reason === 'not_continued' ? 'No continuó' : 'No procedió');
    // El bloque de «ajuste» no se ofrece sobre un cierre.
    expect(screen.queryByRole('button', { name: /Aceptar/ })).toBeNull();
  });

  it('detalle con `offer: null`: el portal y su stepper se pintan; frase de cierre; sin cifras ni restos', async () => {
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(detailRow(reason));
    renderWithProviders(<SellRequestDetailView sellRequestId={`sr-${reason}`} />);
    await screen.findByText(
      reason === 'not_continued'
        ? 'Tras una revisión adicional, decidimos no continuar con esta venta. La solicitud queda cerrada y no se compró ninguna carta.'
        : 'No procedimos con la oferta.',
    );
    await waitFor(() => expect(screen.getAllByText('Charizard VMAX').length).toBe(3));
    expect(document.body.textContent ?? '').not.toMatch(BAD);
    expect(screen.queryByTestId('offer-amounts')).toBeNull();
    expect(screen.getByText('Cotizar de nuevo')).toBeInTheDocument();
  });
});

describe('BSD-B41 en el servidor falso · la proyección redacta como el real', () => {
  /** Todas las claves `*Cents` del DTO, en recorrido recursivo. */
  function cents(o: unknown, out: [string, unknown][] = [], path = ''): [string, unknown][] {
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) {
        const p = path ? `${path}.${k}` : k;
        if (/Cents$/.test(k)) out.push([p, v]);
        cents(v, out, p);
      }
    }
    return out;
  }
  it('`sr-3005` (not_continued): lista y detalle sin ninguna `*Cents` ≠ null; `offer: null`', () => {
    const row = fx.mockSellRequests.find((r) => r.sellRequestId === 'sr-3005')!;
    const list = fx.mockSellRequestDTO(row);
    const detail = fx.mockSellRequestDetailDTO(row);
    expect(cents(list).filter(([, v]) => v !== null)).toEqual([]);
    expect(cents(detail).filter(([, v]) => v !== null)).toEqual([]);
    expect(cents(list).length).toBeGreaterThan(0); // CONTROL: el recorrido ve claves.
    expect(detail.offer).toBeNull();
    expect(detail.labelPdfAvailable).toBe(false);
  });
  it('CONTROL: `sr-3004` (aceptada) sí trae cifras y oferta', () => {
    const row = fx.mockSellRequests.find((r) => r.sellRequestId === 'sr-3004')!;
    expect(fx.mockSellRequestDetailDTO(row).offer).not.toBeNull();
    expect(cents(fx.mockSellRequestDTO(row)).some(([, v]) => typeof v === 'number')).toBe(true);
  });
});
