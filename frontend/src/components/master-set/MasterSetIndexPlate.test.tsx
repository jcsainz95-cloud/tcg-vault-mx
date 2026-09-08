import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import type { BuylistSetDTO } from '@/types/contract';
import * as api from '@/lib/api';
import { MasterSetIndex } from './MasterSetIndex';
import { SetPlate, setMonogram } from './SetPlate';

/**
 * P-54 · DESIGN_SYSTEM §24 — LA PLACA DE TINTA del índice de sets, en lo que jsdom SÍ puede ver.
 *
 * ⚠️ LÍMITE DEL ARCHIVO, ARRIBA Y NO EN LETRA PEQUEÑA: jsdom **no hace layout ni carga imágenes**.
 * Aquí no se verifica NINGUNA geometría —ni que la placa mida 3:2, ni que todas midan lo mismo, ni
 * que no salte al cargar— ni nada que dependa de que una imagen llegue de la red. Eso se mide en
 * Chromium: `e2e/master-set-plate.spec.ts`. La cabecera anterior listaba «R1: caja de tamaño fijo»
 * entre lo defendido aquí, y era falso: ése fue el hueco por el que pasó el bloqueante B-1 con la
 * suite en verde.
 *
 * Lo que estas pruebas SÍ defienden, y por qué cada una puede ponerse ROJA:
 *  - R1 (solo la ESTRUCTURA que lo hace posible): la <img> no está en flujo y el aire vive en ella,
 *    no en el padre. La medida de la caja NO está aquí.
 *  - R2: el nombre en texto NO desaparece — sigue siendo el nombre accesible de la teja.
 *  - R3 (v2.10): se pinta sobre el POZO DE PAPEL (`bg-surface-2`) con REPISA (`border-b`, y solo
 *    ella: ni superior ni laterales), `object-contain` y el contorno de TINTA de §24.2.d — tres
 *    pasadas (atributos y estilo en línea, no su efecto visual: el ojo lo pone §24.14).
 *  - R4: SIN logo no hay hueco ni PULSO — monograma; `onLoad` lo retira y `onError` lo devuelve
 *    (transiciones de estado del DOM, que jsdom sí puede simular con `fireEvent`).
 *  - §4.41.5 / contrato v1.52: el modo `quoter` mapea `logoUrl` desde `GET /buylist/sets`;
 *    si nadie lo mapea ahí, esa teja es la única sin logo de todo el producto.
 */

beforeEach(() => {
  vi.restoreAllMocks();
});

const noop = () => {};

/** La `<li>` de un set, con la teja dentro. */
function tileOf(name: RegExp): Promise<HTMLElement> {
  return screen.findByRole('button', { name });
}

describe('§24.5 · monograma (derivación de presentación, no un dato)', () => {
  it('toma la inicial de cada palabra significativa, en mayúsculas y con tope de 3', () => {
    expect(setMonogram('Surging Sparks')).toBe('SS');
    expect(setMonogram('Paldean Fates')).toBe('PF');
    expect(setMonogram('Journey Together')).toBe('JT');
    // Tope de 3: la cuarta inicial NO entra.
    expect(setMonogram('Celebrations: Classic Collection')).toBe('CCC');
    expect(setMonogram('Team Rocket Returns From Kanto')).toBe('TRR');
  });

  it('ignora `and`, `&`, `of` y `the`', () => {
    expect(setMonogram('Scarlet & Violet')).toBe('SV');
    expect(setMonogram('Sword & Shield')).toBe('SS');
    expect(setMonogram('Rise of the Phoenix')).toBe('RP');
    expect(setMonogram('Black and White')).toBe('BW');
  });

  it('con menos de 2 iniciales cae a los 3 primeros caracteres del nombre (`151`)', () => {
    expect(setMonogram('151')).toBe('151');
    expect(setMonogram('Evolutions')).toBe('EVO');
  });
});

