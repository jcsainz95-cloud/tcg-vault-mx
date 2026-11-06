/**
 * UX-ALTA-LIGA (HECHOS 2026-11-05 «Alta de piezas de liga/español desde el binder: opción A»; contrato §IDS.9 IDS-F11;
 * DESIGN_SYSTEM §16.5 / IDS-UX.2): el alta rápida del cajón —el camino del dueño— lleva **Idioma** y **Versión** con el
 * MISMO modelo que la captura por lote (`useIdsCapture` + `IdsCaptureFields`), el acabado fijo de la casilla.
 *  (1) con versiones ⇒ las dos filas de burbujas y «Precio de venta (auto)» ANTES de Cantidad, sin fila de acabado;
 *      sin versiones (solo inglés sin liga) ⇒ el DOM de hoy (0 toques);
 *  (2) Español + De liga ⇒ el POST al lote lleva `language:'es'` y `cardProductId`; inglés sin liga ⇒ sin esos campos;
 *  (3) versión sin precio ⇒ apagada con su motivo; combo que no existe con el acabado de la casilla ⇒ apagada
 *      («No existe con este acabado»); combo elegible sin precio ⇒ CTA apagado y ningún POST;
 *  (4) tras un alta correcta vuelve a «Inglés / Sin liga» y el resumen y el toast nombran la versión.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import type { CardVersionsResponse, VersionComboDTO } from '@/types/contract';
import { QuickAddSection } from './QuickAdd';
import { versionContributionReferenceCents } from './ids-capture';
import es from '../../../../../../messages/es.json';
import en from '../../../../../../messages/en.json';

vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));

beforeEach(() => vi.restoreAllMocks());

const target = { cardId: 'c-pikachu-ir', productType: 'raw' as const, finish: 'holofoil' as const };
const PP = { type: 'prize_pack' as const, label: null, productId: 648703 };
const STAFF = { type: 'staff' as const, label: null, productId: 610001 };
const combo = (o: Partial<VersionComboDTO>): VersionComboDTO => ({
  finish: 'holofoil',
  finishLabel: 'holo',
  language: 'en',
  stamp: null,
  previewPriceCents: 20000,
  baseReferenceMxnCents: 20000,
  appliedMarketPct: null,
  unavailableReason: null,
  ...o,
});
/** Solo inglés sin liga: la carta no tiene versiones (ni español con precio, ni liga, ni candidatas). */
const EN_ONLY: CardVersionsResponse = { combos: [combo({})], candidates: [] };
/** El servidor SIEMPRE trae el combo `es` (§IDS.4): sin precio (sin mercado del inglés) no hay nada que elegir. */
const EN_ONLY_ES_NO_PRICE: CardVersionsResponse = {
  combos: [combo({}), combo({ language: 'es', previewPriceCents: null, baseReferenceMxnCents: null, appliedMarketPct: 75, unavailableReason: 'no_english_market' })],
  candidates: [],
};
const STAMPED: CardVersionsResponse = {
  combos: [
    combo({}),
    combo({ language: 'es', previewPriceCents: 15000, appliedMarketPct: 75 }),
    combo({ stamp: PP, previewPriceCents: 48000, baseReferenceMxnCents: 48000 }),
    combo({ stamp: PP, language: 'es', previewPriceCents: 36000, baseReferenceMxnCents: 48000, appliedMarketPct: 75 }),
    // Prize Pack también en No holo: en la captura por lote eso pasa el Acabado a burbujas; aquí el acabado es el de la
    // casilla y NO se dibuja ninguna fila de acabado.
    combo({ stamp: PP, finish: 'normal', finishLabel: 'non_holo', previewPriceCents: 9000 }),
    combo({ stamp: STAFF, previewPriceCents: null, unavailableReason: 'no_stamped_market' }),
    combo({ stamp: STAFF, language: 'es', previewPriceCents: null, unavailableReason: 'no_stamped_market' }),
  ],
  candidates: [],
};

function okBatch(folios: string[]) {
  return {
    batchKey: 'k',
    idempotentReplay: false,
    summary: { requested: 1, createdItems: folios.length, failedLines: 0 },
    results: [{ index: 0, ok: true as const, folios, inventoryItemIds: folios.map((f) => `id-${f}`) }],
  };
}

function render(versions: CardVersionsResponse, onToast = vi.fn()) {
  vi.spyOn(api, 'getCardVersions').mockResolvedValue(versions);
  const spy = vi.spyOn(api, 'batchCreateItems').mockResolvedValue(okBatch(['INV-000500']));
  const utils = renderWithProviders(
    <QuickAddSection target={target} buyEffectiveCents={87_500} buySource="market" marketRefCents={125_000} onToast={onToast} />,
    'es',
  );
  return { ...utils, spy, onToast };
}

const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
/** A2 (d): con español o liga «Pagamos por pieza» abre vacío; se teclea lo pagado (MX$100 ⇒ 10 000 centavos). */
const typePrice = (v = '100', label = 'Costo TOTAL de la factura, IVA incluido (MXN)') =>
  fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
/** Relectura de `GET …/versions` como la dispara el navegador al volver a la pestaña (react-query `refetchOnWindowFocus`). */
function refocus() {
  focusManager.setFocused(false);
  focusManager.setFocused(true);
}

