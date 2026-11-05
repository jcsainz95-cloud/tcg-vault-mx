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
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import type { CardVersionsResponse, VersionComboDTO } from '@/types/contract';
import { QuickAddSection } from './QuickAdd';

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

describe('UX-ALTA-LIGA · alta rápida con Idioma y Versión (opción A)', () => {
  it('(1) con versiones: Idioma y Versión en burbujas + «Precio de venta (auto)» ANTES de Cantidad; sin fila de acabado', async () => {
    render(STAMPED);
    const lang = await screen.findByRole('radiogroup', { name: 'Idioma' });
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
    ['solo el combo inglés', EN_ONLY],
    ['inglés + español sin precio (sin mercado del inglés)', EN_ONLY_ES_NO_PRICE],
  ])('(1) sin versiones (%s): el DOM de hoy, sin burbujas ni precio automático', async (_label, versions) => {
    const { container } = render(versions);
    await waitFor(() => expect(api.getCardVersions).toHaveBeenCalledTimes(1));
    // Deja que la respuesta se asiente: si algo se dibujara, ya estaría.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('ids-capture')).toBeNull();
    expect(screen.queryByTestId('ids-price')).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Idioma' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Versión' })).toBeNull();
    // El único radiogroup es «Adquisición» (Comprar | Aportación), como hoy.
    expect(container.querySelectorAll('[role="radiogroup"]')).toHaveLength(1);
    expect(screen.getByRole('radiogroup', { name: 'Adquisición' })).toBeInTheDocument();
  });

  it('(2) Español + De liga · Prize Pack: precio del servidor con desglose y el POST lleva language y cardProductId', async () => {
    const { spy } = render(STAMPED);
    await screen.findByRole('radiogroup', { name: 'Idioma' });
    fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
    fireEvent.click(screen.getByRole('radio', { name: 'De liga · Prize Pack' }));
    expect(screen.getByTestId('ids-price')).toHaveTextContent('MX$360.00');
    expect(screen.getByTestId('ids-breakdown').textContent).toBe('Base: De liga · Prize Pack en inglés · MX$480.00 × 75 % (español)');
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
        acquisitionCostCents: 87_500,
      },
    ]);
    // Sin precio tecleado para una versión no default (I-4).
    expect(spy.mock.calls[0][0].items[0]).not.toHaveProperty('listPriceCents');
  });

  it('(2) IDS-F11: inglés sin liga (0 toques) ⇒ el cuerpo de hoy, sin `language` ni `cardProductId`', async () => {
    const { spy } = render(STAMPED);
    await screen.findByRole('radiogroup', { name: 'Idioma' });
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
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const line = spy.mock.calls[0][0].items[0];
    expect(line).not.toHaveProperty('language');
    expect(line.cardProductId).toBe(648703);
  });

  it('(3) «Staff» sin mercado va apagada con su motivo y no se elige; el combo que no existe con el acabado de la casilla, igual', async () => {
    const { spy } = render({
      combos: [
        ...STAMPED.combos,
        // Una versión que SOLO existe en No holo: con la casilla Holo no existe ⇒ apagada «No existe con este acabado».
        combo({ stamp: { type: 'prerelease', label: null, productId: 700001 }, finish: 'normal', finishLabel: 'non_holo', previewPriceCents: 5000 }),
      ],
      candidates: [],
    });
    const version = await screen.findByRole('radiogroup', { name: 'Versión' });
    const staff = within(version).getByRole('radio', { name: 'Staff' });
    expect(staff).toHaveAttribute('aria-disabled', 'true');
    expect(staff).toHaveAccessibleDescription('Sin mercado de esta versión');
    fireEvent.click(staff);
    expect(within(version).getByRole('radio', { name: 'Sin liga' })).toHaveAttribute('aria-checked', 'true');
    const pre = within(version).getByRole('radio', { name: 'Prerelease' });
    expect(pre).toHaveAttribute('aria-disabled', 'true');
    expect(pre).toHaveAccessibleDescription('No existe con este acabado');
    fireEvent.click(pre);
    expect(within(version).getByRole('radio', { name: 'Sin liga' })).toHaveAttribute('aria-checked', 'true');
    // El camino de siempre sigue abierto: inglés sin liga se crea.
    expect(screen.getByRole('button', { name: 'Dar de alta al inventario' })).toBeEnabled();
    expect(spy).not.toHaveBeenCalled();
  });

  it('(3) la versión elegida se queda sin precio (versiones releídas tras ligar una candidata) ⇒ CTA apagado, «Sin precio» visible y ningún POST', async () => {
    // Español · Prize Pack con precio; al ligar la candidata el servidor devuelve las versiones nuevas y esa combinación ya no
    // tiene mercado: lo elegido sigue elegido pero no se puede crear (I-3) hasta volver a una versión con precio.
    const withCandidate: CardVersionsResponse = {
      ...STAMPED,
      candidates: [{ tcgplayerProductId: 777001, name: 'Pikachu ex (Prize Pack Series Seven)', stamp: { ...PP, productId: 777001 }, finishes: ['holofoil'] }],
    };
    const afterAttach: CardVersionsResponse = {
      combos: STAMPED.combos.map((c) =>
        c.stamp?.productId === PP.productId && c.language === 'es'
          ? { ...c, previewPriceCents: null, baseReferenceMxnCents: null, unavailableReason: 'no_stamped_market' as const }
          : c,
      ),
      candidates: [],
    };
    vi.spyOn(api, 'attachStampedCandidate').mockResolvedValue(afterAttach);
    const { spy } = render(withCandidate);
    await screen.findByRole('radiogroup', { name: 'Idioma' });
    fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
    fireEvent.click(screen.getByRole('radio', { name: 'De liga · Prize Pack' }));
    const cta = screen.getByRole('button', { name: 'Dar de alta al inventario' });
    expect(cta).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Es esta: Pikachu ex (Prize Pack Series Seven)' }));
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
    await screen.findByRole('radiogroup', { name: 'Idioma' });
    fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
    fireEvent.click(screen.getByRole('radio', { name: 'De liga · Prize Pack' }));
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
    await screen.findByRole('radiogroup', { name: 'Idioma' });
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
    await screen.findByRole('radiogroup', { name: 'Language' });
    fireEvent.click(screen.getByRole('radio', { name: 'Spanish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to inventory' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Piece added · Spanish · Regular · INV-000501.')).toBeInTheDocument();
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
