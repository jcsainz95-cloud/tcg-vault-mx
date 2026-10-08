import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import type { SellRequirements } from '@/hooks/useSellRequirements';
import type { CartLine } from './useSellCart';
import { SellCartContents, type SellCartContentsProps } from './SellCartContents';

/**
 * §BMK (API_CONTRACT §BMK.3–§BMK.5 · DESIGN_SYSTEM §BMK.5, §BMK.11) — renglón del carrito de venta:
 * «Valor de mercado c/u» y «Te pagamos c/u» A LA VISTA (sin abrir «Detalle»), con la MISMA regla
 * (`visibleMarketCents`); la fila «Valor de referencia» de «Detalle» se retira; el total no cambia.
 */
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

const sellReq: SellRequirements = {
  ready: true,
  isAuthenticated: true,
  emailVerified: true,
  emailBlocked: false,
  kycLoading: false,
  clabeOnFile: true,
  ineOnFile: true,
  ineExpected: false,
  canSubmit: true,
};

function line(
  id: string,
  name: string,
  quantity: number,
  status: 'cotizada' | 'precio_pendiente',
  cents: number | null,
  referencePrice: CartLine['quote']['referencePrice'],
): CartLine {
  return {
    id,
    card: { id: `c-${id}`, name, number: '1', setPtcgoCode: null },
    productType: 'raw',
    finish: 'normal',
    quantity,
    quote: {
      rarity: 'Rare',
      finish: 'normal',
      priceBasis: status === 'cotizada' ? 'market' : 'pending',
      quote: { status, quotedPriceCents: cents, currency: 'MXN' },
      referencePrice,
      paymentNotice: 'PAY_AFTER_RECEIPT',
    },
  };
}

function render(cart: CartLine[], extra: Partial<SellCartContentsProps> = {}, locale: 'es' | 'en' = 'es') {
  const totalEstimatedCents = cart.reduce(
    (s, l) => s + (l.quote.quote.status === 'cotizada' ? (l.quote.quote.quotedPriceCents ?? 0) * l.quantity : 0),
    0,
  );
  const pendingCardCount = cart.reduce(
    (s, l) => s + (l.quote.quote.status === 'precio_pendiente' ? l.quantity : 0),
    0,
  );
  return renderWithIntl(
    <SellCartContents
      cart={cart}
      sellReq={sellReq}
      expandedLines={{}}
      totalEstimatedCents={totalEstimatedCents}
      pendingCardCount={pendingCardCount}
      cartCount={cart.reduce((s, l) => s + l.quantity, 0)}
      onSetQuantity={() => {}}
      onRemoveLine={() => {}}
      onToggleLineDetail={() => {}}
      onClearCart={() => {}}
      onSubmit={() => {}}
      {...extra}
    />,
    locale,
  );
}

const lineEl = (name: string) => {
  const li = screen.getByText(name).closest('li');
  if (!li) throw new Error(`sin renglón para ${name}`);
  return li as HTMLElement;
};