describe('UX-ALTA-LIGA · alta rápida con Idioma y Versión (opción A)', () => {
  it('(1) con versiones: Idioma y Versión en burbujas + «Precio de venta (auto)» ANTES de Cantidad; sin fila de acabado', async () => {
    render(STAMPED);
    await screen.findByTestId('ids-price');
    const lang = screen.getByRole('radiogroup', { name: 'Idioma' });
    expect(within(lang).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Inglés', 'Español']);
    expect(within(lang).getByRole('radio', { name: 'Inglés' })).toHaveAttribute('aria-checked', 'true');
    const version = screen.getByRole('radiogroup', { name: 'Versión' });
    expect(within(version).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Sin liga', 'De liga · Prize Pack', 'Staff']);
    expect(within(version).getByRole('radio', { name: 'Sin liga' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('ids-price')).toHaveTextContent('Precio de venta (auto)');
    expect(screen.getByTestId('ids-price')).toHaveTextContent('MX$200.00');
    // El acabado lo fija la casilla: ninguna fila «Acabado» aunque la liga traiga otro acabado.
    expect(screen.queryByTestId('ids-finish')).toBeNull();
    expect(screen.queryByLabelText(/Acabado/)).toBeNull();
    // Orden: las burbujas y el precio van ANTES del stepper de Cantidad.
    const qty = screen.getByLabelText('Cantidad');
    expect(follows(screen.getByTestId('ids-capture'), qty)).toBe(true);
    expect(follows(screen.getByTestId('ids-price'), qty)).toBe(true);
    // Cada burbuja mide 44 px (`min-h-11`) y es un `radio` con `aria-checked`.
    for (const r of [...within(lang).getAllByRole('radio'), ...within(version).getAllByRole('radio')]) {
      expect(r.className).toContain('min-h-11');
      expect(r).toHaveAttribute('aria-checked');
    }
  });

  it.each([
    // Sin combo `es` (el contrato siempre lo trae; aquí, el fallback): «Español» apagada por combo ausente.
    ['solo el combo inglés', EN_ONLY, null],
    ['inglés + español sin precio (sin mercado del inglés)', EN_ONLY_ES_NO_PRICE, 'Sin mercado del inglés'],
  ])('(1) sin liga (%s): Idioma y el precio (auto) se dibujan igual (vIDS-10, ratificado), sin fila Versión', async (_label, versions, esReason) => {
    const { container } = render(versions);
    await screen.findByTestId('ids-price');
    const lang = screen.getByRole('radiogroup', { name: 'Idioma' });
    expect(within(lang).getByRole('radio', { name: 'Inglés' })).toHaveAttribute('aria-checked', 'true');
    const es = within(lang).getByRole('radio', { name: 'Español' });
    expect(es).toHaveAttribute('aria-disabled', 'true');
    if (esReason) expect(es).toHaveAccessibleDescription(esReason);
    expect(screen.getByTestId('ids-price')).toHaveTextContent('MX$200.00');
    expect(screen.queryByRole('radiogroup', { name: 'Versión' })).toBeNull();
    expect(screen.queryByTestId('ids-finish')).toBeNull();
    // Dos radiogroups: «Idioma» y «Adquisición» (Comprar | Aportación).
    expect(container.querySelectorAll('[role="radiogroup"]')).toHaveLength(2);
    expect(screen.getByRole('radiogroup', { name: 'Adquisición' })).toBeInTheDocument();
  });

  it('(2) Español + De liga · Prize Pack: precio del servidor con desglose y el POST lleva language y cardProductId', async () => {
    const { spy } = render(STAMPED);
    await screen.findByTestId('ids-price');
    fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
    fireEvent.click(screen.getByRole('radio', { name: 'De liga · Prize Pack' }));
    expect(screen.getByTestId('ids-price')).toHaveTextContent('MX$360.00');
    expect(screen.getByTestId('ids-breakdown').textContent).toBe('Base: De liga · Prize Pack en inglés · MX$480.00 × 75 % (español)');
    typePrice();
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].items).toEqual([
      {
        cardId: 'c-pikachu-ir',
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'holofoil',
        language: 'es',
        cardProductId: 648703,
        qty: 1,
        acquisitionType: 'compra',
        acquisitionCostCents: 10_000,
      },
    ]);
    // Sin precio tecleado para una versión no default (I-4).
    expect(spy.mock.calls[0][0].items[0]).not.toHaveProperty('listPriceCents');
  });

  it('(2) IDS-F11: inglés sin liga (0 toques) ⇒ el cuerpo de hoy, sin `language` ni `cardProductId`', async () => {
    const { spy } = render(STAMPED);
    await screen.findByTestId('ids-price');
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const line = spy.mock.calls[0][0].items[0];
    expect(line).not.toHaveProperty('language');
    expect(line).not.toHaveProperty('cardProductId');
    expect(line).toMatchObject({ cardId: 'c-pikachu-ir', productType: 'raw', rawCondition: 'NM', finish: 'holofoil', qty: 1 });
  });

  it('(2) solo liga en inglés ⇒ viaja `cardProductId` y NO `language`', async () => {
    const { spy } = render(STAMPED);
    await screen.findByRole('radiogroup', { name: 'Versión' });
    fireEvent.click(screen.getByRole('radio', { name: 'De liga · Prize Pack' }));
    expect(screen.getByTestId('ids-price')).toHaveTextContent('MX$480.00');
    typePrice();
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const line = spy.mock.calls[0][0].items[0];
    expect(line).not.toHaveProperty('language');
    expect(line.cardProductId).toBe(648703);
  });

  it('(3) «Staff» sin mercado va apagada con su motivo y no se elige; una liga que solo existe en otro acabado se crea en ese (A2), ya no se apaga', async () => {
    const { spy } = render({
      combos: [
        ...STAMPED.combos,
        // Una versión que SOLO existe en No holo: con la casilla Holo, A2 la resuelve en No holo (implícito, nombrado).
        combo({ stamp: { type: 'prerelease', label: null, productId: 700001 }, finish: 'normal', finishLabel: 'non_holo', previewPriceCents: 5000, baseReferenceMxnCents: 5000 }),
      ],
      candidates: [],
    });
    const version = await screen.findByRole('radiogroup', { name: 'Versión' });
    const staff = within(version).getByRole('radio', { name: 'Staff' });
    expect(staff).toHaveAttribute('aria-disabled', 'true');
    expect(staff).toHaveAccessibleDescription('Sin mercado de esta versión');
    fireEvent.click(staff);
    expect(within(version).getByRole('radio', { name: 'Sin liga' })).toHaveAttribute('aria-checked', 'true');
    const pre = within(version).getByRole('radio', { name: 'Prerelease (No holo)' });
    expect(pre).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText('No existe con este acabado')).toBeNull();
    fireEvent.click(pre);
    expect(pre).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('ids-price')).toHaveTextContent('MX$50.00');
    expect(screen.getByTestId('ids-breakdown').textContent).toBe('Base: Prerelease (No holo) en inglés · MX$50.00 (mercado de TCGplayer)');
    fireEvent.click(within(version).getByRole('radio', { name: 'Sin liga' }));
    // El camino de siempre sigue abierto: inglés sin liga se crea.
    expect(screen.getByRole('button', { name: 'Dar de alta al inventario' })).toBeEnabled();
    expect(spy).not.toHaveBeenCalled();
  });

  it('(3) la versión elegida se queda sin precio (versiones releídas: misma caché que la captura por lote, o al volver a la pestaña) ⇒ CTA apagado, «Sin precio» visible y ningún POST', async () => {
    // Español · Prize Pack con precio; la relectura trae esa combinación sin mercado: lo elegido sigue elegido pero no se
    // puede crear (I-3) hasta volver a una versión con precio.
    const afterReload: CardVersionsResponse = {
      combos: STAMPED.combos.map((c) =>
        c.stamp?.productId === PP.productId && c.language === 'es'
          ? { ...c, previewPriceCents: null, baseReferenceMxnCents: null, unavailableReason: 'no_stamped_market' as const }
          : c,
      ),
      candidates: [],
    };
    const { spy } = render(STAMPED);
    await screen.findByTestId('ids-price');
    fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
    fireEvent.click(screen.getByRole('radio', { name: 'De liga · Prize Pack' }));
    typePrice();
    const cta = screen.getByRole('button', { name: 'Dar de alta al inventario' });
    expect(cta).toBeEnabled();
    vi.mocked(api.getCardVersions).mockResolvedValue(afterReload);
    await act(async () => refocus());
    await waitFor(() => expect(screen.getByTestId('ids-price')).toHaveTextContent('Sin precio: esta versión no se puede dar de alta hoy'));
    expect(screen.getByRole('radio', { name: 'De liga · Prize Pack' })).toHaveAttribute('aria-disabled', 'true');
    expect(cta).toBeDisabled();
    fireEvent.click(cta);
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).not.toHaveBeenCalled();
    // De vuelta a inglés (Prize Pack en inglés sí tiene precio), el CTA vuelve a estar vivo.
    fireEvent.click(screen.getByRole('radio', { name: 'Inglés' }));
    expect(screen.getByTestId('ids-price')).toHaveTextContent('MX$480.00');
    expect(cta).toBeEnabled();
  });

  it('(4) tras un alta correcta vuelve a «Inglés / Sin liga», y el resumen del panel y el toast nombran la versión', async () => {
    const { spy, onToast } = render(STAMPED);
    await screen.findByTestId('ids-price');
    fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
    fireEvent.click(screen.getByRole('radio', { name: 'De liga · Prize Pack' }));
    typePrice();
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Pieza dada de alta · Español · De liga · Prize Pack · INV-000500.')).toBeInTheDocument();
    expect(onToast).toHaveBeenCalledTimes(1);
    expect(onToast.mock.calls[0][0]).toMatch(/^Pieza dada de alta · Español · De liga · Prize Pack · INV-000500\./);
    expect(screen.getByRole('radio', { name: 'Inglés' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Español' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Sin liga' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'De liga · Prize Pack' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('ids-price')).toHaveTextContent('MX$200.00');
    // Y la siguiente alta, sin tocar nada, vuelve a ser inglés sin liga.
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1][0].items[0]).not.toHaveProperty('language');
    expect(spy.mock.calls[1][0].items[0]).not.toHaveProperty('cardProductId');
  });

  it('(4) inglés sin liga: el resumen es el de hoy (sin versión en el texto)', async () => {
    const { spy, onToast } = render(STAMPED);
    await screen.findByTestId('ids-price');
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Pieza dada de alta · INV-000500.')).toBeInTheDocument();
    expect(onToast.mock.calls[0][0]).toMatch(/^Pieza dada de alta · INV-000500\./);
  });

  it('EN: rótulos y resumen con versión en inglés (paridad de claves)', async () => {
    vi.spyOn(api, 'getCardVersions').mockResolvedValue(STAMPED);
    const spy = vi.spyOn(api, 'batchCreateItems').mockResolvedValue(okBatch(['INV-000501']));
    renderWithProviders(
      <QuickAddSection target={target} buyEffectiveCents={87_500} buySource="market" marketRefCents={125_000} />,
      'en',
    );
    await screen.findByTestId('ids-price');
    fireEvent.click(screen.getByRole('radio', { name: 'Spanish' }));
    typePrice('100', 'TOTAL invoice cost, VAT included (MXN)');
    fireEvent.click(screen.getByRole('button', { name: 'Add to inventory' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole('status')).textContent).toMatch(/^Piece added · Spanish · Regular · INV-000501\. /);
  });

  it('sellado: nunca pide versiones (D-IDS-K: la versión es solo de raw)', async () => {
    const versions = vi.spyOn(api, 'getCardVersions').mockResolvedValue(STAMPED);
    renderWithProviders(
      <QuickAddSection
        target={{ productType: 'sealed', finish: 'normal', sealedProductId: 'sp-bundle', sealedSubtype: 'bundle', sealedCondition: 'mint' }}
        buyEffectiveCents={null}
        buySource={null}
        marketRefCents={null}
      />,
      'es',
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(versions).not.toHaveBeenCalled();
    expect(screen.queryByTestId('ids-capture')).toBeNull();
  });
});

/**
 * I-1 (QA sobre `4538fd1f`): el backend costea la aportación de una versión no default con la referencia DE LA VERSIÓN
 * (`inventory.service.ts` `versionReferenceForAlta` = `versionReferences(...).price`: `R_P` de la liga, y en español
 * `× X` con `scaleByPct`). La tarjeta «Aportación», su bloqueo («Precio pendiente») y lo que viaja tienen que leer esa
 * misma referencia —la que trae cada combo de `GET …/versions` (`baseReferenceMxnCents`, `appliedMarketPct`)— y no la
 * del inglés del binder (`marketRefCents`). Inglés sin liga: la cifra de siempre (0 cambios en el POST).
 */
describe('I-1 · la Aportación se valúa con la referencia de la VERSIÓN elegida', () => {
  /** QA: inglesa MX$1,250 con X = 75 % ⇒ la española se registra en MX$937.50 (no en MX$1,250). */
  const EN_REF = 125_000;
  const WITH_ES: CardVersionsResponse = {
    combos: [
      combo({ previewPriceCents: EN_REF, baseReferenceMxnCents: EN_REF }),
      combo({ language: 'es', previewPriceCents: 93_750, baseReferenceMxnCents: EN_REF, appliedMarketPct: 75 }),
      combo({ stamp: PP, previewPriceCents: 48_000, baseReferenceMxnCents: 48_000 }),
      combo({ stamp: PP, language: 'es', previewPriceCents: 36_000, baseReferenceMxnCents: 48_000, appliedMarketPct: 75 }),
    ],
    candidates: [],
  };
  /** El inglés sin mercado; la liga sí lo tiene (en inglés). */
  const LEAGUE_ONLY_MARKET: CardVersionsResponse = {
    combos: [
      combo({ previewPriceCents: null, baseReferenceMxnCents: null, unavailableReason: 'no_market' }),
      combo({ language: 'es', previewPriceCents: null, baseReferenceMxnCents: null, appliedMarketPct: 75, unavailableReason: 'no_english_market' }),
      combo({ stamp: PP, previewPriceCents: 48_000, baseReferenceMxnCents: 48_000 }),
      combo({ stamp: PP, language: 'es', previewPriceCents: 36_000, baseReferenceMxnCents: 48_000, appliedMarketPct: 75 }),
    ],
    candidates: [],
  };
  const contribCard = () => screen.getByText('Aportación').closest('label')!;
  const contribRadio = () => within(contribCard()).getByRole('radio');
  const contribAmount = () => within(contribCard()).queryByText(/^MX\$/)?.textContent ?? null;
  const cta = () => screen.getByRole('button', { name: 'Dar de alta al inventario' });

  it('(a) Español ⇒ la tarjeta muestra R_en × X con el redondeo del servidor (MX$937.50), no la del inglés (MX$1,250.00); la liga, la suya', async () => {
    const { spy } = render(WITH_ES);
    await screen.findByTestId('ids-price');
    expect(contribAmount()).toBe('MX$1,250.00');
    fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
    expect(contribAmount()).toBe('MX$937.50');
    expect(contribRadio()).toBeEnabled();
    fireEvent.click(screen.getByRole('radio', { name: 'De liga · Prize Pack' }));
    expect(contribAmount()).toBe('MX$360.00');
    fireEvent.click(screen.getByRole('radio', { name: 'Inglés' }));
    expect(contribAmount()).toBe('MX$480.00');
    fireEvent.click(screen.getByRole('radio', { name: 'Sin liga' }));
    expect(contribAmount()).toBe('MX$1,250.00');
    // Y lo que viaja: aportación de la española = `acquisitionPct: 100` + `language` (el servidor valúa; sin costo del cliente).
    fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
    fireEvent.click(contribRadio());
    fireEvent.click(cta());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].items).toEqual([
      { cardId: 'c-pikachu-ir', productType: 'raw', rawCondition: 'NM', finish: 'holofoil', language: 'es', qty: 1, acquisitionType: 'aportacion_en_especie', acquisitionPct: 100 },
    ]);
  });

  it('(b) liga con mercado propio cuando el inglés NO tiene mercado ⇒ la aportación de la liga no se bloquea', async () => {
    vi.spyOn(api, 'getCardVersions').mockResolvedValue(LEAGUE_ONLY_MARKET);
    const spy = vi.spyOn(api, 'batchCreateItems').mockResolvedValue(okBatch(['INV-000502']));
    renderWithProviders(<QuickAddSection target={target} buyEffectiveCents={null} buySource={null} marketRefCents={null} />, 'es');
    await screen.findByRole('radiogroup', { name: 'Versión' });
    // Inglés sin liga sin mercado: bloqueada como hoy.
    expect(contribRadio()).toBeDisabled();
    expect(within(contribCard()).getByText('Precio pendiente')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'De liga · Prize Pack' }));
    expect(contribRadio()).toBeEnabled();
    expect(within(contribCard()).queryByText('Precio pendiente')).toBeNull();
    expect(contribAmount()).toBe('MX$480.00');
    fireEvent.click(contribRadio());
    fireEvent.click(cta());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const line = spy.mock.calls[0][0].items[0];
    expect(line).toMatchObject({ cardProductId: 648703, acquisitionType: 'aportacion_en_especie', acquisitionPct: 100 });
    expect(line).not.toHaveProperty('language');
    expect(line).not.toHaveProperty('acquisitionCostCents');
  });

  it('(c) inglés sin liga ⇒ la cifra de siempre (la del binder), aunque el combo (en, null) traiga otra base; POST de hoy', async () => {
    // STAMPED trae base 20 000 en (en, null) y el binder 125 000: la default sigue leyendo `marketRefCents` (0 cambios).
    const { spy } = render(STAMPED);
    await screen.findByTestId('ids-price');
    expect(contribAmount()).toBe('MX$1,250.00');
    expect(contribRadio()).toBeEnabled();
    fireEvent.click(contribRadio());
    fireEvent.click(cta());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].items).toEqual([
      { cardId: 'c-pikachu-ir', productType: 'raw', rawCondition: 'NM', finish: 'holofoil', qty: 1, acquisitionType: 'aportacion_en_especie', acquisitionPct: 100 },
    ]);
  });

  it('(d) la versión elegida se queda sin referencia (versiones releídas) ⇒ aportación bloqueada con el aviso de hoy y el camino vuelve a «Comprar»', async () => {
    const afterReload: CardVersionsResponse = {
      combos: WITH_ES.combos.map((c) =>
        c.stamp?.productId === PP.productId && c.language === 'es'
          ? { ...c, previewPriceCents: null, baseReferenceMxnCents: null, unavailableReason: 'no_stamped_market' as const }
          : c,
      ),
      candidates: [],
    };
    render(WITH_ES);
    await screen.findByTestId('ids-price');
    fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
    fireEvent.click(screen.getByRole('radio', { name: 'De liga · Prize Pack' }));
    fireEvent.click(contribRadio());
    expect(contribRadio()).toBeChecked();
    vi.mocked(api.getCardVersions).mockResolvedValue(afterReload);
    await act(async () => refocus());
    await waitFor(() => expect(contribRadio()).toBeDisabled());
    expect(within(contribCard()).getByText('Precio pendiente')).toBeInTheDocument();
    expect(within(contribCard()).getByText('Sin valor de mercado — fíjalo en la sección Precios y vuelve a intentar.')).toBeInTheDocument();
    expect(contribAmount()).toBeNull();
    expect(within(screen.getByText('Comprar').closest('label')!).getByRole('radio')).toBeChecked();
  });

  it('espejo de `versionReferenceForAlta`: base de la liga tal cual; español = base × X con `scaleByPct` (floor((c·pct+50)/100)); sin base o sin X ⇒ null', () => {
    expect(versionContributionReferenceCents(null)).toBeNull();
    expect(versionContributionReferenceCents(combo({ stamp: PP, baseReferenceMxnCents: 48_000 }))).toBe(48_000);
    expect(versionContributionReferenceCents(combo({ language: 'es', baseReferenceMxnCents: 125_000, appliedMarketPct: 75 }))).toBe(93_750);
    // Redondeo del servidor (`common/card-version.ts` `scaleByPct`): 33 333 × 75 % = 24 999.75 ⇒ 25 000 (medio arriba).
    expect(versionContributionReferenceCents(combo({ language: 'es', baseReferenceMxnCents: 33_333, appliedMarketPct: 75 }))).toBe(25_000);
    expect(versionContributionReferenceCents(combo({ language: 'es', baseReferenceMxnCents: 1, appliedMarketPct: 50 }))).toBe(1);
    expect(versionContributionReferenceCents(combo({ language: 'es', baseReferenceMxnCents: 125_000, appliedMarketPct: null }))).toBeNull();
    expect(versionContributionReferenceCents(combo({ stamp: PP, baseReferenceMxnCents: null, previewPriceCents: null, unavailableReason: 'no_stamped_market' }))).toBeNull();
  });
});

