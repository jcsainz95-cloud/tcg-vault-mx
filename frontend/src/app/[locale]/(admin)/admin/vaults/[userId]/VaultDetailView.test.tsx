import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { VaultDetailView } from './VaultDetailView';
import { parseVaultDetailTab } from './tabs';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { CustomerPhysicalInventoryDTO, PhysicalInventoryItemDTO } from '@/types/contract';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

const row = (id: string, physical: PhysicalInventoryItemDTO['physical'], over: Partial<PhysicalInventoryItemDTO> = {}): PhysicalInventoryItemDTO => ({
  inventoryItemId: id,
  folio: `INV-${id}`,
  card: { name: `Carta ${id}`, setName: 'Base Set', finish: 'holofoil', conditionLabel: 'NM', imageSmallUrl: null },
  currentLocation: { kind: 'assigned', label: 'C10-F01-S01' },
  currentZone: 'customer_custody',
  origin: { placementId: 'vp-1', orderId: 'ord-1', orderNumber: 'TCG-000501' },
  physical,
  ...over,
});

function inventory(over: Partial<CustomerPhysicalInventoryDTO> = {}): CustomerPhysicalInventoryDTO {
  return {
    owner: { userId: 'u-1', name: 'Ana López', email: 'ana@example.com' },
    drawer: { kind: 'single', location: { id: 'loc-3', label: 'C10-F01-S01', zone: 'customer_custody', customerPieceCount: 2 } },
    counts: { total: 0, inDrawer: 0, pendingPlacement: 0, missing: 0, inWithdrawal: 0, unlocated: 0 },
    items: [],
    ...over,
  };
}

describe('Detalle de bóveda con URL propia (H-6) · `?tab=`', () => {
  it('`parseVaultDetailTab`: solo acepta las tres pestañas; cualquier otra cosa cae en «Cartas»', () => {
    expect(parseVaultDetailTab('physical')).toBe('physical');
    expect(parseVaultDetailTab(['sealed', 'x'])).toBe('sealed');
    expect(parseVaultDetailTab('<script>')).toBe('cards');
    expect(parseVaultDetailTab(undefined)).toBe('cards');
  });

  it('tres pestañas (Cartas · Sellado · Qué debe haber); cambiar de pestaña la escribe en la URL', async () => {
    vi.spyOn(api, 'getAdminVaultPhysicalInventory').mockResolvedValue(inventory());
    renderWithProviders(<VaultDetailView userId="u-777" initialTab="cards" />, 'es');

    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Cartas', 'Sellado', 'Qué debe haber']);
    fireEvent.click(screen.getByRole('tab', { name: 'Qué debe haber' }));
    expect(screen.getByRole('tab', { name: 'Qué debe haber' })).toHaveAttribute('aria-selected', 'true');
    expect(new URL(window.location.href).searchParams.get('tab')).toBe('physical');
    expect(await screen.findByTestId('physical-inventory')).toBeInTheDocument();
  });

  it('«Cartas» sigue abriendo el master set del cliente (vista (ii)) y la cabecera lo nombra', async () => {
    const spy = vi.spyOn(api, 'getAdminVaultMasterSets');
    renderWithProviders(<VaultDetailView userId="u-777" initialTab="cards" />, 'es');

    expect(await screen.findByRole('heading', { level: 1, name: 'Ana López' })).toBeInTheDocument();
    expect(await screen.findByText(/Bóveda de Ana López · ana@example\.com/)).toBeInTheDocument();
    await waitFor(() => expect(spy).toHaveBeenCalledWith('u-777', expect.anything()));
    expect(screen.getByRole('link', { name: /Clientes/ })).toHaveAttribute('href', '/admin/vaults');
  });

  /**
   * ⭐ **H-1 (prueba 29) — cabecera, `aria-label` y la línea «Bóveda de …» de «Cartas».** Mocks:
   * `u-780` es la cuenta `derived` ⇒ `owner.name === null` en `physical-inventory` Y en `master-sets`.
   */
  it('H-1 · cliente sin nombre: cabecera, `aria-label` de las pestañas y línea de «Cartas» con la ausencia + correo; ⛔ nunca el prefijo', async () => {
    const { container } = renderWithProviders(<VaultDetailView userId="u-780" initialTab="cards" />, 'es');

    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Sin nombre registrado');
    expect(screen.getByTestId('vault-detail-owner')).toHaveTextContent('jcsainz95@example.com');
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-label', 'Sin nombre registrado · jcsainz95@example.com');
    expect(
      await screen.findByText(/Bóveda de un cliente sin nombre registrado · jcsainz95@example\.com/),
    ).toBeInTheDocument();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim();
      if (text.includes('jcsainz95')) expect(text).toContain('jcsainz95@example.com');
    }
  });

  it('`404` del cliente: «No encontramos a este cliente.» y la vuelta a la lista, sin pestañas', async () => {
    vi.spyOn(api, 'getAdminVaultPhysicalInventory').mockRejectedValue(
      new ApiClientError(404, { code: 'NOT_FOUND', message: 'no' }),
    );
    renderWithProviders(<VaultDetailView userId="u-nope" initialTab="physical" />, 'es');

    expect(await screen.findByText('No encontramos a este cliente.')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });
});

