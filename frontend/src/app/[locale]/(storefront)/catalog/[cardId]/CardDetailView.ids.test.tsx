/**
 * IDS-F3 (API_CONTRACT §IDS.9; §IDS.5; DESIGN_SYSTEM §IDS-UX.4/.8) — la ficha con versiones, sobre los fixtures del
 * simulador (`c-ids-pikachu-057`: 2×N; `c-ids-dedenne-084`: 2×2).
 *  - una burbuja por `versions[]` en el orden del servidor; preselección D-IDS-4 por `?version=`;
 *  - insignias bajo el `<h1>` que cambian al elegir; leyenda de la imagen; «Carta de liga: …» en la 2×2;
 *  - «Ejemplares disponibles» filtrado a la versión elegida; sin estimado PSA en español;
 *  - JSON-LD `ProductGroup` con `hasVariant` = `versions[]` y `sku` de `optionKey`;
 *  - grep: ningún `optionKey` compuesto en el navegador (fuera de `lib/mock`).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { CardDetailView } from './CardDetailView';
import { mockGroupedDetail } from '@/lib/mock/fixtures';
import { productGroupJsonLd, versionVisibleText } from './version-jsonld';
import es from '../../../../../../messages/es.json';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const PIKA = mockGroupedDetail('c-ids-pikachu-057');
const DEDE = mockGroupedDetail('c-ids-dedenne-084');

function render(detail = PIKA, versionParam: string | null = null) {
  return renderWithProviders(<CardDetailView cardId={detail.card.id} initialData={detail} versionParam={versionParam} />);
}

describe('IDS-F3 · ficha con versiones', () => {
  it('2×N: una burbuja por entrada, en el orden del servidor; sin parámetro ⇒ «Inglés» elegida', () => {
    render();
    const radios = within(screen.getByRole('radiogroup')).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('data-option-key'))).toEqual(PIKA.versions!.map((v) => v.optionKey));
    expect(radios.find((r) => r.getAttribute('aria-checked') === 'true')?.getAttribute('data-option-key')).toBe('en');
    // inglés elegido: fila de insignias vacía pero reservada; sin leyenda de imagen
    expect(screen.getByTestId('detail-version-chips-row')).toBeInTheDocument();
    expect(screen.queryByTestId('detail-version-chips')).toBeNull();
    expect(screen.queryByTestId('image-note')).toBeNull();
  });

  it('?version=<optionKey> preselecciona esa; insignias, leyenda y renglones cambian a la versión', () => {
    render(PIKA, 'es.703900.holofoil');
    const checked = screen.getAllByRole('radio').find((r) => r.getAttribute('aria-checked') === 'true')!;
    expect(checked.getAttribute('data-option-key')).toBe('es.703900.holofoil');
    expect(screen.getByTestId('detail-version-chips').textContent).toBe('EspañolDe liga');
    expect(screen.getByTestId('image-note').textContent).toBe('Imagen de referencia (versión en inglés, sin logo de liga)');
    // «Ejemplares disponibles»: solo el grupo de esa versión (un renglón con su CTA)
    expect(screen.getAllByTestId('instance-cta')).toHaveLength(1);
    expect(screen.getByText(/· NM · Cosmos Holo$/)).toBeInTheDocument();
  });

  it('elegir otra burbuja cambia insignias y renglones (sin navegar)', () => {
    render();
    fireEvent.click(screen.getAllByRole('radio').find((r) => r.getAttribute('data-option-key') === 'es')!);
    expect(screen.getByTestId('detail-version-chips').textContent).toBe('Español');
    expect(screen.getByTestId('image-note').textContent).toBe('Imagen de referencia (versión en inglés)');
  });

  it('?version=<version.key> de liga sin acabado ⇒ la entrada más barata de esa versión', () => {
    render(PIKA, 'en.648703');
    const checked = screen.getAllByRole('radio').find((r) => r.getAttribute('aria-checked') === 'true')!;
    expect(checked.getAttribute('data-option-key')).toBe('en.648703.holofoil');
  });

  it('?version= inexistente ⇒ «Inglés» (sin error ni 404)', () => {
    render(PIKA, 'es.999.holofoil');
    const checked = screen.getAllByRole('radio').find((r) => r.getAttribute('aria-checked') === 'true')!;
    expect(checked.getAttribute('data-option-key')).toBe('en');
  });

  it('sin `en` en versions[] ⇒ la más barata', () => {
    const noEn = { ...PIKA, versions: PIKA.versions!.filter((v) => v.optionKey !== 'en') };
    render(noEn);
    const checked = screen.getAllByRole('radio').find((r) => r.getAttribute('aria-checked') === 'true')!;
    const cheapest = [...noEn.versions].sort((a, b) => a.fromPriceCents - b.fromPriceCents)[0];
    expect(checked.getAttribute('data-option-key')).toBe(cheapest.optionKey);
  });

  it('2×2 (Dedenne): insignia «De liga» en la burbuja y «Carta de liga: …» bajo la cuadrícula solo con liga elegida', () => {
    render(DEDE, 'es.648800.normal');
    expect(screen.getByTestId('version-pills').getAttribute('data-form')).toBe('2x2');
    expect(screen.getByTestId('stamp-note').textContent).toBe('Carta de liga: Prize Pack de Play! Pokémon');
    fireEvent.click(screen.getAllByRole('radio').find((r) => r.getAttribute('data-option-key') === 'en')!);
    expect(screen.getByTestId('stamp-note').textContent).toBe('');
  });

  it('con 2+ versiones no hay precio grande repetido (el precio vive en la burbuja y la barra)', () => {
    render();
    expect(screen.queryByText('Precio de venta')).toBeNull();
  });

  it('sin versions[] (servidor anterior a §IDS) la ficha se pinta como hoy, sin selector', () => {
    const { versions: _v, ...old } = DEDE;
    render(old);
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});

describe('IDS-F3 · JSON-LD ProductGroup', () => {
  const t = (k: string) => k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)?.[p], es) as string;
  it('hasVariant = versions[] en su orden, sku = <cardId>.<optionKey>, InStock y additionalProperty «Versión»', () => {
    const ld = productGroupJsonLd({
      cardId: PIKA.card.id,
      name: 'Pikachu ex',
      canonical: 'https://tcghunt.mx/es/catalog/c-ids-pikachu-057',
      versions: PIKA.versions!,
      t,
      offerExtras: {},
      base: {},
    }) as { '@type': string; productGroupID: string; hasVariant: Record<string, unknown>[] };
    expect(ld['@type']).toBe('ProductGroup');
    expect(ld.productGroupID).toBe('c-ids-pikachu-057');
    expect(ld.hasVariant.map((v) => v.sku)).toEqual(PIKA.versions!.map((v) => `c-ids-pikachu-057.${v.optionKey}`));
    for (const v of ld.hasVariant) {
      expect((v.offers as Record<string, string>).availability).toBe('https://schema.org/InStock');
      expect((v.additionalProperty as Record<string, string>).name).toBe('Versión');
    }
    const json = JSON.stringify(ld);
    expect(json).not.toMatch(/inLanguage|variesBy|hreflang/);
    expect(versionVisibleText(PIKA.versions![5], t)).toBe('Español · De liga · Prize Pack · Cosmos Holo');
  });
});

describe('IDS-F3 · ningún optionKey compuesto en el navegador (grep)', () => {
  const SRC = join(__dirname, '..', '..', '..', '..', '..');
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) return n === 'mock' ? [] : walk(p);
      return /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : [];
    });
  }
  it('fuera de lib/mock nadie concatena `version.key` con el acabado ni arma `<idioma>.<productId>`', () => {
    const pattern = /version\.key\s*\}?\s*[`+]?\s*\.?\$?\{?\s*['"`]?\.\s*['"`]?\s*\+?\s*\$?\{?[a-zA-Z.]*finish|`\$\{[^}]*language\}\.\$\{[^}]*productId\}`/;
    const offenders = walk(SRC)
      .filter((p) => pattern.test(readFileSync(p, 'utf8')))
      .map((p) => relative(SRC, p));
    expect(offenders).toEqual([]);
  });
});