/** M-2 (QA): con `GET …/versions` en vuelo no hay burbujas y el CTA no debe crear «inglés sin liga» sin haber visto la opción. */
describe('M-2 · mientras cargan las versiones el CTA está apagado', () => {
  const cta = () => screen.getByRole('button', { name: 'Dar de alta al inventario' });

  it.each([
    ['con versiones', STAMPED],
    ['sin versiones (solo inglés: el panel de siempre)', EN_ONLY],
  ])('CTA apagado con la consulta en vuelo y vivo al resolver (%s)', async (_label, versions) => {
    let resolve!: (v: CardVersionsResponse) => void;
    vi.spyOn(api, 'getCardVersions').mockReturnValue(new Promise<CardVersionsResponse>((r) => (resolve = r)));
    const spy = vi.spyOn(api, 'batchCreateItems').mockResolvedValue(okBatch(['INV-000503']));
    renderWithProviders(<QuickAddSection target={target} buyEffectiveCents={87_500} buySource="market" marketRefCents={125_000} />, 'es');
    await waitFor(() => expect(api.getCardVersions).toHaveBeenCalledTimes(1));
    expect(cta()).toBeDisabled();
    fireEvent.click(cta());
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).not.toHaveBeenCalled();
    resolve(versions);
    await waitFor(() => expect(cta()).toBeEnabled());
  });

  it('sellado: no hay nada que cargar ⇒ CTA vivo desde el primer render', () => {
    vi.spyOn(api, 'batchCreateItems').mockResolvedValue(okBatch(['INV-000504']));
    renderWithProviders(
      <QuickAddSection
        target={{ productType: 'sealed', finish: 'normal', sealedProductId: 'sp-bundle', sealedSubtype: 'bundle', sealedCondition: 'mint' }}
        buyEffectiveCents={1_000}
        buySource="market"
        marketRefCents={null}
      />,
      'es',
    );
    expect(cta()).toBeEnabled();
  });
});

