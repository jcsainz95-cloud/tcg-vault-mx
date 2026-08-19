import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { SealedShopView } from './SealedShopView';
import * as api from '@/lib/api';

// El grid enlaza a la ficha con el Link de next-intl; se mockea a un <a> plano.
// StoreTabs (sub-pestañas de la Tienda) usa usePathname: hay que exportarlo en el mock.
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/sellado',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const BOX = 'Surging Sparks Booster Box';
const ETB = 'Twilight Masquerade ETB';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('SealedShopView · grid y conteos', () => {
  it('pinta la cuadrícula agrupada con los productos en stock (fixtures)', async () => {
    renderWithProviders(<SealedShopView />, 'es');

    // El box aparece en DOS grupos (mint + detalle menor); el ETB en uno.
    expect(await screen.findAllByText(BOX)).not.toHaveLength(0);
    expect(screen.getByText(ETB)).toBeInTheDocument();

    // «N disponibles» por grupo (box mint = 4, etb = 7, box minor = 2).
    expect(screen.getByText('4 disponibles')).toBeInTheDocument();
    expect(screen.getByText('7 disponibles')).toBeInTheDocument();
    expect(screen.getByText('2 disponibles')).toBeInTheDocument();

    // Conteo total de resultados = 3 grupos.
    expect(screen.getByText('3 productos')).toBeInTheDocument();
  });

  it('muestra el call-out mailto anti-buylist a contacto@tcgvaultmx.com', async () => {
    renderWithProviders(<SealedShopView />, 'es');
    const cta = await screen.findByRole('link', { name: 'Escríbenos' });
    expect(cta).toHaveAttribute('href', 'mailto:contacto@tcgvaultmx.com');
  });
});

describe('SealedShopView · estados de carga/vacío/error', () => {
  it('estado de carga: pinta esqueletos y aún ningún producto', () => {
    vi.spyOn(api, 'getSealedGroups').mockReturnValue(new Promise(() => {}));
    const { container } = renderWithProviders(<SealedShopView />, 'es');

    // Los 6 CardSkeleton del pozo de carga; aún sin productos ni estado vacío/error.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText(BOX)).toBeNull();
    expect(screen.queryByText('Aún no hay sellado en stock')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('estado vacío: sin grupos muestra el mensaje editorial', async () => {
    vi.spyOn(api, 'getSealedGroups').mockResolvedValue({ data: [], page: 1, pageSize: 20, total: 0 });
    renderWithProviders(<SealedShopView />, 'es');

    expect(await screen.findByText('Aún no hay sellado en stock')).toBeInTheDocument();
    expect(screen.getByText('Sin productos')).toBeInTheDocument();
  });

  it('estado de error: muestra el banner con reintentar', async () => {
    vi.spyOn(api, 'getSealedGroups').mockRejectedValue(new Error('boom'));
    renderWithProviders(<SealedShopView />, 'es');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Algo salió mal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});

describe('SealedShopView · filtros', () => {
  it('filtra por presentación (ETB deja solo el ETB)', async () => {
    renderWithProviders(<SealedShopView />, 'es');
    await screen.findByText(ETB);

    fireEvent.change(screen.getByLabelText('Presentación'), { target: { value: 'etb' } });

    await waitFor(() => {
      expect(screen.queryByText(ETB)).not.toBeNull();
      expect(screen.queryByText(BOX)).toBeNull();
    });
    expect(screen.getByText('1 producto')).toBeInTheDocument();
  });

  it('filtra por condición (detalle menor deja solo el grupo dañado)', async () => {
    renderWithProviders(<SealedShopView />, 'es');
    await screen.findByText(ETB);

    fireEvent.change(screen.getByLabelText('Condición'), { target: { value: 'minor_box_damage' } });

    await waitFor(() => {
      expect(screen.queryByText(BOX)).not.toBeNull();
      expect(screen.queryByText(ETB)).toBeNull();
    });
    expect(screen.getByText('1 producto')).toBeInTheDocument();
  });

  it('filtra por set (Surging Sparks deja fuera al ETB de Twilight)', async () => {
    renderWithProviders(<SealedShopView />, 'es');
    await screen.findByText(ETB);

    fireEvent.change(screen.getByLabelText('Set'), { target: { value: 'sv08' } });

    await waitFor(() => {
      expect(screen.queryAllByText(BOX).length).toBeGreaterThan(0);
      expect(screen.queryByText(ETB)).toBeNull();
    });
  });
});