describe('§24 · la teja del índice: pozo de papel + repisa + leyenda (v2.10)', () => {
  it('R1/R3 (v2.10): un set CON logo pinta el <img> contenido sobre el POZO DE PAPEL, decorativo, perezoso y con el contorno de TINTA de 3 pasadas', async () => {
    renderWithProviders(<MasterSetIndex mode="platform" onOpenSet={noop} />, 'es');

    const tile = await tileOf(/Surging Sparks/);
    const img = tile.querySelector('img');
    expect(img).not.toBeNull();
    // Sale del DTO, no de una plantilla construida a partir del setId (§4.41, prohibido).
    expect(img).toHaveAttribute('src', 'https://images.pokemontcg.io/sv8/logo.png');

    // §24.8: el logo es DECORATIVO. Sin esto el lector anuncia «logo de X, X».
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('aria-hidden', 'true');

    // §24.7: lazy en TODAS; jamás `fetchpriority=high` en una rejilla de 20.
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    expect(img).not.toHaveAttribute('fetchpriority');

    // R1: contenido, nunca recortado ni estirado.
    expect(img!.className).toContain('object-contain');
    expect(img!.className).not.toContain('object-cover');

    // §24.2.d: el contorno es OBLIGATORIO (§24.12 nº11) y en v2.10 es de TINTA, offset 0, radio
    // 1px y TRES pasadas. Se comprueba pasada a pasada, no como una cadena opaca: así una pasada
    // de menos, un radio distinto o el color de v2.8 (`--color-on-ink`, que sobre el pozo claro
    // sería invisible) se distinguen entre sí en el mensaje de fallo.
    // (El paréntesis de `var(--color-ink)` va anidado: el patrón tiene que contarlo, no cortar ahí.)
    const passes = img!.style.filter.match(/drop-shadow\((?:[^()]|\([^()]*\))*\)/g) ?? [];
    expect(passes).toHaveLength(3);
    for (const pass of passes) expect(pass).toBe('drop-shadow(0 0 1px var(--color-ink))');
    // …y el rango que §24.2.d autoriza a QA es 2–4 pasadas: fuera de ahí se escala a ux-ui.
    expect(passes.length).toBeGreaterThanOrEqual(2);
    expect(passes.length).toBeLessThanOrEqual(4);
    expect(img!.style.filter).not.toContain('--color-on-ink');

    // v2.10 — el pozo es del tono del PAPEL (`surface-2`), ya no de tinta…
    const plate = img!.parentElement!;
    expect(plate.className).toContain('bg-surface-2');
    expect(plate.className).not.toContain('bg-ink');
    // …y lleva REPISA: `border-bottom` 1px `--color-border`, a ras y del ancho del pozo (§24.2.d).
    expect(plate.className).toContain('border-b');
    expect(plate.className).toContain('border-border');
    // Pero SOLO la inferior: con los cuatro lados sería una tarjeta, y §2.1 no tiene tarjetas.
    // (Radio 0 es global, §4.2, y no se toca aquí.)
    for (const side of ['border-t', 'border-l', 'border-r', 'border-x', 'border-y']) {
      expect(plate.className).not.toContain(side);
    }
    expect(plate.className.split(/\s+/)).not.toContain('border');
  });

  it('R1 (estructura): la imagen va ABSOLUTA y con el aire propio — no puede devolverle su alto a la placa', async () => {
    // ⚠️ ALCANCE HONESTO. Esta prueba NO mide la caja: jsdom no hace layout ni carga imágenes, así
    // que `toContain('aspect-[3/2]')` —lo que este archivo afirmaba antes— comprueba que la CADENA
    // de clase está, no que la caja mida 3:2. Por eso el bloqueante B-1 pasó con la suite verde.
    // Aquí se verifica solo la CAUSA estructural: con la <img> en flujo, `height:100%` contra un
    // padre de altura `aspect-ratio` resuelve a `auto` y el min-content de la imagen anula la
    // relación de aspecto. La GEOMETRÍA real (misma caja con logo apaisado, cuadrado, vertical y
    // sin logo) se mide en Chromium: `e2e/master-set-plate.spec.ts`.
    renderWithProviders(<MasterSetIndex mode="platform" onOpenSet={noop} />, 'es');

    const tile = await tileOf(/Surging Sparks/);
    const img = tile.querySelector('img')!;
    const plate = img.parentElement!;
    // El <img> NO está en flujo…
    expect(img.className).toContain('absolute');
    expect(img.className).not.toContain('relative');
    // …el monograma tampoco (mientras se le ve, antes del onLoad)…
    expect(within(tile).getByTestId('set-monogram').className).toContain('absolute');
    // …y el aire interior vive en la IMAGEN, no en el padre (para un hijo absoluto el bloque
    // contenedor es la caja de relleno del padre: un `p-3` arriba no lo tocaría). v2.10 baja un
    // escalón el aire —12/16/20, antes 16/20/24— para que el logo se pinte ~8–10 % más grande
    // (§24.3), que es legibilidad gratis justo para los logos claros que ahora son los frágiles.
    expect(img.className).toContain('p-3');
    expect(img.className).toContain('sm:p-4');
    expect(img.className).toContain('lg:p-5');
    expect(plate.className).not.toContain('p-3');
  });

  it('R2/§24.8: el nombre del set sigue siendo el nombre accesible de la teja; el logo y el monograma NO se anuncian', async () => {
    renderWithProviders(<MasterSetIndex mode="platform" onOpenSet={noop} />, 'es');

    const tile = await tileOf(/Surging Sparks/);
    // El nombre y la meta viven en el DOM dentro del <button> (sin aria-label que duplique).
    expect(tile).toHaveAccessibleName(/Surging Sparks/);
    expect(tile).toHaveAccessibleName(/Scarlet & Violet/);
    expect(tile).not.toHaveAttribute('aria-label');
  });

  it('R4: un set SIN logo (`logoUrl: null`) pinta MONOGRAMA — ni <img>, ni hueco, ni animate-pulse', async () => {
    renderWithProviders(<MasterSetIndex mode="platform" onOpenSet={noop} />, 'es');

    const tile = await tileOf(/Base Set/);
    expect(tile.querySelector('img')).toBeNull();
    // El monograma ES contenido final legítimo, no un esqueleto: nada pulsa (§24.12 nº4).
    expect(tile.querySelector('.animate-pulse')).toBeNull();
    expect(within(tile).getByText('BS')).toBeInTheDocument();

    // v2.10 §24.5: el monograma va en `--color-text-muted` (v2.8: `on-ink`, invisible sobre un
    // pozo claro) y SIN contorno — el de §24.2 es para arte de terceros, no para texto propio
    // (§24.12 nº15).
    const monogram = within(tile).getByTestId('set-monogram');
    expect(monogram.className).toContain('text-muted');
    expect(monogram.className).not.toContain('text-on-ink');
    expect(monogram.style.filter).toBe('');

    // …y el monograma es decorativo: está en el texto visible pero NO en el nombre accesible.
    expect(tile.textContent).toContain('BS');
    expect(tile).toHaveAccessibleName(/Base Set/);
    expect(tile).not.toHaveAccessibleName(/BS/);
  });

  it('B-2: cuando el logo CARGA, el monograma se RETIRA (los PNG del proveedor son transparentes: si se queda, se ve a través)', async () => {
    renderWithProviders(<MasterSetIndex mode="platform" onOpenSet={noop} />, 'es');

    const tile = await tileOf(/Surging Sparks/);
    const img = tile.querySelector('img')!;
    // Antes de cargar, el monograma ES el contenido de la placa (nunca vacía, nunca pulso).
    expect(within(tile).getByTestId('set-monogram')).toBeInTheDocument();

    fireEvent.load(img);

    await waitFor(() => expect(within(tile).queryByTestId('set-monogram')).toBeNull());
    // …y el logo sigue ahí: se retiró el monograma, no la imagen.
    expect(tile.querySelector('img')).not.toBeNull();
  });

  it('B-2 (vuelta): si la imagen falla DESPUÉS de cargar el monograma no se queda escondido', async () => {
    renderWithProviders(<MasterSetIndex mode="platform" onOpenSet={noop} />, 'es');

    const tile = await tileOf(/Surging Sparks/);
    fireEvent.load(tile.querySelector('img')!);
    await waitFor(() => expect(within(tile).queryByTestId('set-monogram')).toBeNull());

    fireEvent.error(tile.querySelector('img')!);
    await waitFor(() => expect(tile.querySelector('img')).toBeNull());
    expect(within(tile).getByTestId('set-monogram')).toBeInTheDocument();
  });

  it('el fixture cubre los DOS casos: en la MISMA retícula conviven tejas con logo y tejas sin logo', async () => {
    // Guardia anti «el mock miente»: si los fixtures dieran logo a todos (o a ninguno), el
    // monograma —o la placa con imagen— no se ejercitaría nunca en dev ni en Playwright y el
    // defecto solo aparecería en producción. Convivir es el estado PERMANENTE (§4.41.6).
    renderWithProviders(<MasterSetIndex mode="platform" onOpenSet={noop} />, 'es');
    await tileOf(/Surging Sparks/);

    const tiles = within(screen.getByRole('list')).getAllByRole('listitem');
    const withLogo = tiles.filter((li) => li.querySelector('img') !== null);
    const withoutLogo = tiles.filter((li) => li.querySelector('img') === null);
    expect(withLogo.length).toBeGreaterThan(0);
    expect(withoutLogo.length).toBeGreaterThan(0);
  });

  it('§24.5 nº3: una URL rota (404 del CDN) retira el <img> y deja el monograma — nunca icono roto ni espera eterna', async () => {
    renderWithProviders(<MasterSetIndex mode="platform" onOpenSet={noop} />, 'es');

    const tile = await tileOf(/Surging Sparks/);
    const img = tile.querySelector('img')!;
    fireEvent.error(img);

    await waitFor(() => expect(tile.querySelector('img')).toBeNull());
    expect(within(tile).getByText('SS')).toBeInTheDocument();
    expect(tile.querySelector('.animate-pulse')).toBeNull();
  });

  it('§24.3: la teja ya NO es una tarjeta (sin borde ni fondo propios) y la retícula es 2/3/4 columnas', async () => {
    renderWithProviders(<MasterSetIndex mode="platform" onOpenSet={noop} />, 'es');

    const tile = await tileOf(/Surging Sparks/);
    expect(tile.className).not.toContain('border-border');
    expect(tile.className).not.toContain('bg-surface');

    const list = screen.getByRole('list');
    expect(list.className).toContain('grid-cols-2');
    expect(list.className).toContain('sm:grid-cols-3');
    expect(list.className).toContain('lg:grid-cols-4');
    // §24.4: se TOPA en 4 — no hay quinta columna en xl ni sexta en 2xl.
    expect(list.className).not.toContain('grid-cols-5');
    expect(list.className).not.toContain('grid-cols-6');
  });
});

