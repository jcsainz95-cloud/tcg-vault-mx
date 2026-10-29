import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { expectCreditsFigureQualified } from '@/test/grading';
import * as api from '@/lib/api';
import { mockSettings } from '@/lib/mock/fixtures';
import { M10View, M10_LIST_DIAL_KEYS } from './M10View';
import { WISHLIST_DIAL_KEYS } from './sections/WishlistDialsSection';
import { DIRECT_SHIP_DIAL_KEYS } from './sections/DirectShipSection';
import { FEATURED_PSA_DIAL_KEYS } from './sections/FeaturedPsaDialsSection';
import es from '../../../../../../messages/es.json';

// `@/i18n/navigation` (next-intl) no resuelve bajo vitest; se stubea a un <a> que preserva href.
// Lo necesita el enlace a la lista de revisión del aviso de APAGADO del gancho (§22.13e).
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * El fixture sirve el dial del gancho GUARDADO en `on` (es un entorno «ya encendido»). El estado
 * que de verdad importa —el flip `off → on`, el único que autoriza gasto— exige partir de `off`,
 * así que se sirve un `GET /admin/settings` con el dial apagado. No se muta el fixture global.
 */
function withHookSavedOff() {
  return vi
    .spyOn(api, 'getSettings')
    .mockResolvedValue({ ...mockSettings, gradingHookEnabled: 'off' });
}