describe('«Qué debe haber» (§36.11 · §M4-VAULT.11)', () => {
  const full = () =>
    inventory({
      counts: { total: 5, inDrawer: 1, pendingPlacement: 1, missing: 1, inWithdrawal: 1, unlocated: 1 },
      // Deliberadamente en OTRO orden que el de los grupos: la pantalla agrupa, no confía en el orden.
      items: [
        row('w', { state: 'in_withdrawal', shipmentId: 'shp-1', shipmentStatus: 'guia' }),
        row('d', { state: 'in_drawer', drawer: { id: 'loc-3', label: 'C10-F01-S01', zone: 'customer_custody' } }),
        row('p', { state: 'pending_placement', placementId: 'vp-1', prepStatus: 'picked', prepared: false }, {
          currentLocation: { kind: 'assigned', label: 'C03-F02-S15' },
          currentZone: 'platform_stock',
        }),
        row('u', { state: 'unlocated', reason: 'not_in_customer_drawer' }, {
          currentLocation: { kind: 'assigned', label: 'C03-F02-S16' },
          currentZone: 'platform_stock',
        }),
        row('m', {
          state: 'missing',
          placementId: 'vp-1',
          markedAt: '2026-08-20T12:00:00Z',
          markedBy: { userId: 'u-op1', name: 'Operador Bóveda' },
        }),
      ],
    });

  it('PV-11 · grupos en el orden faltantes → sin ubicar → en su cajón → por colocar → en un retiro', async () => {
    vi.spyOn(api, 'getAdminVaultPhysicalInventory').mockResolvedValue(full());
    renderWithProviders(<VaultDetailView userId="u-1" initialTab="physical" />, 'es');

    await screen.findByTestId('physical-inventory');
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([
      'Faltantes (1)',
      'Sin ubicar (1)',
      'En su cajón (1)',
      'Por colocar (1)',
      'En un retiro (1)',
    ]);
    // Cada grupo es una región nombrada por su título.
    expect(screen.getByRole('region', { name: 'Faltantes (1)' })).toBeInTheDocument();
  });

  it('PV-11 · un grupo con 0 NO se pinta, pero su conteo SÍ aparece en el resumen', async () => {
    const data = full();
    data.items = data.items.filter((i) => i.physical.state !== 'missing');
    data.counts = { ...data.counts, missing: 0, total: 4 };
    vi.spyOn(api, 'getAdminVaultPhysicalInventory').mockResolvedValue(data);
    renderWithProviders(<VaultDetailView userId="u-1" initialTab="physical" />, 'es');

    await screen.findByTestId('physical-inventory');
    expect(screen.queryByTestId('physical-group-missing')).not.toBeInTheDocument();
    const counts = screen.getByTestId('physical-counts');
    const missing = counts.querySelector('[data-count="missing"]');
    expect(missing).toHaveTextContent('0');
    expect(missing).toHaveTextContent('faltantes');
    expect(counts.querySelector('[data-count="total"]')).toHaveTextContent('4');
  });

  /**
   * **PV-13 · PV-14 (§36.17).** El cierre del resumen dice «deben estar en bóveda» (singular con 1),
   * ⛔ nunca «en total»; y la ayuda está SIEMPRE visible bajo el resumen, fuera del `<dl>`.
   */
  it('PV-13/PV-14 · «N deben estar en bóveda» / «1 debe estar en bóveda», ⛔ sin «en total», con su ayuda fuera del <dl>', async () => {
    vi.spyOn(api, 'getAdminVaultPhysicalInventory').mockResolvedValue(full());
    const { unmount } = renderWithProviders(<VaultDetailView userId="u-1" initialTab="physical" />, 'es');
    await screen.findByTestId('physical-inventory');
    const counts = screen.getByTestId('physical-counts');
    expect(counts.querySelector('[data-count="total"]')).toHaveTextContent('deben estar en bóveda');
    expect(counts.textContent).not.toContain('en total');
    const help = screen.getByTestId('physical-counts-help');
    expect(help).toHaveTextContent('Puede ser menos de lo que la lista de clientes cuenta «a su nombre»');
    expect(counts.contains(help)).toBe(false);
    unmount();

    const one = full();
    one.items = one.items.filter((i) => i.physical.state === 'in_drawer');
    one.counts = { total: 1, inDrawer: 1, pendingPlacement: 0, missing: 0, inWithdrawal: 0, unlocated: 0 };
    vi.spyOn(api, 'getAdminVaultPhysicalInventory').mockResolvedValue(one);
    renderWithProviders(<VaultDetailView userId="u-2" initialTab="physical" />, 'es');
    const counts1 = await screen.findByTestId('physical-counts');
    const total = counts1.querySelector('[data-count="total"]')!;
    expect(total).toHaveTextContent('debe estar en bóveda');
    expect(total).not.toHaveTextContent('deben');
  });

  /**
   * **PV-15 (§36.17, DESIGN_SYSTEM v4.8).** La ayuda se compara ENTERA, en es y en, contra el texto
   * literal de la tabla «Textos finales» — no contra `messages/*.json`, que es justo lo que se vigila.
   * La palabra es «reservado» (la que la tienda ya usa); ⛔ «apartado» (rechazo de QA sobre f2981e1).
   */
  it.each([
    [
      'es',
      'Puede ser menos de lo que la lista de clientes cuenta «a su nombre»: allí entra también lo reservado en pedidos que aún no se pagan. Aquí solo cuenta lo pagado que guardamos.',
    ],
    [
      'en',
      'This can be lower than what the customer list counts \u201cin their name\u201d: that also includes items reserved in orders not yet paid. Here, only what\'s paid and in our keeping counts.',
    ],
  ] as const)('PV-15 · la ayuda de la vista física es EXACTAMENTE la de §36.17 (%s)', async (locale, expected) => {
    vi.spyOn(api, 'getAdminVaultPhysicalInventory').mockResolvedValue(full());
    renderWithProviders(<VaultDetailView userId="u-1" initialTab="physical" />, locale);
    const help = await screen.findByTestId('physical-counts-help');
    expect(help.textContent).toBe(expected);
    expect(help.textContent).not.toMatch(/apartad/i);
  });

  it('cada fila dice su estado en palabras, con la ubicación CON zona (V3/PV-3), y ⛔ sin un solo botón', async () => {
    vi.spyOn(api, 'getAdminVaultPhysicalInventory').mockResolvedValue(full());
    renderWithProviders(<VaultDetailView userId="u-1" initialTab="physical" />, 'es');

    const panel = await screen.findByTestId('physical-inventory');
    const m = within(panel).getByTestId('physical-item-m');
    expect(m).toHaveTextContent('La marcó como faltante Operador Bóveda el');
    expect(m).toHaveTextContent('al preparar el pedido TCG-000501. El sistema la sigue contando como del cliente.');
    expect(m.querySelector('time')).toHaveAttribute('dateTime', '2026-08-20T12:00:00Z');
    expect(within(panel).getByTestId('physical-item-u')).toHaveTextContent(
      'El sistema la tiene en Stock de plataforma · C03-F02-S16, no en un cajón de cliente.',
    );
    expect(within(panel).getByTestId('physical-item-p')).toHaveTextContent(
      'Pagada; falta llevarla a su cajón (pedido TCG-000501). · ya la juntaron',
    );
    expect(within(panel).getByTestId('physical-item-w')).toHaveTextContent(
      'Sale con el envío que pidió el cliente — Guía generada.',
    );
    expect(within(panel).getByTestId('physical-location-d')).toHaveTextContent('Ubicación · Custodia de clientes');
    expect(within(panel).getByTestId('physical-drawer')).toHaveTextContent('Su cajón');
    expect(within(panel).getByTestId('physical-drawer')).toHaveTextContent('Custodia de clientes · C10-F01-S01');
    // ⛔ Lectura pura: ni un botón que corrija nada. ⛔ Sin precios.
    expect(within(panel).queryAllByRole('button')).toHaveLength(0);
    expect(panel.textContent).not.toMatch(/MX\$|\$\s?\d/);
  });

  it('dueño sin nombre (`owner.name === null`): la misma ausencia de §36.4 en la persona de la vista', async () => {
    vi.spyOn(api, 'getAdminVaultPhysicalInventory').mockResolvedValue(
      inventory({ owner: { userId: 'u-780', name: null, email: 'juan.perez95@example.com' } }),
    );
    renderWithProviders(<VaultDetailView userId="u-780" initialTab="physical" />, 'es');

    const who = await screen.findByTestId('physical-owner');
    expect(who).toHaveTextContent('Sin nombre registrado');
    expect(who).toHaveTextContent('Esta cuenta se creó sin nombre: el cliente no nos lo ha dado. Identifícalo por su correo.');
    expect(who).toHaveTextContent('juan.perez95@example.com');
    expect(who.textContent).not.toContain('—');
  });

  it('`multiple`: la anomalía con nombre y TODOS los cajones; `none` + por colocar: la frase de espera', async () => {
    vi.spyOn(api, 'getAdminVaultPhysicalInventory').mockResolvedValueOnce(
      inventory({
        drawer: {
          kind: 'multiple',
          locations: [
            { id: 'loc-3', label: 'C10-F01-S01', zone: 'customer_custody', customerPieceCount: 1 },
            { id: 'loc-4', label: 'C10-F01-S02', zone: 'customer_custody', customerPieceCount: 2 },
          ],
        },
      }),
    );
    const { unmount } = renderWithProviders(<VaultDetailView userId="u-1" initialTab="physical" />, 'es');
    const drawer = await screen.findByTestId('physical-drawer');
    expect(drawer).toHaveTextContent('Cartas en varios cajones');
    expect(drawer).toHaveTextContent('Este cliente debería tener un solo cajón, pero sus cartas están en 2:');
    expect(within(drawer).getAllByRole('listitem')).toHaveLength(2);
    unmount();

    vi.spyOn(api, 'getAdminVaultPhysicalInventory').mockResolvedValueOnce(
      inventory({
        drawer: { kind: 'none' },
        counts: { total: 1, inDrawer: 0, pendingPlacement: 1, missing: 0, inWithdrawal: 0, unlocated: 0 },
        items: [row('p', { state: 'pending_placement', placementId: 'vp-1', prepStatus: 'pending', prepared: false })],
      }),
    );
    renderWithProviders(<VaultDetailView userId="u-1" initialTab="physical" />, 'es');
    const none = await screen.findByTestId('physical-drawer');
    expect(none).toHaveTextContent('Todavía no tiene cajón.');
    expect(none).toHaveTextContent('Sus cartas pagadas siguen en la tienda, esperando que se coloquen.');
  });

  it('vacío (`items: []`): el EmptyState de §36.11, sin grupos ni resumen', async () => {
    vi.spyOn(api, 'getAdminVaultPhysicalInventory').mockResolvedValue(inventory({ drawer: { kind: 'none' } }));
    renderWithProviders(<VaultDetailView userId="u-1" initialTab="physical" />, 'es');

    expect(await screen.findByText('Este cliente no tiene cartas guardadas con nosotros.')).toBeInTheDocument();
    expect(screen.getByText('Cuando compre y deje cartas en su bóveda, aparecerán aquí.')).toBeInTheDocument();
    expect(screen.queryByTestId('physical-counts')).not.toBeInTheDocument();
  });

  it('EN · pestaña y grupos en inglés', async () => {
    vi.spyOn(api, 'getAdminVaultPhysicalInventory').mockResolvedValue(full());
    renderWithProviders(<VaultDetailView userId="u-1" initialTab="physical" />, 'en');

    expect(await screen.findByRole('tab', { name: 'What should be there' })).toBeInTheDocument();
    await screen.findByTestId('physical-inventory');
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Missing (1)',
      'Unlocated (1)',
      'In their drawer (1)',
      'To be placed (1)',
      'In a withdrawal (1)',
    ]);
  });
});
