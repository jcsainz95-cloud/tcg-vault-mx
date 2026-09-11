import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { BuylistKycForm } from './BuylistKycForm';
import * as api from '@/lib/api';
import { setStoredUser } from '@/lib/session';

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:mock-ine');
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const RAW_ITEMS = [{ cardId: 'c-charizard', productType: 'raw' as const, rawCondition: 'NM' as const }];

/**
 * v1.51.3 (D36/D37): sin `addressId` el botón de crear está APAGADO. La libreta mock trae una
 * dirección predeterminada (`addr-1`), así que la UI la PRESELECCIONA — pero es asíncrono: los
 * tests esperan a que el `Select` tenga valor antes de enviar. (La preselección es comodidad de
 * pantalla; lo que este archivo verifica es que el id VIAJE EXPLÍCITO en el body.)
 */
async function pickAddress(): Promise<HTMLSelectElement> {
  const select = (await screen.findByLabelText('Dirección de origen')) as HTMLSelectElement;
  await waitFor(() => expect(select.value).toBe('addr-1'));
  return select;
}

describe('BuylistKycForm — cableado KYC/INE del buylist (contrato §6/§8)', () => {
  it('renderiza CLABE, los dos slots de INE (anverso/reverso) y el aviso de privacidad', async () => {
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    expect(screen.getByLabelText(/CLABE/)).toBeInTheDocument();
    expect(screen.getByText('INE (anverso)')).toBeInTheDocument();
    expect(screen.getByText('INE (reverso)')).toBeInTheDocument();
    expect(screen.getByText(/se guarda cifrada/)).toBeInTheDocument();
  });

  it('valida la CLABE en cliente (18 dígitos) y no llama al backend si es inválida', async () => {
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    fireEvent.change(screen.getByLabelText(/CLABE/), { target: { value: '123' } });
    await pickAddress();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    expect(screen.getByText('La CLABE debe tener 18 dígitos.')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('con CLABE válida crea la solicitud con TODOS los items del carrito y reporta el id', async () => {
    const onCreated = vi.fn();
    const spy = vi.spyOn(api, 'createSellRequest');
    // Carrito expandido por cantidad: 2 Charizard + 1 Pikachu.
    const items = [
      { cardId: 'c-charizard', productType: 'raw' as const, rawCondition: 'NM' as const },
      { cardId: 'c-charizard', productType: 'raw' as const, rawCondition: 'NM' as const },
      { cardId: 'c-pikachu', productType: 'raw' as const, rawCondition: 'NM' as const },
    ];
    renderWithProviders(<BuylistKycForm items={items} onCreated={onCreated} />, 'es');
    fireEvent.change(screen.getByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    await pickAddress();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    // El payload lleva los 3 items (sin precio/categoría; solo cardId/productType/rawCondition).
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ clabe: '002010077777777771', items }),
    );
  });

  it('mapea 422 INE_REQUIRED a la petición de subir el INE', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    vi.spyOn(api, 'createSellRequest').mockRejectedValueOnce(
      new ApiClientError(422, { code: 'INE_REQUIRED', message: 'INE required' }),
    );
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    fireEvent.change(screen.getByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    await pickAddress();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    await waitFor(() =>
      expect(screen.getAllByText(/sube tu INE/).length).toBeGreaterThan(0),
    );
  });

  it('mapea 403 EMAIL_NOT_VERIFIED al aviso accionable con CTA de reenvío (no error genérico)', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    vi.spyOn(api, 'createSellRequest').mockRejectedValueOnce(
      new ApiClientError(403, { code: 'EMAIL_NOT_VERIFIED', message: 'Email must be verified' }),
    );
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    fireEvent.change(screen.getByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    await pickAddress();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    expect(
      await screen.findByText('Verifica tu correo para completar esta acción'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reenviar correo de verificación' }),
    ).toBeInTheDocument();
  });

  it('mapea 422 BUYLIST_LIMIT_EXCEEDED usando el tope real de details.capCents', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    vi.spyOn(api, 'createSellRequest').mockRejectedValueOnce(
      new ApiClientError(422, {
        code: 'BUYLIST_LIMIT_EXCEEDED',
        message: 'cap exceeded',
        details: { scope: 'per_request', capCents: 300000, wouldBeCents: 500000 },
      }),
    );
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    fireEvent.change(screen.getByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    await pickAddress();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    expect(
      await screen.findByText(/Esta solicitud supera tu tope permitido \(MX\$3,000\.00\)/),
    ).toBeInTheDocument();
  });

  it('un código no mapeado cae al catálogo error.* del contrato (FINISH_NOT_AVAILABLE)', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    vi.spyOn(api, 'createSellRequest').mockRejectedValueOnce(
      new ApiClientError(422, { code: 'FINISH_NOT_AVAILABLE', message: 'finish not available' }),
    );
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    fireEvent.change(screen.getByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    await pickAddress();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    expect(
      await screen.findByText('Ese acabado no está disponible para esta carta.'),
    ).toBeInTheDocument();
  });
});

/**
 * Gating proactivo dentro del modal (segundo cinturón; el primero vive en BuylistView):
 * sesión sin verificar bloquea el submit ANTES del 403 y los heads-up de KYC
 * (ineExpected / clabeMasked) se muestran de entrada.
 */
describe('BuylistKycForm — gating proactivo de cuenta/KYC', () => {
  it('con sesión emailVerified=false el submit queda deshabilitado y el aviso con reenvío aparece de entrada', async () => {
    setStoredUser({
      id: 'u-777',
      email: 'ash@example.com',
      name: 'Ash Ketchum',
      role: 'customer',
      locale: 'es',
      emailVerified: false,
    });
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');

    const submit = screen.getByRole('button', { name: 'Confirmar y enviar' });
    expect(submit).toBeDisabled();
    expect(screen.getByText('Verifica tu correo para enviar tu solicitud.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reenviar correo de verificación' }),
    ).toBeInTheDocument();
    fireEvent.click(submit);
    expect(spy).not.toHaveBeenCalled();
  });

  it('ineExpected=true muestra la petición de INE de entrada (sin esperar al 422)', async () => {
    renderWithProviders(
      <BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} ineExpected />,
      'es',
    );
    expect(
      screen.getByText('Esta venta supera nuestro límite: sube tu INE (frente y reverso) para continuar.'),
    ).toBeInTheDocument();
  });

  /**
   * **P-78 · §34.8 regla 4.** Pedirle otra vez la INE **sin decirle por qué falló la anterior** es
   * pedirle que adivine. El motivo del revisor viaja literal y se lee aquí, encima de los
   * uploaders — el mismo texto que ve en «Mi cuenta».
   */
  it('con la INE rechazada, el formulario de venta muestra el MOTIVO encima de los uploaders', () => {
    renderWithProviders(
      <BuylistKycForm
        items={RAW_ITEMS}
        onCreated={() => {}}
        ineExpected
        kycStatus="rejected"
        rejectionReason="No se alcanza a leer: la foto está borrosa."
      />,
      'es',
    );
    expect(screen.getByText('No pudimos verificar tu identidad')).toBeInTheDocument();
    expect(screen.getByText('«No se alcanza a leer: la foto está borrosa.»')).toBeInTheDocument();
    // Y se le sigue pidiendo la foto: el motivo acompaña, no sustituye.
    expect(screen.getByText('INE (anverso)')).toBeInTheDocument();
  });

  it('sin rechazo previo NO se inventa ningún motivo', () => {
    renderWithProviders(
      <BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} ineExpected kycStatus="pending" />,
      'es',
    );
    expect(screen.queryByText('No pudimos verificar tu identidad')).not.toBeInTheDocument();
  });

  it('con CLABE en archivo (clabeOnFile) arranca en modo "usar mi CLABE" y permite cambiar a capturar otra', () => {
    renderWithProviders(
      <BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} clabeMasked="****1234" clabeOnFile />,
      'es',
    );
    // Por defecto se reusa la CLABE registrada: sin input de 18 dígitos.
    expect(screen.getByText('El pago irá a tu CLABE registrada (****1234).')).toBeInTheDocument();
    expect(screen.queryByLabelText(/CLABE \(18 dígitos/)).not.toBeInTheDocument();

    // "Usar otra CLABE" revela la captura, con el hint de la registrada.
    fireEvent.click(screen.getByRole('button', { name: 'Usar otra CLABE' }));
    expect(screen.getByLabelText(/CLABE \(18 dígitos/)).toBeInTheDocument();
    expect(screen.getByText(/Ya tienes una CLABE registrada \(\*\*\*\*1234\)/)).toBeInTheDocument();

    // Y se puede volver al atajo en un clic.
    fireEvent.click(screen.getByRole('button', { name: 'Usar mi CLABE ****1234' }));
    expect(screen.queryByLabelText(/CLABE \(18 dígitos/)).not.toBeInTheDocument();
  });

  it('v1.15: en modo "usar mi CLABE" envía OMITIENDO `clabe` (fallback server-side a la de archivo)', async () => {
    const onCreated = vi.fn();
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(
      <BuylistKycForm items={RAW_ITEMS} onCreated={onCreated} clabeMasked="****1234" clabeOnFile />,
      'es',
    );

    await pickAddress();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    // v1.15: la solicitud NO lleva `clabe` (el backend hace el fallback a la CLABE en archivo);
    // ya NO existe el flag de cliente `useClabeOnFile`.
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ items: RAW_ITEMS }));
    const payload = spy.mock.calls[0][0];
    expect(payload.clabe).toBeUndefined();
    expect('useClabeOnFile' in payload).toBe(false);
  });

  it('v1.15: el atajo NO depende del modo mock — con clabeOnFile=false se pide la CLABE (sin atajo)', async () => {
    renderWithProviders(
      <BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} clabeMasked="****1234" clabeOnFile={false} />,
      'es',
    );
    // Sin CLABE en archivo: se captura de una (aunque haya un `clabeMasked` de referencia),
    // y NO se ofrece el atajo "usar mi CLABE".
    expect(screen.getByLabelText(/CLABE \(18 dígitos/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Usar mi CLABE/ })).not.toBeInTheDocument();
  });

  it('v1.15: con INE en archivo (ineOnFile) OCULTA los uploaders y OMITE ineUploadKeys al enviar', async () => {
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(
      <BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} ineOnFile />,
      'es',
    );
    // No hay uploaders de INE; en su lugar, la nota de "ya en archivo".
    expect(screen.getByText('Tu INE ya está en archivo; no necesitas volver a subirlo.')).toBeInTheDocument();
    expect(screen.queryByText('INE (anverso)')).not.toBeInTheDocument();
    expect(screen.queryByText('INE (reverso)')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/CLABE/), { target: { value: '002010077777777771' } });
    await pickAddress();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    // El backend usa el INE de archivo: la solicitud no reenvía keys de INE.
    expect(spy.mock.calls[0][0].ineUploadKeys).toBeUndefined();
  });
});