/**
 * A2 (contrato v1.116.8 I-6 «Acabado del alta» / «Compra sugerida», IDS-F11 (a)–(d); DESIGN_SYSTEM vIDS-10 §16.5 (a).0 y
 * (a) Comprar). tester-e2e RECHAZÓ sobre el stack real: la liga sembrada (`finishes={holofoil}`) no se podía dar de alta
 * desde la casilla `normal` («No existe con este acabado»). Desde la casilla, el acabado del alta se RESUELVE:
 *  (a) liga con un solo acabado ≠ casilla ⇒ ese, implícito, nombrado en la burbuja y en el desglose; el POST lo lleva;
 *  (b) liga con varios acabados y ninguno el de la casilla ⇒ fila «Acabado» sin preselección y CTA apagado hasta elegir;
 *  (c) el acabado de la casilla está entre los de la liga ⇒ ese (aunque la liga liste otro primero);
 *  (d) español o liga ⇒ «Pagamos por pieza» abre vacío con su ayuda; vuelve el prellenado al regresar a inglés sin liga.
 */
describe('A2 · acabado del alta desde la casilla (IDS-F11 a/b/c) y compra sin prellenar (d)', () => {
  const LEAGUE = { type: 'league' as const, label: null, productId: 651001 };
  const PP2 = { type: 'prize_pack' as const, label: null, productId: 651002 };
  const slotNormal = { cardId: 'c-league-bird', productType: 'raw' as const, finish: 'normal' as const };
  const normal = (o: Partial<VersionComboDTO>) => combo({ finish: 'normal', finishLabel: 'non_holo', ...o });
  /** Casilla `normal`; la liga («Promo de Liga») solo existe en Holo. */
  const LEAGUE_HOLO_ONLY: CardVersionsResponse = {
    combos: [
      normal({ previewPriceCents: 20000, baseReferenceMxnCents: 20000 }),
      normal({ language: 'es', previewPriceCents: 15000, baseReferenceMxnCents: 20000, appliedMarketPct: 75 }),
      combo({ stamp: LEAGUE, previewPriceCents: 12000, baseReferenceMxnCents: 12000 }),
      combo({ stamp: LEAGUE, language: 'es', previewPriceCents: 9000, baseReferenceMxnCents: 12000, appliedMarketPct: 75 }),
    ],
    candidates: [],
  };
  /** Casilla `normal`; Prize Pack en Reverse Holo y Holo (orden del servidor), ninguno `normal`. */
  const PP_TWO_FINISHES: CardVersionsResponse = {
    combos: [
      normal({ previewPriceCents: 20000, baseReferenceMxnCents: 20000 }),
      normal({ language: 'es', previewPriceCents: 15000, baseReferenceMxnCents: 20000, appliedMarketPct: 75 }),
      combo({ stamp: PP2, finish: 'reverse_holo', finishLabel: 'reverse_holo', previewPriceCents: 13000, baseReferenceMxnCents: 13000 }),
      combo({ stamp: PP2, finish: 'reverse_holo', finishLabel: 'reverse_holo', language: 'es', previewPriceCents: 9750, baseReferenceMxnCents: 13000, appliedMarketPct: 75 }),
      combo({ stamp: PP2, previewPriceCents: 15000, baseReferenceMxnCents: 15000 }),
      combo({ stamp: PP2, language: 'es', previewPriceCents: 11250, baseReferenceMxnCents: 15000, appliedMarketPct: 75 }),
    ],
    candidates: [],
  };
  const cta = () => screen.getByRole('button', { name: 'Dar de alta al inventario' });
  const buyInput = () => screen.getByLabelText('Costo TOTAL de la factura, IVA incluido (MXN)') as HTMLInputElement;

  function renderSlot(versions: CardVersionsResponse, t: { cardId: string; productType: 'raw'; finish: 'normal' | 'holofoil' } = slotNormal) {
    vi.spyOn(api, 'getCardVersions').mockResolvedValue(versions);
    const spy = vi.spyOn(api, 'batchCreateItems').mockResolvedValue(okBatch(['INV-000600']));
    renderWithProviders(<QuickAddSection target={t} buyEffectiveCents={87_500} buySource="market" marketRefCents={125_000} />, 'es');
    return spy;
  }

  it('(a) casilla normal + liga solo en Holo ⇒ burbuja encendida «De liga · Promo de Liga (Holo)», sin fila Acabado, desglose con (Holo) y POST con finish holofoil', async () => {
    const spy = renderSlot(LEAGUE_HOLO_ONLY);
    const version = await screen.findByRole('radiogroup', { name: 'Versión' });
    const league = within(version).getByRole('radio', { name: 'De liga · Promo de Liga (Holo)' });
    expect(league).not.toHaveAttribute('aria-disabled');
    fireEvent.click(league);
    expect(league).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByTestId('ids-alta-finish')).toBeNull();
    expect(screen.getByTestId('ids-price')).toHaveTextContent('MX$120.00');
    expect(screen.getByTestId('ids-breakdown').textContent).toBe('Base: De liga · Promo de Liga (Holo) en inglés · MX$120.00 (mercado de TCGplayer)');
    fireEvent.change(buyInput(), { target: { value: '100' } });
    fireEvent.click(cta());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].items).toEqual([
      { cardId: 'c-league-bird', productType: 'raw', rawCondition: 'NM', finish: 'holofoil', cardProductId: 651001, qty: 1, acquisitionType: 'compra', acquisitionCostCents: 10_000 },
    ]);
  });

  it('(a) sin liga el acabado es el de la casilla y la burbuja «Sin liga» no lleva sufijo', async () => {
    const spy = renderSlot(LEAGUE_HOLO_ONLY);
    const version = await screen.findByRole('radiogroup', { name: 'Versión' });
    expect(within(version).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Sin liga', 'De liga · Promo de Liga (Holo)']);
    expect(screen.getByTestId('ids-breakdown').textContent).toBe('Base: Sin liga en inglés · MX$200.00 (mercado de TCGplayer)');
    fireEvent.click(cta());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].items[0]).toMatchObject({ finish: 'normal' });
    expect(spy.mock.calls[0][0].items[0]).not.toHaveProperty('cardProductId');
  });

  it('(b) liga con dos acabados y ninguno el de la casilla ⇒ fila «Acabado» sin preselección, ayuda, precio pendiente y CTA aria-disabled hasta elegir', async () => {
    const spy = renderSlot(PP_TWO_FINISHES);
    const version = await screen.findByRole('radiogroup', { name: 'Versión' });
    expect(screen.queryByTestId('ids-alta-finish')).toBeNull();
    fireEvent.click(within(version).getByRole('radio', { name: 'De liga · Prize Pack' }));
    const finishRow = screen.getByRole('radiogroup', { name: 'Acabado' });
    expect(screen.getByTestId('ids-alta-finish')).toBeInTheDocument();
    // Solo los acabados de la liga, en el orden del servidor, 44 px, ninguno elegido.
    const radios = within(finishRow).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['Reverse Holo', 'Holo']);
    for (const r of radios) {
      expect(r).toHaveAttribute('aria-checked', 'false');
      expect(r.className).toContain('min-h-11');
    }
    expect(finishRow).toHaveAccessibleDescription('Esta versión viene en más de un acabado: elige el tuyo.');
    // Entre Versión y el precio.
    expect(follows(version, finishRow)).toBe(true);
    expect(follows(finishRow, screen.getByTestId('ids-price'))).toBe(true);
    expect(screen.getByTestId('ids-price')).toHaveTextContent('Elige el acabado para ver el precio.');
    expect(cta()).toHaveAttribute('aria-disabled', 'true');
    expect(cta()).toHaveAccessibleDescription('Esta versión viene en más de un acabado: elige el tuyo.');
    fireEvent.change(buyInput(), { target: { value: '100' } });
    fireEvent.click(cta());
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).not.toHaveBeenCalled();
    // Elegir «Holo» ⇒ precio de ese combo, CTA vivo y el POST lleva ese acabado.
    fireEvent.click(within(finishRow).getByRole('radio', { name: 'Holo' }));
    expect(screen.getByTestId('ids-price')).toHaveTextContent('MX$150.00');
    expect(screen.getByTestId('ids-breakdown').textContent).toBe('Base: De liga · Prize Pack (Holo) en inglés · MX$150.00 (mercado de TCGplayer)');
    expect(cta()).not.toHaveAttribute('aria-disabled');
    fireEvent.click(cta());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].items[0]).toMatchObject({ finish: 'holofoil', cardProductId: 651002 });
    expect(spy.mock.calls[0][0].items[0]).not.toHaveProperty('listPriceCents');
  });

  const NOTE_ES = es.admin.m1.batchPublishNote;
  const NOTE_EN = en.admin.m1.batchPublishNote;

  it('A2b (i)(ii) alta de liga en otro acabado ⇒ banner `role="status"` con el sufijo «(Holo)» del acabado y, como segunda frase, la nota «Listas para publicar»', async () => {
    renderSlot(LEAGUE_HOLO_ONLY);
    const version = await screen.findByRole('radiogroup', { name: 'Versión' });
    fireEvent.click(within(version).getByRole('radio', { name: 'De liga · Promo de Liga (Holo)' }));
    fireEvent.change(buyInput(), { target: { value: '100' } });
    fireEvent.click(cta());
    const status = await screen.findByRole('status');
    expect(status.textContent).toBe(`Pieza dada de alta · Inglés · De liga · Promo de Liga (Holo) · INV-000600. ${NOTE_ES}`);
  });

  it('A2b (ii) acabado ELEGIDO en la fila Acabado ⇒ el resumen lo nombra; con el acabado de la casilla no hay sufijo (la nota sí va)', async () => {
    renderSlot(PP_TWO_FINISHES);
    const version = await screen.findByRole('radiogroup', { name: 'Versión' });
    fireEvent.click(within(version).getByRole('radio', { name: 'De liga · Prize Pack' }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Acabado' })).getByRole('radio', { name: 'Reverse Holo' }));
    fireEvent.change(buyInput(), { target: { value: '100' } });
    fireEvent.click(cta());
    expect((await screen.findByRole('status')).textContent).toBe(`Pieza dada de alta · Inglés · De liga · Prize Pack (Reverse Holo) · INV-000600. ${NOTE_ES}`);
  });

  it('A2b (ii) la liga existe en el acabado de la casilla ⇒ sin sufijo; inglés sin liga ⇒ el texto de hoy + la nota', async () => {
    renderSlot(LEAGUE_HOLO_ONLY, { ...slotNormal, finish: 'holofoil' });
    const version = await screen.findByRole('radiogroup', { name: 'Versión' });
    fireEvent.click(within(version).getByRole('radio', { name: 'De liga · Promo de Liga' }));
    fireEvent.change(buyInput(), { target: { value: '100' } });
    fireEvent.click(cta());
    expect((await screen.findByRole('status')).textContent).toBe(`Pieza dada de alta · Inglés · De liga · Promo de Liga · INV-000600. ${NOTE_ES}`);
  });

  it('A2b (i) sin versión: el banner es el de hoy + la nota', async () => {
    renderSlot(LEAGUE_HOLO_ONLY);
    await screen.findByRole('radiogroup', { name: 'Versión' });
    fireEvent.change(buyInput(), { target: { value: '100' } });
    fireEvent.click(cta());
    expect((await screen.findByRole('status')).textContent).toBe(`Pieza dada de alta · INV-000600. ${NOTE_ES}`);
  });

  it('A2b EN: sufijo y nota en inglés', async () => {
    vi.spyOn(api, 'getCardVersions').mockResolvedValue(LEAGUE_HOLO_ONLY);
    vi.spyOn(api, 'batchCreateItems').mockResolvedValue(okBatch(['INV-000600']));
    renderWithProviders(<QuickAddSection target={slotNormal} buyEffectiveCents={87_500} buySource="market" marketRefCents={125_000} />, 'en');
    const version = await screen.findByRole('radiogroup', { name: 'Version' });
    fireEvent.click(within(version).getByRole('radio', { name: /^League · .*\(Holo\)$/ }));
    fireEvent.change(screen.getByLabelText('TOTAL invoice cost, VAT included (MXN)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to inventory' }));
    const text = (await screen.findByRole('status')).textContent!;
    expect(text).toMatch(/^Piece added · English · League · .*\(Holo\) · INV-000600\. /);
    expect(text.endsWith(NOTE_EN)).toBe(true);
  });

  it('TL-A2-1 · liga con varios acabados sin elegir y SIN precio ⇒ el CTA es `aria-disabled`, no `disabled`: sigue enfocable y su ayuda se lee', async () => {
    const spy = renderSlot(PP_TWO_FINISHES);
    const version = await screen.findByRole('radiogroup', { name: 'Versión' });
    fireEvent.click(within(version).getByRole('radio', { name: 'De liga · Prize Pack' }));
    expect(buyInput().value).toBe('');
    expect(cta()).toHaveAttribute('aria-disabled', 'true');
    expect(cta()).not.toBeDisabled();
    cta().focus();
    expect(document.activeElement).toBe(cta());
    expect(cta()).toHaveAccessibleDescription('Esta versión viene en más de un acabado: elige el tuyo.');
    fireEvent.click(cta());
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).not.toHaveBeenCalled();
  });

  it('(b) al volver a «Sin liga» la fila Acabado desaparece y el acabado vuelve a ser el de la casilla', async () => {
    const spy = renderSlot(PP_TWO_FINISHES);
    const version = await screen.findByRole('radiogroup', { name: 'Versión' });
    fireEvent.click(within(version).getByRole('radio', { name: 'De liga · Prize Pack' }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Acabado' })).getByRole('radio', { name: 'Reverse Holo' }));
    expect(screen.getByTestId('ids-price')).toHaveTextContent('MX$130.00');
    fireEvent.click(within(version).getByRole('radio', { name: 'Sin liga' }));
    expect(screen.queryByTestId('ids-alta-finish')).toBeNull();
    fireEvent.click(cta());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].items[0]).toMatchObject({ finish: 'normal' });
    // Y al reelegir la liga, otra vez sin preselección (no se hereda el Reverse Holo de antes).
    fireEvent.click(within(version).getByRole('radio', { name: 'De liga · Prize Pack' }));
    for (const r of within(screen.getByRole('radiogroup', { name: 'Acabado' })).getAllByRole('radio')) expect(r).toHaveAttribute('aria-checked', 'false');
  });

  it('(c) el acabado de la casilla está entre los de la liga ⇒ ese, aunque la liga liste otro primero; sin sufijo ni fila', async () => {
    // Prize Pack en normal (primero) y holofoil; la casilla es Holo ⇒ el alta va en holofoil.
    const spy = renderSlot(
      {
        combos: [
          combo({}),
          combo({ language: 'es', previewPriceCents: 15000, appliedMarketPct: 75 }),
          combo({ stamp: PP, finish: 'normal', finishLabel: 'non_holo', previewPriceCents: 9000, baseReferenceMxnCents: 9000 }),
          combo({ stamp: PP, previewPriceCents: 48000, baseReferenceMxnCents: 48000 }),
        ],
        candidates: [],
      },
      target,
    );
    const version = await screen.findByRole('radiogroup', { name: 'Versión' });
    fireEvent.click(within(version).getByRole('radio', { name: 'De liga · Prize Pack' }));
    expect(screen.queryByTestId('ids-alta-finish')).toBeNull();
    expect(screen.getByTestId('ids-price')).toHaveTextContent('MX$480.00');
    expect(screen.getByTestId('ids-breakdown').textContent).toBe('Base: De liga · Prize Pack en inglés · MX$480.00 (mercado de TCGplayer)');
    fireEvent.change(buyInput(), { target: { value: '400' } });
    fireEvent.click(cta());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].items[0]).toMatchObject({ finish: 'holofoil', cardProductId: 648703 });
  });

  it('(a) la burbuja de una liga con un solo acabado se apaga solo si ese combo trae motivo (no por «no existe con este acabado»)', async () => {
    renderSlot({
      combos: [
        ...LEAGUE_HOLO_ONLY.combos.filter((c) => c.stamp == null),
        combo({ stamp: LEAGUE, previewPriceCents: null, baseReferenceMxnCents: null, unavailableReason: 'no_stamped_market' }),
        combo({ stamp: LEAGUE, language: 'es', previewPriceCents: null, baseReferenceMxnCents: null, appliedMarketPct: 75, unavailableReason: 'no_stamped_market' }),
      ],
      candidates: [],
    });
    const version = await screen.findByRole('radiogroup', { name: 'Versión' });
    const league = within(version).getByRole('radio', { name: 'De liga · Promo de Liga (Holo)' });
    expect(league).toHaveAttribute('aria-disabled', 'true');
    expect(league).toHaveAccessibleDescription('Sin mercado de esta versión');
    expect(screen.queryByText('No existe con este acabado')).toBeNull();
  });

  it('(d) español o liga ⇒ «Pagamos por pieza» abre vacío con su ayuda; vuelve el prellenado al regresar a inglés sin liga; tras el alta también', async () => {
    const spy = renderSlot(LEAGUE_HOLO_ONLY);
    await screen.findByTestId('ids-price');
    expect(buyInput().value).toBe('875');
    expect(screen.getByText('Sugerido por regla')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
    expect(buyInput().value).toBe('');
    expect(screen.getByText('Sin sugerencia para esta versión: escribe lo que pagaste.')).toBeInTheDocument();
    expect(screen.queryByText('Sugerido por regla')).toBeNull();
    expect(cta()).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Inglés' }));
    expect(buyInput().value).toBe('875');
    expect(screen.getByText('Sugerido por regla')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'De liga · Promo de Liga (Holo)' }));
    expect(buyInput().value).toBe('');
    expect(screen.getByText('Sin sugerencia para esta versión: escribe lo que pagaste.')).toBeInTheDocument();
    fireEvent.change(buyInput(), { target: { value: '95.5' } });
    fireEvent.click(cta());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].items[0]).toMatchObject({ finish: 'holofoil', cardProductId: 651001, acquisitionCostCents: 9_550 });
    // Tras el alta vuelve a «Inglés / Sin liga» y, con ello, el prellenado.
    await screen.findByText(/Pieza dada de alta/);
    expect(buyInput().value).toBe('875');
  });

  it('(d) sin sugerido del binder: en inglés sin liga la ayuda es la de hoy; con versión, la de la versión', async () => {
    vi.spyOn(api, 'getCardVersions').mockResolvedValue(LEAGUE_HOLO_ONLY);
    renderWithProviders(<QuickAddSection target={slotNormal} buyEffectiveCents={null} buySource={null} marketRefCents={null} />, 'es');
    await screen.findByTestId('ids-price');
    expect(screen.getByText('Sin sugerido — captura el precio pagado.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
    expect(screen.getByText('Sin sugerencia para esta versión: escribe lo que pagaste.')).toBeInTheDocument();
  });

  it('vIDS-10: la caja de candidatas NO se dibuja en el alta rápida (queda en Alta por lote)', async () => {
    renderSlot({
      ...LEAGUE_HOLO_ONLY,
      candidates: [{ tcgplayerProductId: 777001, name: 'League Bird (Prize Pack)', stamp: { ...PP2, productId: 777001 }, finishes: ['normal'] }],
    });
    await screen.findByRole('radiogroup', { name: 'Versión' });
    expect(screen.queryByTestId('ids-candidates')).toBeNull();
    expect(screen.queryByText(/Hay versiones de liga que no supimos ligar/)).toBeNull();
  });

  it('vIDS-10: Idioma se dibuja en TODA carta, también sin liga (0 toques: «Inglés» de fábrica; el POST de hoy)', async () => {
    const spy = renderSlot(EN_ONLY, target);
    await screen.findByTestId('ids-price');
    const lang = screen.getByRole('radiogroup', { name: 'Idioma' });
    expect(within(lang).getByRole('radio', { name: 'Inglés' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('radiogroup', { name: 'Versión' })).toBeNull();
    fireEvent.click(cta());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].items[0]).not.toHaveProperty('language');
    expect(spy.mock.calls[0][0].items[0]).not.toHaveProperty('cardProductId');
  });
});