describe('§24.6 · seleccionado / actual (solo cuando el anfitrión lo sabe)', () => {
  it('sin `currentSetId` NINGUNA teja se marca como actual (no se inventa una selección)', async () => {
    renderWithProviders(<MasterSetIndex mode="platform" onOpenSet={noop} />, 'es');
    await tileOf(/Surging Sparks/);

    expect(document.querySelectorAll('[aria-current]')).toHaveLength(0);
  });

  it('con `currentSetId` esa teja gana aria-current y subrayado 2px de ACENTO (grosor + color, no solo color)', async () => {
    renderWithProviders(
      <MasterSetIndex mode="platform" onOpenSet={noop} currentSetId="sv08" />,
      'es',
    );

    const current = await tileOf(/Surging Sparks/);
    const other = await tileOf(/Base Set/);
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(other).not.toHaveAttribute('aria-current');

    const name = within(current).getByText('Surging Sparks');
    expect(name.className).toContain('decoration-accent');
    expect(name.className).toContain('decoration-2');
    // ⛔ §24.12 nº5: el acento y el anillo JAMÁS entran en el pozo. En v2.10 la razón ya NO es el
    // contraste (rojo sobre el pozo claro es 5,9:1) sino el PATRÓN: un control por set, un anillo,
    // alrededor de la teja entera (§24.6).
    const plate = current.querySelector('img')!.parentElement!;
    expect(plate.className).not.toContain('accent');
    expect(plate.className).not.toContain('focus');
  });
});