/**
 * v1.51.3/v1.51.4 (D36/D37 · D43) — el paso de CREAR la solicitud:
 * dirección de origen OBLIGATORIA y explícita, la nota de servicio del envío palabra por palabra,
 * y el faltante del mínimo cuando el servidor lo dice.
 */
describe('BuylistKycForm — dirección de origen obligatoria (D36/D37) y nota del envío (D43)', () => {
  const NOTE_ES =
    'Nosotros ponemos la guía de envío y su costo se descuenta siempre de lo que te pagamos: tú no pagas nada de tu bolsillo. El monto exacto va en la oferta, antes de que aceptes.';

  it('el `addressId` viaja EXPLÍCITO en el body aunque la UI lo haya preseleccionado', async () => {
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');

    const select = await pickAddress();
    expect(select.value).toBe('addr-1');
    fireEvent.change(screen.getByLabelText(/CLABE/), { target: { value: '002010077777777771' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    // No hay fallback silencioso a la predeterminada: el id va en el body, siempre.
    expect(spy.mock.calls[0][0].addressId).toBe('addr-1');
  });

  it('sin ninguna dirección en la libreta: alta INLINE, botón APAGADO y con motivo (nunca mudo)', async () => {
    vi.spyOn(api, 'listAddresses').mockResolvedValue([]);
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');

    // El formulario de alta aparece INLINE (no un modal encima del modal).
    expect(await screen.findByLabelText('Calle y número')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Confirmar y enviar' });
    expect(submit).toBeDisabled();
    // §15.9: el botón apagado apunta al motivo y a su remedio.
    expect(submit.getAttribute('aria-describedby')).toContain('kyc-address-reason');
    expect(
      screen.getByText('La necesitamos para imprimir la guía que te vamos a mandar.'),
    ).toBeInTheDocument();
    fireEvent.click(submit);
    expect(spy).not.toHaveBeenCalled();
  });

  it('422 PICKUP_ADDRESS_NOT_FOUND se pinta INLINE en el campo (no como toast)', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    vi.spyOn(api, 'createSellRequest').mockRejectedValueOnce(
      new ApiClientError(422, {
        code: 'PICKUP_ADDRESS_NOT_FOUND',
        message: 'Pickup address not found',
        details: { field: 'addressId' },
      }),
    );
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    await pickAddress();
    fireEvent.change(screen.getByLabelText(/CLABE/), { target: { value: '002010077777777771' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    const inline = await screen.findByText(
      'Esa dirección ya no está en tu libreta. Elige otra o agrega una nueva.',
    );
    expect(inline).toHaveAttribute('role', 'alert');
  });

  it('fail-open + 422 BUYLIST_MINIMUM_NOT_MET: sin mínimo conocido el botón VIAJA y el servidor repinta', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    const spy = vi.spyOn(api, 'createSellRequest').mockRejectedValueOnce(
      new ApiClientError(422, {
        code: 'BUYLIST_MINIMUM_NOT_MET',
        message: 'below minimum',
        details: { minimumCents: 60000, totalCents: 38000, shortfallCents: 22000 },
      }),
    );
    // `minimumRequestCents` undefined = la política NO llegó (red/5xx/429). Degradación fail-OPEN:
    // no se pinta faltante, no se inventa mínimo y el botón sigue vivo — la puerta es el 422.
    renderWithProviders(
      <BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} totalEstimatedCents={38000} />,
      'es',
    );
    await pickAddress();
    fireEvent.change(screen.getByLabelText(/CLABE/), { target: { value: '002010077777777771' } });
    expect(screen.queryByTestId('buylist-minimum-shortfall')).not.toBeInTheDocument();

    const submit = screen.getByRole('button', { name: 'Confirmar y enviar' });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    // La puerta habló: se repinta con SUS números (MX$220 faltantes de un mínimo de MX$600),
    // no con los del cliente, y el botón queda apagado apuntando al motivo.
    const shortfall = await screen.findByTestId('buylist-minimum-shortfall');
    expect(shortfall).toHaveTextContent('Te faltan MX$220.00');
    expect(shortfall).toHaveTextContent('MX$600.00');
    expect(screen.getByRole('button', { name: 'Confirmar y enviar' })).toBeDisabled();
  });

  it('el faltante PREVENTIVO (mínimo del cotizador − total) apaga el botón antes de viajar', async () => {
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(
      <BuylistKycForm
        items={RAW_ITEMS}
        onCreated={() => {}}
        minimumRequestCents={50000}
        totalEstimatedCents={38000}
      />,
      'es',
    );
    await pickAddress();
    expect(screen.getByText(/Te faltan MX\$120\.00/)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Confirmar y enviar' });
    expect(submit).toBeDisabled();
    expect(submit.getAttribute('aria-describedby')).toContain('kyc-minimum-reason');
    expect(spy).not.toHaveBeenCalled();
  });

  it('la nota de servicio del envío aparece ANTES del botón, palabra por palabra y sin cifras', async () => {
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    const note = await screen.findByTestId('buylist-shipping-note');
    expect(note).toHaveTextContent(NOTE_ES);
    // Ni un solo monto de envío en el paso de crear (D43).
    expect(note.textContent).not.toMatch(/MX\$|%|≈/);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────────────
 * EL RECHAZO TIENE QUE LLEGAR A LOS OJOS DEL VENDEDOR (patrón P-4, DESIGN_SYSTEM §16.4.3b)
 *
 * Defecto reportado en producción: *«cuando confirmas enviar solicitud no desaparece el pop up,
 * pueden dar click varias veces»*, sin duplicar la solicitud y sin mensaje. Medido en el
 * navegador (390×844 y 1280×800): el diálogo tiene 1207 px de contenido en 759 px visibles, así
 * que **para pulsar el botón hay que desplazarse hasta abajo**, y ahí el bloque de la CLABE queda
 * en `y=-183` y el de la dirección en `y=-64` — **fuera de la pantalla**. El mensaje existía; no
 * se veía. Y en modo «usar mi CLABE en archivo» ni siquiera existía: el campo que lo renderiza no
 * está montado (medido: cero `role="alert"` en todo el documento).
 *
 * Estos candados NO miran «se llamó a scrollIntoView»: exigen que **el elemento que se trae al
 * viewport y recibe el foco sea el que CONTIENE el motivo**. Un arreglo que desplace la pantalla
 * a un sitio equivocado sigue siendo mudo, y aquí se pone rojo.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */
describe('BuylistKycForm — ningún intento fallido puede quedarse mudo (P-4)', () => {
  /** jsdom no implementa scrollIntoView: se instala un espía que además guarda el `this`. */
  function spyOnReveal() {
    const targets: Element[] = [];
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: function scrollIntoView(this: Element) {
        targets.push(this);
      },
    });
    return targets;
  }

  /** El nodo traído al viewport (y el enfocado) tiene que CONTENER el motivo del rechazo. */
  function expectRevealed(targets: Element[], message: string) {
    const last = targets[targets.length - 1];
    expect(last, 'ningún elemento se trajo al viewport tras el fallo').toBeTruthy();
    expect(last.textContent, 'el elemento traído al viewport no contiene el motivo').toContain(
      message,
    );
    const focused = document.activeElement as HTMLElement | null;
    expect(focused, 'nadie recibió el foco tras el fallo').toBeTruthy();
    // El foco cae en el ancla o dentro de ella (p. ej. el <input> de la CLABE).
    const holder = focused && (focused.contains(last) || last.contains(focused) ? last : null);
    expect(holder?.textContent, 'el foco no quedó en el bloque del motivo').toContain(message);
  }

  async function fillAndSubmit(clabe = '002010077777777771') {
    const input = screen.queryByLabelText(/CLABE/);
    if (input && clabe) fireEvent.change(input, { target: { value: clabe } });
    await pickAddress();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));
  }

  it('CLABE inválida (rechazo de CLIENTE, ni siquiera viaja): el campo se trae al viewport con foco', async () => {
    const targets = spyOnReveal();
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    await fillAndSubmit('123');

    await waitFor(() => expect(targets.length).toBeGreaterThan(0));
    expectRevealed(targets, 'La CLABE debe tener 18 dígitos.');
  });

  it('el SEGUNDO intento fallido idéntico vuelve a traer el motivo (el usuario pulsa varias veces)', async () => {
    const targets = spyOnReveal();
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    await fillAndSubmit('123');
    await waitFor(() => expect(targets.length).toBe(1));

    // Mismo fallo, mismo estado: un guard booleano (`isError`) no volvería a disparar y la
    // pantalla se quedaría quieta — que es EXACTAMENTE lo que reportó el dueño.
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));
    await waitFor(() => expect(targets.length).toBe(2));
    expectRevealed(targets, 'La CLABE debe tener 18 dígitos.');
  });

  it('CLABE_NOT_OWN_NAME en modo «usar mi CLABE en archivo»: el mensaje EXISTE y se trae al viewport', async () => {
    // Antes: el estado se guardaba y el campo que lo pinta no estaba montado ⇒ cero mensajes.
    const { ApiClientError } = await import('@/lib/api-client');
    vi.spyOn(api, 'createSellRequest').mockRejectedValueOnce(
      new ApiClientError(422, { code: 'CLABE_NOT_OWN_NAME', message: 'not own name' }),
    );
    const targets = spyOnReveal();
    renderWithProviders(
      <BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} clabeOnFile clabeMasked="****1234" />,
      'es',
    );
    // En este modo NO hay campo de CLABE: se envía omitiéndola (atajo de archivo).
    expect(screen.queryByLabelText(/CLABE/)).toBeNull();
    await pickAddress();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    const msg = await screen.findByText('La CLABE debe estar a nombre del titular de la cuenta.');
    expect(msg).toBeInTheDocument();
    expectRevealed(targets, 'La CLABE debe estar a nombre del titular de la cuenta.');
  });

  it('PHONE_REQUIRED (PUERTA 1, D11): lo dice EN ESPAÑOL y ofrece capturar el celular aquí mismo', async () => {
    // Antes: sin clave en el catálogo, `getErrorMessage` caía al inglés crudo del servidor
    // («A mobile phone is required…») y la app no tenía NINGUNA pantalla para capturar el dato.
    const { ApiClientError } = await import('@/lib/api-client');
    vi.spyOn(api, 'createSellRequest').mockRejectedValueOnce(
      new ApiClientError(422, {
        code: 'PHONE_REQUIRED',
        message: 'A mobile phone is required on the account to create a sell request',
        details: { field: 'phone' },
      }),
    );
    const updateSpy = vi.spyOn(api, 'updateMe');
    const targets = spyOnReveal();
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    await fillAndSubmit();

    const field = await screen.findByLabelText('Celular (10 dígitos)');
    // El motivo, en español y del catálogo del contrato — jamás el inglés del servidor.
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Falta el celular en la cuenta. La paquetería lo necesita para entregar la guía y avisarte de la recolección.',
    );
    expect(screen.queryByText(/A mobile phone is required/)).toBeNull();
    expectRevealed(targets, 'Falta el celular en la cuenta.');

    // Y el remedio funciona sin salir del flujo: PATCH /users/me con el celular capturado.
    fireEvent.change(field, { target: { value: '5555123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar celular' }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith({ phone: '5555123456' }));
  });

  it('422 de dirección: el motivo inline se trae al viewport (el campo queda 60px sobre el borde)', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    vi.spyOn(api, 'createSellRequest').mockRejectedValueOnce(
      new ApiClientError(422, { code: 'PICKUP_ADDRESS_NOT_FOUND', message: 'not found' }),
    );
    const targets = spyOnReveal();
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    await fillAndSubmit();

    const msg = await screen.findByText(
      'Esa dirección ya no está en tu libreta. Elige otra o agrega una nueva.',
    );
    expect(msg).toBeInTheDocument();
    expectRevealed(targets, 'Esa dirección ya no está en tu libreta.');
  });

  it('fallo de red (sin código de contrato): tampoco se queda mudo — banner genérico anclado', async () => {
    vi.spyOn(api, 'createSellRequest').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const targets = spyOnReveal();
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    await fillAndSubmit();

    expect(await screen.findByText('Error del servidor. Intenta de nuevo.')).toBeInTheDocument();
    expectRevealed(targets, 'Error del servidor. Intenta de nuevo.');
  });
});