describe('§BMK · renglón del carrito de venta', () => {
  it('BMK-F5 / BMK-UX-3: mercado y te pagamos POR UNIDAD a la vista, sin abrir «Detalle»; subtotal = pago × 2', () => {
    render([line('a', 'Alpha', 2, 'cotizada', 50_000, { status: 'priced', priceMxnCents: 100_000 })]);
    const li = lineEl('Alpha');
    // «Detalle» cerrado: aun así los dos pares están a la vista.
    expect(within(li).getByRole('button', { name: 'Detalle del estimado' })).toHaveAttribute('aria-expanded', 'false');
    const dl = li.querySelector('dl');
    expect(dl).not.toBeNull();
    expect(Array.from(dl!.querySelectorAll('dt, dd')).map((n) => n.textContent)).toEqual([
      'Valor de mercado c/u',
      'MX$1,000.00',
      'Te pagamos c/u',
      'MX$500.00',
    ]);
    // Subtotal (cifra héroe de la línea) = te pagamos × cantidad, como hoy.
    expect(li).toHaveTextContent('MX$1,000.00');
    expect(within(li).getAllByText('MX$1,000.00')).toHaveLength(2); // subtotal y mercado c/u
    // Ni «Estimado c/u» ni «Valor de referencia».
    expect(li).not.toHaveTextContent('Estimado c/u');
    expect(li).not.toHaveTextContent('Valor de referencia');
  });

  it('BMK-F5: con «Detalle» abierto no aparece «Valor de referencia» en ningún estado', () => {
    render(
      [
        line('a', 'Alpha', 1, 'cotizada', 50_000, { status: 'priced', priceMxnCents: 100_000 }),
        line('b', 'Beta', 1, 'precio_pendiente', null, { status: 'priced', priceMxnCents: 77_700 }),
      ],
      { expandedLines: { a: true, b: true } },
    );
    expect(screen.queryByText('Valor de referencia')).toBeNull();
    expect(screen.queryByText('Estimado c/u')).toBeNull();
  });

  it('BMK-F5 (desviación (f)1): línea precio_pendiente con mercado priced ⇒ sin mercado, ni a la vista ni en «Detalle»', () => {
    render([line('b', 'Beta', 1, 'precio_pendiente', null, { status: 'priced', priceMxnCents: 77_700 })], {
      expandedLines: { b: true },
    });
    const li = lineEl('Beta');
    expect(li).not.toHaveTextContent('MX$777.00');
    expect(li).not.toHaveTextContent('Valor de mercado');
    // «Te pagamos c/u» sigue, con la versalita de pendiente en el sitio de la cifra.
    expect(li).toHaveTextContent('Te pagamos c/u');
    expect(within(li).getAllByTestId('buylist-pending-label').length).toBeGreaterThan(0);
  });

  it('BMK-F3 (carrito): cotizada sin mercado o con mercado 0 ⇒ sin fila de mercado, sin «MX$0.00»', () => {
    render([
      line('g', 'Gamma', 1, 'cotizada', 30_000, { status: 'pending' }),
      line('d', 'Delta', 1, 'cotizada', 8_000, { status: 'priced', priceMxnCents: 0 }),
    ]);
    for (const name of ['Gamma', 'Delta']) {
      const li = lineEl(name);
      expect(li).not.toHaveTextContent('Valor de mercado');
      expect(li).not.toHaveTextContent('MX$0.00');
      expect(li).toHaveTextContent('Te pagamos c/u');
    }
  });

  it('BMK-UX-4: recotizando con cotización guardada CON mercado ⇒ las dos filas existen y pintan «—», nunca la cifra vieja', () => {
    render([line('a', 'Alpha', 1, 'cotizada', 50_000, { status: 'priced', priceMxnCents: 100_000 })], {
      requoting: true,
    });
    const li = lineEl('Alpha');
    const dl = li.querySelector('dl');
    expect(Array.from(dl!.querySelectorAll('dt, dd')).map((n) => n.textContent)).toEqual([
      'Valor de mercado c/u',
      '—',
      'Te pagamos c/u',
      '—',
    ]);
    expect(li).not.toHaveTextContent('MX$1,000.00');
    expect(li).not.toHaveTextContent('MX$500.00');
  });

  it('BMK-UX-4: recotización fallida con cotización guardada SIN mercado ⇒ no hay fila de mercado', () => {
    render([line('g', 'Gamma', 1, 'cotizada', 30_000, { status: 'pending' })], { requoteFailed: true });
    const li = lineEl('Gamma');
    const dl = li.querySelector('dl');
    expect(Array.from(dl!.querySelectorAll('dt, dd')).map((n) => n.textContent)).toEqual(['Te pagamos c/u', '—']);
    expect(li).not.toHaveTextContent('MX$300.00');
  });

  it('BMK-UX-1 (carrito): mismas clases en los dd gane quien gane, sin line-through', () => {
    render([
      line('a', 'Alpha', 1, 'cotizada', 50_000, { status: 'priced', priceMxnCents: 100_000 }),
      line('e', 'Epsilon', 1, 'cotizada', 100, { status: 'priced', priceMxnCents: 50 }),
    ]);
    const [aM, aP] = Array.from(lineEl('Alpha').querySelectorAll('dl dd'));
    const [eM, eP] = Array.from(lineEl('Epsilon').querySelectorAll('dl dd'));
    expect(aM.className).toBe(eM.className);
    expect(aP.className).toBe(eP.className);
    for (const el of [aM, aP, eM, eP]) expect(el.className).not.toMatch(/line-through/);
  });
});