describe('§4.41.5 · modo `quoter`: el logo viaja desde GET /buylist/sets', () => {
  // ⚠️ `BuylistSetDTO[]`, no `CardSetDTO[]` (DT-Gd): el tipo del cotizador declara `logoUrl`
  // REQUERIDO, así que una fixture que lo omita —o un contrato que lo quite— NO compila.
  const quoterSets: BuylistSetDTO[] = [
    {
      id: 'sv08',
      name: 'Surging Sparks',
      series: 'Scarlet & Violet',
      releaseDate: '2024/11/08',
      year: 2024,
      logoUrl: 'https://images.pokemontcg.io/sv8/logo.png',
    },
    {
      id: 'base1',
      name: 'Base Set',
      series: 'Base',
      releaseDate: '1999/01/09',
      year: 1999,
      logoUrl: null,
    },
  ];

  it('mapea `logoUrl` al componer las tejas client-side (sin esto, la del cotizador sería la ÚNICA sin logo)', async () => {
    vi.spyOn(api, 'listBuylistSets').mockResolvedValue(quoterSets);
    renderWithProviders(<MasterSetIndex mode="quoter" onOpenSet={noop} />, 'es');

    const withLogo = await tileOf(/Surging Sparks/);
    expect(withLogo.querySelector('img')).toHaveAttribute(
      'src',
      'https://images.pokemontcg.io/sv8/logo.png',
    );

    // Y el `null` del contrato se pinta como monograma, igual que en los otros tres modos.
    const withoutLogo = await tileOf(/Base Set/);
    expect(withoutLogo.querySelector('img')).toBeNull();
    expect(within(withoutLogo).getByText('BS')).toBeInTheDocument();
  });

  it('en `quoter` la placa se pinta igual pero NO hay completitud ni piezas (no posee las cartas)', async () => {
    vi.spyOn(api, 'listBuylistSets').mockResolvedValue(quoterSets);
    renderWithProviders(<MasterSetIndex mode="quoter" onOpenSet={noop} />, 'es');

    const tile = await tileOf(/Surging Sparks/);
    expect(tile.querySelector('img')).not.toBeNull();
    expect(within(tile).queryByText('Completitud')).toBeNull();
    expect(within(tile).queryByRole('progressbar')).toBeNull();
  });
});