/** TL-ALTA-4: el aviso de error de `GET …/versions` con «Reintentar» (prometido en el comentario de QuickAdd, sin prueba). */
describe('TL-ALTA-4 · `GET …/versions` falla ⇒ aviso con «Reintentar» que relee', () => {
  it('rechazo ⇒ `ids-versions-error` visible; «Reintentar» vuelve a pedir las versiones y el aviso se va', async () => {
    const versions = vi.spyOn(api, 'getCardVersions').mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(STAMPED);
    vi.spyOn(api, 'batchCreateItems').mockResolvedValue(okBatch(['INV-000700']));
    renderWithProviders(<QuickAddSection target={target} buyEffectiveCents={87_500} buySource="market" marketRefCents={125_000} />, 'es');
    expect(await screen.findByTestId('ids-versions-error')).toBeInTheDocument();
    expect(versions).toHaveBeenCalledTimes(1);
    // El camino de siempre sigue abierto (inglés sin liga).
    expect(screen.getByRole('button', { name: 'Dar de alta al inventario' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(versions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('ids-versions-error')).toBeNull());
    expect(await screen.findByRole('radiogroup', { name: 'Versión' })).toBeInTheDocument();
  });
});

/** TL-ALTA-5: «tiene versiones» vive en `captureModel`; una relectura que lo apaga con «Español» elegido no deja un CTA mudo. */
describe('TL-ALTA-5 · relectura que apaga `hasVersions` con «Español» elegido', () => {
  it('el panel sigue visible, «Español» apagada con su motivo y el precio lo dice; de vuelta a «Inglés» el CTA vive', async () => {
    // Primera lectura falla (Idioma se dibuja igual, ambas burbujas vivas: el servidor aún no dijo nada); el operador
    // elige «Español»; la relectura trae solo inglés creable ⇒ `hasVersions` se apaga con «Español» elegido.
    const versions = vi.spyOn(api, 'getCardVersions').mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(EN_ONLY_ES_NO_PRICE);
    const spy = vi.spyOn(api, 'batchCreateItems').mockResolvedValue(okBatch(['INV-000701']));
    renderWithProviders(<QuickAddSection target={target} buyEffectiveCents={87_500} buySource="market" marketRefCents={125_000} />, 'es');
    await screen.findByTestId('ids-versions-error');
    fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
    expect(screen.getByRole('radio', { name: 'Español' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(versions).toHaveBeenCalledTimes(2));
    const es = screen.getByRole('radio', { name: 'Español' });
    await waitFor(() => expect(es).toHaveAttribute('aria-disabled', 'true'));
    // El panel no desaparece y el motivo está a la vista (burbuja y precio): nunca un CTA apagado en silencio.
    expect(screen.getByTestId('ids-capture')).toBeInTheDocument();
    expect(es).toHaveAccessibleDescription('Sin mercado del inglés');
    expect(screen.getByTestId('ids-price')).toHaveTextContent('Sin mercado del inglés');
    const cta = screen.getByRole('button', { name: 'Dar de alta al inventario' });
    expect(cta).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Inglés' }));
    expect(cta).toBeEnabled();
    fireEvent.click(cta);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].items[0]).not.toHaveProperty('language');
  });
});
