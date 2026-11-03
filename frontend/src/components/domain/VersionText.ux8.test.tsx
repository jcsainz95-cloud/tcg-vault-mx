/**
 * Petición 8 de ux-ui (DESIGN_SYSTEM §IDS-UX.7 punto 8 e IDS-UX.4 «Carrito, checkout, «Mi pedido», correo»; QA
 * 2026-11-03: la captura mostraba «Español» dos veces). En carrito/checkout, «Mi pedido» y el seguimiento del invitado,
 * la línea `muted` bajo las insignias dice SOLO lo que las insignias no dicen:
 *  - ES sin liga ⇒ insignia «Español» y SIN línea (candado: un solo «Español» en el renglón);
 *  - EN de liga ⇒ la insignia del tipo; sin línea si el largo coincide («Prize Pack»), si no el largo («League (League promo)»);
 *  - ES de liga ⇒ «Español» + «De liga» y la línea «De liga (Prize Pack)», nunca «Español · …».
 * El correo y los textos sin insignias (`PRICE_PENDING`, deck) no cambian: esos los fija `CheckoutLines.ids.test.tsx`.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithIntl, renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import type { GuestOrderTrackingDTO, OrderDetailDTO, OrderItemCardDTO, OrderItemPreview, VersionDTO } from '@/types/contract';
import { CheckoutLines } from '@/app/[locale]/(storefront)/checkout/CheckoutLines';
import { OrderDetailView } from '@/app/[locale]/(storefront)/orders/[orderId]/OrderDetailView';
import { PublicOrderTracking } from '@/app/[locale]/pedido/PublicOrderTracking';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/orders/ord-v',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

type Locale = 'es' | 'en';
const PP = { type: 'prize_pack' as const, label: null, productId: 703819 };
const LG = { type: 'league' as const, label: null, productId: 620000001 };
const V = {
  esPlain: { key: 'es', language: 'es', stamp: null },
  esPP: { key: 'es.703819.holofoil', language: 'es', stamp: PP },
  esLG: { key: 'es.620000001.holofoil', language: 'es', stamp: LG },
  enPP: { key: 'en.703819.holofoil', language: 'en', stamp: PP },
  enLG: { key: 'en.620000001.holofoil', language: 'en', stamp: LG },
} satisfies Record<string, VersionDTO>;
type Case = { v: keyof typeof V; locale: Locale; chips: string; line: string | null; lang: string };

// La tabla de IDS-UX.4 «Carrito», en los dos idiomas de la interfaz.
const CASES: Case[] = [
  { v: 'esPlain', locale: 'es', chips: 'Español', line: null, lang: 'Español' },
  { v: 'esPP', locale: 'es', chips: 'EspañolDe liga', line: 'De liga (Prize Pack)', lang: 'Español' },
  { v: 'esLG', locale: 'es', chips: 'EspañolDe liga', line: 'De liga (promo de la Liga)', lang: 'Español' },
  { v: 'enPP', locale: 'es', chips: 'De liga', line: 'De liga (Prize Pack)', lang: 'Español' },
  { v: 'esPlain', locale: 'en', chips: 'Spanish', line: null, lang: 'Spanish' },
  { v: 'esPP', locale: 'en', chips: 'SpanishPrize Pack', line: null, lang: 'Spanish' },
  { v: 'enPP', locale: 'en', chips: 'Prize Pack', line: null, lang: 'Spanish' },
  { v: 'enLG', locale: 'en', chips: 'League', line: 'League (League promo)', lang: 'Spanish' },
];

const count = (text: string, word: string) => text.split(word).length - 1;

/** Comprueba insignias, línea y que el idioma aparezca a lo más una vez en el bloque de la línea. */
function expectLine(chipsTestId: string, textTestId: string, c: Case) {
  const chips = screen.getByTestId(chipsTestId);
  expect(chips.textContent).toBe(c.chips);
  const block = chips.parentElement!;
  const text = within(block).queryByTestId(textTestId);
  expect(text?.textContent ?? null).toBe(c.line);
  // Candado de la petición 8: el idioma no se repite en el renglón (lo dice la insignia, o nada si es inglés).
  expect(count(block.textContent ?? '', c.lang), block.textContent ?? '').toBeLessThanOrEqual(1);
}