describe('§24.10 · el pozo `sm` del encabezado del binder (DT-Ga)', () => {
  it('mismo acabado que la retícula (pozo + contorno de 3 pasadas), pero SIN repisa, con aire de 8px y oculto por debajo de `sm`', () => {
    renderWithProviders(
      <SetPlate name="Surging Sparks" logoUrl="https://images.pokemontcg.io/sv8/logo.png" size="sm" />,
      'es',
    );

    const plate = screen.getByTestId('set-plate-sm');
    // Mismo pozo y mismo contorno: §24.10 dice «mismas reglas de §24.2.d».
    expect(plate.className).toContain('bg-surface-2');
    const img = plate.querySelector('img')!;
    expect(img.style.filter.match(/drop-shadow\((?:[^()]|\([^()]*\))*\)/g)).toHaveLength(3);
    expect(img.className).toContain('object-contain');

    // …pero SIN repisa: su trabajo es dar borde inferior a un hueco dentro de una RETÍCULA; en
    // línea junto a un título, una regla suelta se leería como el subrayado de nada.
    expect(plate.className).not.toContain('border-b');

    // Caja 112×64 (`aspect-[7/4]` sobre `w-28`) y aire 8px, que aquí NO baja (8/64 = 12,5 %; por
    // debajo se incumpliría la regla del 10 % del lado corto).
    expect(plate.className).toContain('aspect-[7/4]');
    expect(plate.className).toContain('w-28');
    expect(img.className).toContain('p-2');

    // Oculto por debajo de `sm`: en móvil el título manda y el ancho es oro.
    expect(plate.className).toContain('hidden');
    expect(plate.className).toContain('sm:block');

    // Y el testid es PROPIO: los specs del índice cuentan tejas por `set-plate` y no deben
    // capturar el pozo del encabezado si algún día conviven en la misma pantalla.
    expect(screen.queryByTestId('set-plate')).toBeNull();
  });

  it('sin logo cae al mismo monograma muted de §24.5 (no hay una segunda regla para el binder)', () => {
    renderWithProviders(<SetPlate name="Surging Sparks" logoUrl={null} size="sm" />, 'es');

    const plate = screen.getByTestId('set-plate-sm');
    expect(plate.querySelector('img')).toBeNull();
    const monogram = within(plate).getByTestId('set-monogram');
    expect(monogram).toHaveTextContent('SS');
    expect(monogram.className).toContain('text-muted');
  });
});
