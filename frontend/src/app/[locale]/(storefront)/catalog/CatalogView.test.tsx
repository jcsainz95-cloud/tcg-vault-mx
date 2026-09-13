import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { CatalogView } from './CatalogView';

// Aisla la vista del router de Next (mismo patrón que BuylistView.test). El `replace`
// es un espía ESTABLE (hoisted): D-EQ-3 asserta a dónde manda la vista al llegar un
// enlace de sellado, y con un `vi.fn()` nuevo por llamada no habría nada que mirar.
const { routerSpies } = vi.hoisted(() => ({
  routerSpies: { push: vi.fn(), replace: vi.fn() },
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => routerSpies,
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// StoreTabs y CatalogView leen la query con useSearchParams (pestaña Gradeadas
// ?type=graded y enlaces del Home ?setId=/?productType=). Holder mutable por test.
const { urlParams } = vi.hoisted(() => ({ urlParams: { current: new URLSearchParams() } }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => urlParams.current,
}));

beforeEach(() => {
  vi.restoreAllMocks();
  routerSpies.push.mockClear();
  routerSpies.replace.mockClear();
  window.localStorage.clear();
  urlParams.current = new URLSearchParams();
});

/**
 * Feedback al agregar desde la vitrina: el CTA vive en la teja propia de la
 * vista (CatalogTile, makeover 1a) y la confirmación es el toast (§7.5) +
 * el estado «En el carrito» de la teja (N-17).
 */
describe('CatalogView · toast de confirmación al agregar', () => {
  it('clic en «Añadir al carrito» guarda la pieza y muestra el toast con enlace al carrito', async () => {
    renderWithProviders(<CatalogView />, 'es');

    // La región aria-live existe desde el inicio, vacía.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    const addButtons = await screen.findAllByRole('button', { name: 'Añadir al carrito' });
    fireEvent.click(addButtons[0]);

    expect(screen.getByRole('status')).toHaveTextContent('Agregado al carrito');
    expect(screen.getByRole('link', { name: 'Ver carrito' })).toHaveAttribute('href', '/checkout');
    // Formato v2 del carrito: { ids, updatedAt } (expiración a 30 días).
    expect(JSON.parse(window.localStorage.getItem('tcg.cart')!).ids).toHaveLength(1);
  });
});

/**
 * v1.38-grouped-listings (P-30): la vitrina se construye contra el shape AGRUPADO
 * (`GroupedListingDTO`): UNA teja por (carta, variante, condición), no una por copia
 * física. El badge muestra el `stockCount` REAL del grupo.
 */
describe('CatalogView · una teja por grupo con stock real (v1.38)', () => {
  it('colapsa las 3 copias del mismo Blastoise raw NM en UNA teja con «3 en stock»', async () => {
    renderWithProviders(<CatalogView />, 'es');
    await screen.findAllByRole('button', { name: 'Añadir al carrito' });

    // Las tres piezas físicas (inv-1002 / -1002b / -1002c) comparten variante ⇒ UNA sola teja.
    expect(screen.getAllByText('Blastoise')).toHaveLength(1);
    // El distintivo de stock refleja el conteo agregado REAL del grupo, no «Queda 1».
    expect(screen.getByText('3 en stock')).toBeInTheDocument();
  });
});

/**
 * Los enlaces del Home llegan con query (?setId=<id>, ?productType=graded):
 * la vista inicializa sus filtros desde la URL al montar y los pinta como
 * chips removibles (mismo estado que si se hubieran elegido en el panel).
 */
describe('CatalogView · filtros iniciales desde la URL (enlaces del Home)', () => {
  it('?setId= y ?productType=graded se aplican al montar (chips activos)', async () => {
    urlParams.current = new URLSearchParams('setId=base1&productType=graded');
    renderWithProviders(<CatalogView />, 'es');

    // Chips removibles de los dos filtros que vinieron en la URL. El chip de set
    // muestra el NOMBRE desde las facetas (QA-1), no el id crudo.
    expect(await screen.findByRole('button', { name: /Base Set/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /graded/ })).toBeInTheDocument();
  });

  it('un productType inválido en la URL se ignora (sin chip, sin romper)', async () => {
    urlParams.current = new URLSearchParams('productType=oro');
    renderWithProviders(<CatalogView />, 'es');

    await screen.findAllByRole('button', { name: 'Añadir al carrito' });
    expect(screen.queryByRole('button', { name: /oro/ })).toBeNull();
  });
});

/**
 * v1.44-graded-estimate · §22 R3: acoplamiento llamada ↔ nota al pie A NIVEL DE PÁGINA.
 * «Ninguna cifra estimada en una página cuyo DOM no contenga la nota al pie, y ninguna nota
 * huérfana»: la condición es UNA sola y se reevalúa al filtrar/paginar.
 */
describe('CatalogView · §22.4b nota al pie de Compra', () => {
  it('si la página muestra ≥1 badge, la página renderiza su nota al pie completa', async () => {
    renderWithProviders(<CatalogView />, 'es');
    await screen.findAllByRole('button', { name: 'Añadir al carrito' });

    // Los fixtures traen cartas destacadas (gate de ROI resuelto server-side). Cada cifra lleva su
    // micro-aviso VISIBLE (R3.1): es el portador del aviso en el listado, donde nadie baja al pie.
    expect(screen.getAllByText(/no evaluamos esta carta/i).length).toBeGreaterThan(0);
    expect(document.getElementById('nota-estimado')).toBeInTheDocument();
    expect(screen.getByText(/INFORMACIÓN ILUSTRATIVA/)).toBeInTheDocument();
    // La nota cierra con el enlace de regreso a los resultados (viaje de ida y vuelta).
    expect(document.getElementById('catalogo-resultados')).toBeInTheDocument();
  });

  it('una página SIN badges (pestaña Gradeadas) no pinta cifra ni nota: la condición es la misma', async () => {
    urlParams.current = new URLSearchParams('type=graded');
    renderWithProviders(<CatalogView />, 'es');
    await screen.findAllByRole('button', { name: 'Añadir al carrito' });

    expect(screen.queryByText(/no evaluamos esta carta/i)).not.toBeInTheDocument();
    expect(document.getElementById('nota-estimado')).toBeNull();
    expect(screen.queryByText(/INFORMACIÓN ILUSTRATIVA/)).not.toBeInTheDocument();
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * D-EQ-3 · UN ENLACE DE SELLADO NO PUEDE MORIR EN LA REJILLA DE SINGLES
 * ═══════════════════════════════════════════════════════════════════════════════════
 * `GET /catalog/cards` **excluye el sellado por construcción** (guardarraíl `H9`,
 * `catalog.service.ts` `singlesPublishedWhere`), y el contrato v1.73 (§2) retiró
 * `?sealedSubtype=` y le quitó `sealed` a `?productType=`.
 *
 * MEDIDO CONTRA EL SERVIDOR REAL (2026-09-13, stack nativo `1e37c6b`, con UN sellado
 * `box` PUBLICADO — `GET /catalog/sealed` ⇒ `total: 1`):
 *   · `GET /catalog/cards?productType=sealed`  ⇒ `total: 0`
 *   · `GET /catalog/cards?sealedSubtype=box`   ⇒ `total: 0`
 * y en el navegador `/es/compra?productType=sealed` ⇒ «Ninguna carta coincide».
 * Contra MOCKS la misma URL pintaba tejas (los fixtures traen `box` y `etb`): la
 * pantalla se veía bien en desarrollo y vacía contra el servidor.
 *
 * La cura no es «arreglar el filtro» (eso derogaría `H9`): es dejar de mandar el
 * parámetro Y llevar al usuario a la vitrina que SÍ sirve sellado (§2-S, `/sellado`),
 * conservando la presentación, que es el único filtro con equivalente EXACTO ahí.
 */
describe('CatalogView · D-EQ-3: el sellado tiene su propia vitrina, no un callejón sin salida', () => {
  it('?productType=sealed NO consulta la rejilla de singles: manda a /sellado', async () => {
    urlParams.current = new URLSearchParams('productType=sealed');
    renderWithProviders(<CatalogView />, 'es');

    await vi.waitFor(() => expect(routerSpies.replace).toHaveBeenCalledWith('/sellado?from=compra'));
    // Y NO se pinta la rejilla de singles: ni tejas, ni el vacío «Ninguna carta coincide»,
    // que es justo lo que el usuario veía hoy sin ninguna explicación.
    expect(screen.queryByText('Ninguna carta coincide')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Añadir al carrito' })).not.toBeInTheDocument();
  });

  it('?productType=sealed&sealedSubtype=box conserva la presentación al redirigir', async () => {
    urlParams.current = new URLSearchParams('productType=sealed&sealedSubtype=box');
    renderWithProviders(<CatalogView />, 'es');

    await vi.waitFor(() =>
      expect(routerSpies.replace).toHaveBeenCalledWith('/sellado?sealedSubtype=box&from=compra'),
    );
  });

  it('?sealedSubtype=etb SOLO (sin productType) también es intención de sellado', async () => {
    // Hoy este parámetro se descartaba EN SILENCIO (`parseUrlFilters` exigía
    // `productType==='sealed'`) y el usuario veía el catálogo entero sin filtrar,
    // sin que nada dijera que su filtro se había ignorado. Medido en el navegador:
    // `/es/compra?sealedSubtype=box` ⇒ «8 resultados», petición `/catalog/cards` pelada.
    urlParams.current = new URLSearchParams('sealedSubtype=etb');
    renderWithProviders(<CatalogView />, 'es');

    await vi.waitFor(() =>
      expect(routerSpies.replace).toHaveBeenCalledWith('/sellado?sealedSubtype=etb&from=compra'),
    );
  });

  it('un subtipo que NO existe no inventa intención: sigue en Compra y no redirige', async () => {
    urlParams.current = new URLSearchParams('sealedSubtype=no-existe');
    renderWithProviders(<CatalogView />, 'es');

    await screen.findAllByRole('button', { name: 'Añadir al carrito' });
    expect(routerSpies.replace).not.toHaveBeenCalled();
  });

  it('?productType=sealed con un subtipo inválido redirige, pero sin arrastrar basura', async () => {
    urlParams.current = new URLSearchParams('productType=sealed&sealedSubtype=no-existe');
    renderWithProviders(<CatalogView />, 'es');

    await vi.waitFor(() => expect(routerSpies.replace).toHaveBeenCalledWith('/sellado?from=compra'));
  });

  /**
   * PARIDAD DE MOCKS (§H9). El fixture `mockListings` trae piezas `productType:'sealed'`
   * (`inv-1008` box, `inv-1009` etb) porque las consumen la bóveda y el back-office. Si la
   * rama mock de `getCatalog` las deja pasar, Compra pinta EN DESARROLLO dos tejas que el
   * servidor real NUNCA devuelve — el mismo modo de fallo de este ticket, pero sin filtro
   * de por medio y por tanto invisible.
   */
  it('la rejilla de Compra (sin filtros) no pinta NINGUNA teja de sellado', async () => {
    renderWithProviders(<CatalogView />, 'es');
    await screen.findAllByRole('button', { name: 'Añadir al carrito' });

    expect(screen.queryByText('Surging Sparks Booster Box')).not.toBeInTheDocument();
    expect(screen.queryByText('Twilight Masquerade ETB')).not.toBeInTheDocument();
  });
});