describe('M10View · Config y bitácora', () => {
  it('carga los diales con el valor de la API (cents → pesos)', async () => {
    renderWithProviders(<M10View />, 'es');
    // shippingFeeCents 17500 → MX$175 mostrado en pesos.
    const shipping = (await screen.findByLabelText(/Envío de un retiro \(cobro al cliente\)/)) as HTMLInputElement;
    expect(shipping.value).toBe('175');
  });

  it('habilita guardar solo tras editar un dial (PUT parcial)', async () => {
    renderWithProviders(<M10View />, 'es');
    const shipping = (await screen.findByLabelText(/Envío de un retiro \(cobro al cliente\)/)) as HTMLInputElement;
    // Botón de guardar deshabilitado sin cambios.
    const saveBtn = screen.getByRole('button', { name: /Guardar 0/ });
    expect(saveBtn).toBeDisabled();
    fireEvent.change(shipping, { target: { value: '200' } });
    expect(screen.getByRole('button', { name: /Guardar 1/ })).toBeEnabled();
  });

  it('muestra la bitácora de auditoría desde la API', async () => {
    renderWithProviders(<M10View />, 'es');
    expect((await screen.findAllByText('settings.update')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('order.refund')).length).toBeGreaterThan(0);
  });

  /**
   * Errata del contrato 2026-10-04: los eventos del sistema (p. ej. `auth.password_lock` disparado
   * desde el login) llegan con `actorUserId` y `actorRole` en null. La celda de actor pinta «—»
   * (no un hueco, no un Badge vacío, no «null») y el resto de la fila se pinta normal.
   */
  it('un evento del sistema sin actor (actorUserId/actorRole null) pinta «—» en Actor', async () => {
    vi.spyOn(api, 'getAuditLog').mockResolvedValue({
      data: [
        { id: 'al-sys', actorUserId: null, actorRole: null, action: 'auth.password_lock', entityType: 'User', entityId: 'u-ana', createdAt: '2026-10-04T09:00:00Z' },
        { id: 'al-hum', actorUserId: 'u-admin', actorRole: 'super_admin', action: 'settings.update', entityType: 'ConfigSetting', entityId: 'shipping_fee_cents', createdAt: '2026-10-04T08:00:00Z' },
      ],
      page: 1,
      pageSize: 20,
      total: 2,
    });
    renderWithProviders(<M10View />, 'es');
    const lockCell = (await screen.findAllByText('auth.password_lock'))[0];
    const table = lockCell.closest('table')!;
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent?.trim());
    const col = headers.indexOf('Actor');
    expect(col).toBeGreaterThanOrEqual(0);
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const sysRow = rows.find((tr) => tr.textContent?.includes('auth.password_lock'))!;
    const humRow = rows.find((tr) => tr.textContent?.includes('settings.update'))!;
    expect(sysRow.querySelectorAll('td')[col].textContent?.trim()).toBe('—');
    // La fila con actor humano sigue pintando id y rol.
    expect(humRow.querySelectorAll('td')[col].textContent).toContain('u-admin');
    expect(humRow.querySelectorAll('td')[col].textContent).toContain('super_admin');
    expect(table.textContent).not.toMatch(/\bnull\b|\bundefined\b/);
  });

  it('ya NO muestra el dial MUERTO de venta (salesMarkupPct)', async () => {
    renderWithProviders(<M10View />, 'es');
    // Espera a que carguen los diales.
    await screen.findByLabelText(/Envío de un retiro \(cobro al cliente\)/);
    // salesMarkupPct: el precio de venta lo deriva la curva, no un markup global.
    expect(screen.queryByLabelText(/Markup de venta/)).not.toBeInTheDocument();
  });

  /**
   * ⭐ **El colchón del FX se edita AQUÍ, y ahora es la única puerta** (`DESIGN_SYSTEM §30.1` y
   * §30.3d). La tarjeta de M2 lo **muestra** de solo lectura y su copy —normativo— dice *«Se edita
   * en Ajustes»*. Este candado es el que hace verdadera esa frase: **rojo si un dial de dinero se
   * queda sin ningún editor en el back-office**, que es como se llega a moverlo con `curl`.
   */
  it('v1.63.3 · el colchón del tipo de cambio SÍ se edita aquí (§30.1: M2 lo muestra, M10 lo edita)', async () => {
    renderWithProviders(<M10View />, 'es');
    const field = (await screen.findByLabelText(/Colchón del tipo de cambio/)) as HTMLInputElement;
    expect(field).toBeEnabled();
    await userEvent.clear(field);
    await userEvent.type(field, '5');
    expect(screen.getByRole('button', { name: /Guardar 1/ })).toBeEnabled();
  });

  /**
   * D2 (techlead): sin este dial en la UI, encender la feature exigía `curl` — y el criterio 110(e)
   * pide «desde el back-office, sin redeploy, auditado». El PUT parcial de M10 ya es auditado.
   * v1.51 (M-48 —era `M-46`, v1.54(1)): el dial es UNO SOLO y su etiqueta carga LAS DOS consecuencias (§22.13g).
   */
  it('v1.51 · el gancho de grading tiene UN dial, y su etiqueta dice que publica Y trae datos', async () => {
    renderWithProviders(<M10View />, 'es');
    const dial = (await screen.findByLabelText(/Gancho de grading — publica y trae datos/)) as HTMLSelectElement;
    expect(dial.tagName).toBe('SELECT');
    expect(Array.from(dial.options).map((o) => o.value)).toEqual(['off', 'on']);
    // El dial retirado ya no existe: si reapareciera, alguien habría revivido una clave que hoy da 422.
    expect(screen.queryByLabelText(/Valor estimado si se gradea/)).not.toBeInTheDocument();
  });

  /**
   * §22.13(d) — encender es un ACTO DE DINERO. El aviso tiene que decir las dos cosas: que publica y
   * que gasta créditos de un proveedor de paga. Y la cifra sale del tope VIVO, no horneada.
   *
   * v1.113⟨portada⟩ (§DYN.3/§DYN.4.3, DYN-F5): el techo ya NO es `cartas por corrida × 2 × 2` bajo el supuesto de cobro
   * por petición (el tope de cartas de M2 se retiró). Es el tope de créditos PSA por día de M10
   * (`gradedEstimateDailyCreditCap`), que el servidor aplica sobre lo CARGADO (reportado por el proveedor o estimado):
   * por eso la cifra va calificada como TOPE, con su única holgura (el error de estimación de un set).
   */
  it('v1.51 · al encenderlo el aviso dice que PUBLICA y que GASTA, con el tope diario de créditos CALIFICADO', async () => {
    const spy = vi
      .spyOn(api, 'getSettings')
      .mockResolvedValue({ ...mockSettings, gradingHookEnabled: 'off', gradedEstimateDailyCreditCap: 1200 });
    renderWithProviders(<M10View />, 'es');
    const dial = (await screen.findByLabelText(/Gancho de grading/)) as HTMLSelectElement;

    // Guardado en `off` y sin tocar: SOLO la nota persistente, ningún banner (§22.13k.a).
    expect(screen.queryByText(/Y gasta\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/Para las dos cosas a la vez\./)).not.toBeInTheDocument();

    fireEvent.change(dial, { target: { value: 'on' } });

    // `role="alert"` SOLO en el flip a `on`: ese es el momento de leerlo, no después de guardar.
    const warning = await screen.findByRole('alert');
    spy.mockRestore();
    expect(warning.textContent).toMatch(/Publica\./);
    expect(warning.textContent).toMatch(/Y gasta\./);
    expect(warning.textContent).toMatch(/proveedor/i);
    // La cifra es el tope VIVO del servidor (1 200 en este GET), no el seed 3 000 ni un literal.
    expect(warning.textContent).toMatch(/no pasa de\s*1[.,\s]?200 créditos al día/);
    expect(warning.textContent).not.toMatch(/3[.,\s]?000 créditos al día/);
    // Y dice cómo se cuentan y su única holgura.
    expect(warning.textContent).toMatch(/contados como los reporta el proveedor/);
    expect(warning.textContent).toMatch(/error de estimar una colección/);
    // El modelo retirado no reaparece: ni cartas por corrida ni la multiplicación que lo producía.
    expect(warning.textContent).not.toMatch(/cartas tuyas|corridas al día|\d\s*×\s*\d/);
    // (k.l) — ninguna oración con «créditos al día» sin su calificador en la MISMA oración.
    expectCreditsFigureQualified(warning.textContent!);
    // §7.6: la acción de dinero declara quién puede y dónde queda.
    expect(warning.textContent).toMatch(/Solo súper-admin · queda en bitácora/);
    expect(warning.textContent).toMatch(/No cambia ningún precio de venta/i);
    // Y se guarda como un dial más: PUT parcial auditado, sin redeploy.
    expect(screen.getByRole('button', { name: /Guardar 1/ })).toBeEnabled();
  });

  /**
   * §22.13(d) + (h) — «cede la cifra, nunca el aviso». Un servidor anterior a §DYN no trae el tope diario: el aviso NO
   * desaparece, cae a `onNoFigures` y no publica cifra.
   */
  it('v1.51 · si el tope diario no viene, el aviso de encendido SIGUE saliendo (sin la cifra)', async () => {
    const { gradedEstimateDailyCreditCap: _drop, ...sinTope } = mockSettings;
    const settingsSpy = vi.spyOn(api, 'getSettings').mockResolvedValue({ ...sinTope, gradingHookEnabled: 'off' });
    renderWithProviders(<M10View />, 'es');
    const dial = (await screen.findByLabelText(/Gancho de grading/)) as HTMLSelectElement;
    fireEvent.change(dial, { target: { value: 'on' } });

    const warning = await screen.findByRole('alert');
    settingsSpy.mockRestore();
    expect(warning.textContent).toMatch(/Publica\./);
    expect(warning.textContent).toMatch(/Y gasta\./);
    expect(warning.textContent).toMatch(/gasta créditos en cada corrida/i);
    expect(warning.textContent).not.toMatch(/créditos al día\b(?! de)/);
    expect(warning.textContent).not.toMatch(/\d\s*×\s*\d/);
    expect(warning.textContent).toMatch(/hasta el tope de créditos al día de «Destacadas y PSA»/);
  });

  /**
   * §22.13(c)/(e) — el aviso lo elige el SENTIDO del cambio. Apagar no es peligroso: no sube a
   * `alert`, y su trabajo es la PUNTERÍA (que nadie apague la feature entera por una carta mala).
   */
  it('v1.51 · al apagarlo aparece el OTRO aviso, con la escalera de remedios y sin `alert`', async () => {
    renderWithProviders(<M10View />, 'es');
    const dial = (await screen.findByLabelText(/Gancho de grading/)) as HTMLSelectElement;
    // El fixture guarda el dial en `on`; apagarlo en el borrador dispara el aviso de apagado.
    fireEvent.change(dial, { target: { value: 'off' } });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const off = await screen.findByText(/Para las dos cosas a la vez\./);
    const banner = off.closest('[role="status"]') as HTMLElement;
    expect(banner).toBeTruthy();
    expect(banner.textContent).toMatch(/Apagar también deja de actualizar/);
    expect(banner.textContent).toMatch(/Para una cifra concreta, este no es el remedio\./);
    // Un solo enlace, y con destino REAL (el ancla `gancho-revision` de la lista de revisión de M2).
    const link = within(banner).getByRole('link', { name: /lista de revisión/i });
    expect(link).toHaveAttribute('href', '/admin/m2#gancho-revision');
    // Cita el label literal del botón que existe en M2 (`admin.m2.priceIngest.trigger`).
    expect(banner.textContent).toMatch(/Actualizar precios ahora/);
  });

  /**
   * §22.13(c) — con el dial YA guardado en `on`, el mismo texto sigue visible como recordatorio de
   * estado: **no desaparece tras guardar**, y no vuelve a interrumpir (`status`, no `alert`).
   *
   * ⚠ **Intermitente MEDIDO (1 rojo / 6 corridas de la suite completa; aislado 15/15) y su causa,
   * reproducida a mano:** este aviso se pinta **dos veces con dos árboles distintos**. Mientras
   * `graded-estimates-config` (la segunda query, la del tope de M2) está en vuelo, la variante es
   * `onNoFigures`; cuando resuelve, pasa a `on` y React **desmonta** el `<strong>Y gasta.</strong>`
   * de la primera para montar el de la segunda. Un `findByText` puede resolver legítimamente con el
   * nodo de la variante vieja y quedarse con un nodo ya **desprendido** del documento: ahí
   * `closest('[role="status"]')` devuelve `null` y el rojo es «expected null to be truthy».
   * ⛔ **No es presupuesto de reloj** —subir `asyncUtilTimeout` no lo toca— sino un nodo
   * transitorio; por eso la espera se pone sobre la **aserción entera** (`waitFor` re-consulta el
   * DOM en cada intento y acaba agarrando el nodo ya asentado). Si el aviso NUNCA fuera `status`,
   * el `waitFor` agota su presupuesto y el test sigue en rojo: no se esconde ninguna regresión.
   */
  it('v1.51 · con el dial guardado en `on`, el aviso persiste como `status` (no `alert`)', async () => {
    renderWithProviders(<M10View />, 'es');
    await screen.findByLabelText(/Gancho de grading/);
    const banner = await waitFor(() => {
      const reminder = screen.getByText(/Y gasta\./);
      const host = reminder.closest('[role="status"]');
      expect(host).toBeTruthy();
      return host as HTMLElement;
    });
    expect(banner).toBeTruthy();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  /** §22.13(c) — los dos avisos NUNCA coexisten: el estado efectivo es uno solo. */
  it('v1.51 · los dos avisos del gancho nunca se ven a la vez', async () => {
    renderWithProviders(<M10View />, 'es');
    const dial = (await screen.findByLabelText(/Gancho de grading/)) as HTMLSelectElement;

    fireEvent.change(dial, { target: { value: 'off' } });
    expect(screen.queryByText(/Para las dos cosas a la vez\./)).toBeInTheDocument();
    expect(screen.queryByText(/Y gasta\./)).not.toBeInTheDocument();

    fireEvent.change(dial, { target: { value: 'on' } });
    expect(screen.queryByText(/Y gasta\./)).toBeInTheDocument();
    expect(screen.queryByText(/Para las dos cosas a la vez\./)).not.toBeInTheDocument();
  });

  /**
   * §22.13(h) — PROHIBIDO decir que el disclaimer no está aprobado: **ya lo está** (§22.12 nº14).
   * Lo único que sigue siendo verdad es que no hubo revisión legal profesional.
   */
  it('v1.51 · el aviso NO afirma que falte el visto bueno del dueño (solo la revisión legal)', async () => {
    const spy = withHookSavedOff();
    renderWithProviders(<M10View />, 'es');
    const dial = (await screen.findByLabelText(/Gancho de grading/)) as HTMLSelectElement;
    fireEvent.change(dial, { target: { value: 'on' } });

    const warning = await screen.findByRole('alert');
    spy.mockRestore();
    expect(warning.textContent).not.toMatch(/visto bueno/i);
    expect(warning.textContent).toMatch(/aprobado por el dueño/i);
    expect(warning.textContent).toMatch(/sin revisión legal profesional/i);
  });

  it('el proveedor de referencia por-carta es un Select validado (no texto libre)', async () => {
    renderWithProviders(<M10View />, 'es');
    const raw = (await screen.findByLabelText(/Proveedor de referencia por-carta \(raw\)/)) as
      | HTMLSelectElement
      | HTMLInputElement;
    // Es un <select> con las 4 opciones válidas del contrato (PriceSource).
    expect(raw.tagName).toBe('SELECT');
    const options = Array.from((raw as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(['pokemontcg_io', 'pokemonpricetracker', 'poketrace', 'manual']);
  });

  it('expone el proveedor de la ingesta MASIVA (bulk) con su propio set de opciones', async () => {
    renderWithProviders(<M10View />, 'es');
    const bulk = (await screen.findByLabelText(/Proveedor de ingesta masiva/)) as HTMLSelectElement;
    expect(bulk.tagName).toBe('SELECT');
    const options = Array.from(bulk.options).map((o) => o.value);
    // Set DEDICADO del bulk: coincide EXACTO con PRICE_PROVIDER_VALUES del backend.
    // Incluye tcgcsv_singles (P-47) y NO incluye poketrace/manual (serían 422).
    expect(options).toEqual(['pokemontcg_io', 'pokemonpricetracker', 'tcgcsv_singles']);
    expect(options).toContain('tcgcsv_singles');
    expect(options).not.toContain('poketrace');
    expect(options).not.toContain('manual');
  });

  it('al cambiar el bulk provider hace PUT parcial { priceProvider } camelCase', async () => {
    // mockResolvedValue evita mutar el estado global de mock (setMockSettings) entre tests.
    const spy = vi
      .spyOn(api, 'updateSettings')
      .mockResolvedValue({ priceProvider: 'tcgcsv_singles' } as never);
    renderWithProviders(<M10View />, 'es');
    const bulk = (await screen.findByLabelText(/Proveedor de ingesta masiva/)) as HTMLSelectElement;
    fireEvent.change(bulk, { target: { value: 'tcgcsv_singles' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar proveedor de ingesta/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ priceProvider: 'tcgcsv_singles' }));
    spy.mockRestore();
  });

  it('M11-single-editor: M10 YA NO dibuja el dial de proveedor del SELLADO (se editan en M11)', async () => {
    renderWithProviders(<M10View />, 'es');
    await screen.findByLabelText(/Envío de un retiro \(cobro al cliente\)/);
    // §diseño §4.1 (D-2): el editor del proveedor de referencia del sellado se mudó a M11. Que
    // desaparezca aquí es parte de la norma: un solo editor por dial de dinero, no dos.
    expect(screen.queryByLabelText(/Proveedor de referencia por-carta \(sellado\)/)).not.toBeInTheDocument();
    // Pero los per-carta de raw/graded siguen aquí.
    expect(screen.getByLabelText(/Proveedor de referencia por-carta \(raw\)/)).toBeInTheDocument();
    // Y hay un deep-link a M11 para quien busque los controles del sellado aquí.
    expect(screen.getByText(/se editan ahora en «Sellado»/)).toBeInTheDocument();
  });

  /**
   * REL-S7-UX punto 2 (fusión accesorios + lista de deseos): cada dial se edita en UN solo bloque de M10.
   * Los siete `wishlist*` viven solo en `<section id="wishlist">` (con su diálogo de encendido), nunca en el
   * listado de diales de arriba; los de accesorios (§AC.11) se editan en el panel «Accesorios», no en M10.
   */
  it('REL-S7 · el listado genérico de M10 no edita ningún dial de la lista de deseos ni de accesorios', () => {
    expect(WISHLIST_DIAL_KEYS).toHaveLength(7);
    for (const k of WISHLIST_DIAL_KEYS) expect(M10_LIST_DIAL_KEYS).not.toContain(k);
    expect(M10_LIST_DIAL_KEYS.filter((k) => /^wishlist/.test(k))).toEqual([]);
    // v1.109 (§4-G.12): los tres diales del envío directo solo en «Envío a domicilio».
    expect(DIRECT_SHIP_DIAL_KEYS).toEqual(['directShipCardsFeeCents', 'directShipSealedFeeCents', 'directShipFreeFromCents']);
    for (const k of DIRECT_SHIP_DIAL_KEYS) expect(M10_LIST_DIAL_KEYS).not.toContain(k);
    for (const k of ['energyBundlePriceCents', 'accessorySuggestionCount']) {
      expect(M10_LIST_DIAL_KEYS).not.toContain(k);
    }
    // v1.113⟨portada⟩ (§DYN.3): los seis de Destacadas y PSA solo en su sección.
    expect(FEATURED_PSA_DIAL_KEYS).toHaveLength(6);
    for (const k of FEATURED_PSA_DIAL_KEYS) expect(M10_LIST_DIAL_KEYS).not.toContain(k);
  });

  it('REL-S7 · ningún dial se pinta dos veces: los de la lista de deseos solo en su sección, los de accesorios fuera de M10', async () => {
    renderWithProviders(<M10View />, 'es');
    const section = await screen.findByTestId('m10-wishlist');
    const labels = es.admin.m10.wishlist.labels;
    await within(section).findByLabelText(labels.wishlistEnabled);
    for (const label of Object.values(labels)) {
      expect(screen.getAllByLabelText(label)).toHaveLength(1);
      expect(section).toContainElement(screen.getByLabelText(label));
    }
    const acc = es.admin.accessories.settings;
    expect(screen.queryByLabelText(acc.bundlePrice)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(acc.suggestionCount)).not.toBeInTheDocument();
  });
});
