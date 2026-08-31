import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { mockSettings } from '@/lib/mock/fixtures';
import { M10View } from './M10View';

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
    const shipping = (await screen.findByLabelText(/Tarifa de envío/)) as HTMLInputElement;
    expect(shipping.value).toBe('175');
  });

  it('habilita guardar solo tras editar un dial (PUT parcial)', async () => {
    renderWithProviders(<M10View />, 'es');
    const shipping = (await screen.findByLabelText(/Tarifa de envío/)) as HTMLInputElement;
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

  it('ya NO muestra los diales dedup de dinero (salesMarkupPct / fxBufferPct)', async () => {
    renderWithProviders(<M10View />, 'es');
    // Espera a que carguen los diales.
    await screen.findByLabelText(/Tarifa de envío/);
    // salesMarkupPct (dial MUERTO) y fxBufferPct (duplicado de M2 §3 FX) se quitaron del UI.
    expect(screen.queryByLabelText(/Markup de venta/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Colchón FX/)).not.toBeInTheDocument();
  });

  /**
   * D2 (techlead): sin este dial en la UI, encender la feature exigía `curl` — y el criterio 110(e)
   * pide «desde el back-office, sin redeploy, auditado». El PUT parcial de M10 ya es auditado.
   * v1.51 (M-46): el dial es UNO SOLO y su etiqueta carga LAS DOS consecuencias (§22.13g).
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
   * que gasta créditos de un proveedor de paga. Y la cifra sale del tope VIVO de M2, no horneada.
   *
   * **v2.4 — por qué esta aserción ya no fija la cifra a secas.** Hasta hoy este test exigía
   * `/1[.,\s]?000 créditos al día/`: un número **desnudo**. Ese número es el techo **bajo el
   * supuesto de que el proveedor cobra por petición**, y la petición manda `fetchAllInSet=true`
   * —pide el **set entero**—, así que puede quedarse corto por un **factor de 16** (§22.13d.1).
   * Fijarlo así no verificaba la verdad del aviso: **la protegía al revés**, convirtiendo una
   * hipótesis en un invariante de CI que rechazaba la corrección. La aserción nueva exige la
   * **frase condicional completa** —cifra + régimen de facturación + que la primera corrida lo
   * mide—, así que un copy que vuelva a afirmar la cifra sin supuesto **no pasa**.
   */
  it('v1.51 · al encenderlo el aviso dice que PUBLICA y que GASTA, con el techo de créditos CALIFICADO', async () => {
    const spy = withHookSavedOff();
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
    // 250 cartas × 2 créditos × 2 corridas = 1 000 créditos/día, derivado del `ingestMaxCardsPerRun`
    // VIVO de M2: la cifra llega con la config, así que se espera a ella (si estuviera horneada,
    // aparecería en el primer render y este `waitFor` no probaría nada).
    //
    // §22.13(k.m): se exige LA FRASE ENTERA, en orden. La cifra sola no basta — tiene que venir con
    // el régimen que la hace válida («si cobra por petición»), con el que la invalida («si cobra por
    // carta devuelta» + «set entero» + «varias veces») y con quién lo dirime («La primera corrida lo
    // mide»). Un copy que diga «hasta 1 000 créditos al día» y nada más falla aquí.
    await waitFor(() =>
      expect(warning.textContent).toMatch(
        /si cobra por petición, el techo son\s*1[.,\s]?000 créditos al día[\s\S]*?si cobra por carta devuelta[\s\S]*?set entero[\s\S]*?varias veces[\s\S]*?La primera corrida lo mide/,
      ),
    );
    // Y el alcance, que sí sabemos, separado de la factura, que no: el tope acota CARTAS TUYAS.
    expect(warning.textContent).toMatch(/el barrido mira hasta\s*250 cartas tuyas/);
    expect(warning.textContent).toMatch(/2 corridas al día/);
    // La cuenta sigue derivándose del tope vivo (§22.13k.g): 250 × 2 × 2, no un literal.
    expect(warning.textContent).toMatch(/250 × 2 × 2/);
    // (k.l) — INVARIANTE, no una frase suelta: NINGUNA oración que mencione «créditos al día» puede
    // hacerlo sin su calificador en la MISMA oración. Es lo que impide que el candado vuelva a
    // moverse cambiando un número por otro, o colando la cifra desnuda en otro párrafo.
    const oraciones = warning.textContent!.split(/(?<=\.)\s+/);
    const conCifra = oraciones.filter((o) => /créditos al día/.test(o));
    expect(conCifra.length).toBeGreaterThan(0);
    for (const oracion of conCifra) {
      expect(oracion).toMatch(/si cobra por petición|ya está medido|medida el/);
    }
    // §7.6: la acción de dinero declara quién puede y dónde queda.
    expect(warning.textContent).toMatch(/Solo súper-admin · queda en bitácora/);
    expect(warning.textContent).toMatch(/No cambia ningún precio de venta/i);
    // Y se guarda como un dial más: PUT parcial auditado, sin redeploy.
    expect(screen.getByRole('button', { name: /Guardar 1/ })).toBeEnabled();
  });

  /**
   * §22.13(d) + (h) — «cede la cifra, nunca el aviso». Si la config de M2 no está disponible, el
   * aviso NO desaparece: cae a `onNoFigures`. Ocultar el aviso por falta de un número sería
   * exactamente el bloqueante que §22.13(k.f) manda buscar.
   *
   * **v2.4 — esta variante también mentía, y por eso el `not.toMatch` de abajo no basta solo.**
   * Decía «consume créditos en cada corrida, **hasta el tope de cartas que fijaste en M2**»:
   * insinuaba que ese tope acota el GASTO. No lo acota — acota las cartas **en alcance**, y cada
   * petición pide el set entero (§22.13k.f, «y ese texto no insinúa que el tope acote el gasto»).
   * Que no aparezca una cifra es necesario pero no suficiente; se exige además que diga QUÉ acota
   * el tope y qué no.
   */
  it('v1.51 · si el tope de M2 no está disponible, el aviso de encendido SIGUE saliendo (sin la cifra)', async () => {
    const settingsSpy = withHookSavedOff();
    const spy = vi
      .spyOn(api, 'getGradedEstimateConfig')
      .mockRejectedValue(new Error('403 FORBIDDEN'));
    renderWithProviders(<M10View />, 'es');
    const dial = (await screen.findByLabelText(/Gancho de grading/)) as HTMLSelectElement;
    fireEvent.change(dial, { target: { value: 'on' } });

    const warning = await screen.findByRole('alert');
    settingsSpy.mockRestore();
    expect(warning.textContent).toMatch(/Publica\./);
    expect(warning.textContent).toMatch(/Y gasta\./);
    expect(warning.textContent).toMatch(/consume créditos en cada corrida/i);
    // Sin tope no hay cuenta que publicar: ni el techo diario ni la multiplicación que lo produce.
    expect(warning.textContent).not.toMatch(/créditos al día/);
    expect(warning.textContent).not.toMatch(/\d\s*×\s*\d/);
    // Lo que SÍ tiene que decir: el tope acota cartas MIRADAS, no lo que el proveedor factura.
    expect(warning.textContent).toMatch(/cuántas cartas tuyas mira/i);
    expect(warning.textContent).toMatch(/no cuántas te cobra el proveedor/i);
    expect(warning.textContent).toMatch(/cada petición pide el set entero/i);
    expect(warning.textContent).toMatch(/lo mide la primera corrida/i);
    spy.mockRestore();
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
   */
  it('v1.51 · con el dial guardado en `on`, el aviso persiste como `status` (no `alert`)', async () => {
    renderWithProviders(<M10View />, 'es');
    await screen.findByLabelText(/Gancho de grading/);
    const reminder = await screen.findByText(/Y gasta\./);
    const banner = reminder.closest('[role="status"]') as HTMLElement;
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
});
