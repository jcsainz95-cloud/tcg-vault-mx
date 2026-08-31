import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { OrderDetailView } from './OrderDetailView';
import * as api from '@/lib/api';
import type { OrderDetailDTO } from '@/types/contract';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/orders/ord-9003',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/**
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * v1.51-c · contrato §4 «Tolerancia del histórico» · ARCHITECTURE §5.2.9.
 *
 * `GET /orders/:orderId` es la ÚNICA superficie que lee del HISTÓRICO: su `card` es
 * `HistoricalOrderItemCardDTO` y CUALQUIER hecho congelado puede faltar, porque
 * `OrderItem.cardSnapshot` es una columna `Json` que PostgreSQL no valida.
 *
 * Lo que estos tests fijan es exactamente lo que estaba roto: con un blob incompleto la
 * línea NO reventaba y el importe salía bien, pero se pintaba MUDA — nombre `[""]` e
 * `<img alt={null}>`. La causa era un tipo de cliente que prometía `name: string`.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */

/** El peor caso del contrato: blob ausente/no-objeto ⇒ `card` SOLO con `imageSmallUrl: null`. */
const ORDER_WITH_EMPTY_BLOB: OrderDetailDTO = {
  id: 'ord-9003',
  status: 'settled',
  createdAt: '2024-11-02T17:40:00Z',
  settledAt: '2024-11-02T17:41:00Z',
  breakdown: {
    subtotalCents: 8000,
    ivaCents: 1280,
    ivaRatePct: 16,
    processingFeeCents: 645,
    totalCents: 9925,
    currency: 'MXN',
  },
  items: [{ inventoryItemId: 'inv-legacy-3', card: { imageSmallUrl: null }, unitPriceCents: 8000 }],
  cfdiStatus: 'no_aplica',
  invoiceRequested: false,
};

function serve(order: OrderDetailDTO) {
  return vi.spyOn(api, 'getOrder').mockResolvedValue(order);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('OrderDetailView · acta con `cardSnapshot` incompleto (§5.2.9)', () => {
  it('la línea se pinta con etiqueta NEUTRA, nunca cadena vacía ni "undefined"', async () => {
    serve(ORDER_WITH_EMPTY_BLOB);
    renderWithProviders(<OrderDetailView orderId="ord-9003" />, 'es');

    expect(await screen.findByText('Carta sin registro')).toBeInTheDocument();
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
  });

  it('la etiqueta neutra existe también en EN (el contrato la pide en i18n, no hardcodeada)', async () => {
    serve(ORDER_WITH_EMPTY_BLOB);
    renderWithProviders(<OrderDetailView orderId="ord-9003" />, 'en');

    expect(await screen.findByText('Card not recorded')).toBeInTheDocument();
  });

  it('la línea NO desaparece y su importe sale INTACTO (el dinero no vive en el blob)', async () => {
    serve(ORDER_WITH_EMPTY_BLOB);
    renderWithProviders(<OrderDetailView orderId="ord-9003" />, 'es');

    const label = await screen.findByText('Carta sin registro');
    const row = label.closest('div.flex.items-center') as HTMLElement;
    expect(within(row).getByText(/MX\$\s?80\.00/)).toBeInTheDocument();
  });

  it('sin `cardId` no hay miniatura, y el pozo de papel NO deja un `alt` vacío detrás', async () => {
    serve(ORDER_WITH_EMPTY_BLOB);
    renderWithProviders(<OrderDetailView orderId="ord-9003" />, 'es');

    await screen.findByText('Carta sin registro');
    // Sin `src` el componente no emite `<img>` (placeholder quieto, no esqueleto eterno).
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('con miniatura pero SIN nombre, el `alt` lleva la etiqueta neutra (WCAG 1.1.1), no `null`', async () => {
    serve({
      ...ORDER_WITH_EMPTY_BLOB,
      items: [
        {
          inventoryItemId: 'inv-legacy-4',
          card: { imageSmallUrl: 'https://images.pokemontcg.io/base1/4.png' },
          unitPriceCents: 8000,
        },
      ],
    });
    renderWithProviders(<OrderDetailView orderId="ord-9003" />, 'es');

    const img = await screen.findByRole('img');
    expect(img).toHaveAttribute('alt', 'Carta sin registro');
    expect(img.getAttribute('alt')).not.toBe('');
  });

  it('subtítulo: se compone lo registrado y se OMITE lo demás (sin «#» ni «·» huérfanos)', async () => {
    serve({
      ...ORDER_WITH_EMPTY_BLOB,
      items: [
        {
          inventoryItemId: 'inv-legacy-2',
          card: { cardId: 'c-pikachu', name: 'Pikachu', number: '58', imageSmallUrl: null },
          unitPriceCents: 8000,
        },
      ],
    });
    renderWithProviders(<OrderDetailView orderId="ord-9003" />, 'es');

    expect(await screen.findByText('Pikachu')).toBeInTheDocument();
    expect(screen.getByText('#58')).toBeInTheDocument();
    // Sin `productType` no se infiere el tipo ⇒ sin adorno de condición.
    expect(screen.queryByText(/NM/)).not.toBeInTheDocument();
  });

  it('blob COMPLETO: nada cambia — nombre real en `lang="en"` y subtítulo entero', async () => {
    serve({
      ...ORDER_WITH_EMPTY_BLOB,
      items: [
        {
          inventoryItemId: 'inv-1002',
          card: {
            cardId: 'c-charizard',
            name: 'Charizard',
            setName: 'Base Set',
            number: '4',
            productType: 'raw',
            rawCondition: 'NM',
            gradingCompany: null,
            gradeValue: null,
            imageSmallUrl: 'https://images.pokemontcg.io/base1/4.png',
          },
          unitPriceCents: 8000,
        },
      ],
    });
    renderWithProviders(<OrderDetailView orderId="ord-9003" />, 'es');

    const name = await screen.findByText('Charizard');
    expect(name).toHaveAttribute('lang', 'en');
    expect(screen.getByText('Base Set · #4 · NM')).toBeInTheDocument();
    expect(screen.queryByText('Carta sin registro')).not.toBeInTheDocument();
  });

  /**
   * ⛔ EL INVARIANTE MÁS PELIGROSO DE ROMPER (§5.2.9(c), contrato §4 punto 2). El backend ya
   * tiene su guardián del lado servidor; del lado del cliente este test ES el guardián: un
   * hueco NO se rellena consultando el catálogo. El catálogo dice cómo se llama esa carta
   * HOY, no qué decía el pedido cuando se pagó — y en un registro probatorio un dato
   * inventado es peor que un hueco, porque el hueco se ve y el relleno no.
   */
  it('PROHIBIDO rellenar: la vista no consulta el catálogo para tapar el hueco', async () => {
    serve({
      ...ORDER_WITH_EMPTY_BLOB,
      items: [
        // Con `cardId` presente y `name` ausente: el caso donde el relleno SERÍA posible.
        {
          inventoryItemId: 'inv-legacy-5',
          card: { cardId: 'c-charizard', imageSmallUrl: null },
          unitPriceCents: 8000,
        },
      ],
    });
    const detail = vi.spyOn(api, 'getCardDetail');
    const catalog = vi.spyOn(api, 'getCatalog');
    renderWithProviders(<OrderDetailView orderId="ord-9003" />, 'es');

    await screen.findByText('Carta sin registro');
    expect(detail).not.toHaveBeenCalled();
    expect(catalog).not.toHaveBeenCalled();
    // Y no aparece el nombre que HOY tiene esa carta en el catálogo.
    expect(screen.queryByText('Charizard')).not.toBeInTheDocument();
  });
});