const card = {
  cardId: 'c-bird',
  name: 'Nido Ball',
  setName: 'Temporal Forces',
  number: '181',
  productType: 'raw',
  rawCondition: 'NM',
  gradingCompany: null,
  gradeValue: null,
  imageSmallUrl: null,
} as unknown as OrderItemCardDTO;

describe('Petición 8 · carrito / checkout (CheckoutLines)', () => {
  for (const c of CASES) {
    it(`${c.locale} · ${c.v}: insignias «${c.chips}», línea ${c.line ? `«${c.line}»` : 'ninguna'}`, () => {
      const items: OrderItemPreview[] = [{ inventoryItemId: 'inv-1', card, version: V[c.v], finishLabel: 'holo', unitPriceCents: 36000 }];
      renderWithIntl(<CheckoutLines items={items} onRemove={vi.fn()} />, c.locale);
      expectLine('line-version-chips', 'line-version-text', c);
    });
  }
});

describe('Petición 8 · «Mi pedido» (OrderDetailView)', () => {
  for (const c of CASES) {
    it(`${c.locale} · ${c.v}`, async () => {
      const order = {
        id: 'ord-v',
        orderNumber: 'TCG-100500',
        status: 'settled',
        createdAt: '2026-11-03T10:00:00Z',
        settledAt: '2026-11-03T10:01:00Z',
        breakdown: {
          subtotalCents: 36_000,
          ivaCents: 4_966,
          ivaRatePct: 16,
          processingFeeCents: 1_500,
          totalCents: 37_500,
          currency: 'MXN',
          priceConvention: 'IVA_INCLUSIVE',
          ivaIncluded: true,
        },
        items: [{ inventoryItemId: 'inv-1', card: { name: 'Nido Ball', setName: 'Temporal Forces', number: '181', imageSmallUrl: null }, version: V[c.v], unitPriceCents: 36_000 }],
        cfdiStatus: 'no_aplica',
        invoiceRequested: false,
      } as unknown as OrderDetailDTO;
      vi.spyOn(api, 'getOrder').mockResolvedValue(order);
      renderWithProviders(<OrderDetailView orderId="ord-v" />, c.locale);
      await screen.findByTestId('order-line-version-chips');
      expectLine('order-line-version-chips', 'order-line-version-text', c);
    });
  }
});

describe('Petición 8 · seguimiento del invitado (PublicOrderTracking)', () => {
  for (const c of CASES) {
    it(`${c.locale} · ${c.v}`, () => {
      const data = {
        orderNumber: 'TCG-000500',
        status: 'preparando',
        placedAt: '2026-11-03T18:20:00.000Z',
        paidAt: '2026-11-03T18:21:10.000Z',
        emailMasked: 'j***@***.com',
        items: [
          { name: 'Nido Ball', setName: 'Temporal Forces', number: '181', finish: 'holofoil', productType: 'raw', rawCondition: 'NM', version: V[c.v], unitPriceCents: 36_000 },
        ],
        breakdown: {
          subtotalCents: 36_000,
          shippingFeeCents: 17_500,
          ivaCents: 7_380,
          ivaRatePct: 16,
          processingFeeCents: 1_500,
          totalCents: 55_000,
          currency: 'MXN',
          priceConvention: 'IVA_INCLUSIVE',
          ivaIncluded: true,
        },
        shipping: { city: 'Guadalajara', state: 'Jalisco', postalCodeMasked: '***45', recipientNameMasked: 'Juan P.' },
        payment: { brand: 'visa', last4: '4242' },
        claim: { available: true },
        support: { evidenceContact: 'evidencias@ejemplo.test', disputeWindowDays: 7 },
        tokenExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60_000).toISOString(),
      } as unknown as GuestOrderTrackingDTO;
      renderWithProviders(
        <PublicOrderTracking data={data} updatedAt={new Date('2026-11-03T19:00:00.000Z')} isRefreshing={false} onRefresh={vi.fn()} onResendLink={vi.fn()} />,
        c.locale,
      );
      expectLine('tracking-version-chips', 'tracking-version-text', c);
    });
  }
});