describe('§BMK · el total no cambia (BMK-F6, criterio 856)', () => {
  it('dos cartas 50 000 + 8 000 ⇒ «Valor de tus cartas» MX$580.00, una sola cifra y ningún «mercado»', () => {
    render([
      line('a', 'Alpha', 1, 'cotizada', 50_000, { status: 'priced', priceMxnCents: 100_000 }),
      line('h', 'Eta', 1, 'cotizada', 8_000, { status: 'priced', priceMxnCents: 20_000 }),
    ]);
    const money = screen.getByTestId('sell-cart-money');
    expect(money).toHaveTextContent('Valor de tus cartas');
    expect(money).toHaveTextContent('MX$580.00');
    expect(money.textContent?.match(/MX\$[\d,]+\.\d\d/g)).toEqual(['MX$580.00']);
    expect(money).not.toHaveTextContent(/mercado/i);
    // La suma de mercados (MX$1,200.00) no aparece en ningún sitio.
    expect(document.body).not.toHaveTextContent('MX$1,200.00');
  });
});

// F7: «%» en cualquier forma, y las palabras de proporción/ahorro como palabras completas (no
// subcadenas: «Halfling», «Mitadori» o «Saved Game» como nombre propio no son una comparación).
const F7_FORBIDDEN = /%|\bmitad(es)?\b|\bhalf\b|\bahorr\w*|\bsav(e|es|ed|ing|ings)\b/i;
// `textContent` pega `<dt>` y `<dd>` sin espacio («Te pagamos la mitadMX$500.00»), y eso borra el
// límite de palabra: se lee nodo de texto a nodo de texto, separados por un espacio.
function f7Text(el: Element): string {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.textContent ?? '');
  return parts.join(' ');
}

describe('§BMK · BMK-F7: sin porcentajes, proporciones ni «ahorro» en el carrito (es y en)', () => {
  it.each(['es', 'en'] as const)('%s', (locale) => {
    const { container } = render(
      [
        line('a', 'Alpha', 2, 'cotizada', 50_000, { status: 'priced', priceMxnCents: 100_000 }),
        line('b', 'Beta', 1, 'precio_pendiente', null, { status: 'pending' }),
      ],
      { expandedLines: { a: true, b: true } },
      locale,
    );
    // TD-BMK-6: la lista negra se aplica SOLO a los bloques de precio (por renglón y el total), no a
    // todo el contenedor: un nombre de carta o un rótulo ajeno al precio no debe poner rojo F7.
    const blocks = Array.from(
      container.querySelectorAll('[data-testid="sell-cart-line-prices"], [data-testid="sell-cart-money"]'),
    );
    expect(blocks.filter((b) => b.matches('[data-testid="sell-cart-line-prices"]'))).toHaveLength(2);
    expect(blocks.some((b) => b.matches('[data-testid="sell-cart-money"]'))).toBe(true);
    const text = blocks.map(f7Text).join(' ');
    expect(text).toContain(locale === 'es' ? 'Valor de mercado c/u' : 'Market value per card');
    expect(text).not.toMatch(F7_FORBIDDEN);
  });
});
