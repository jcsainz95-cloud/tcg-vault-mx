/**
 * §BUYLIST-FLUJO F2 — correos C1 («Tus cartas te esperan») y C2 («No llegó»), es/en. Datos ficticios.
 * Candados: el texto del contrato (anexo §4), sin recoger/plazos en C2, direccion de la tienda solo si existe, y ⛔ ni CLABE ni
 * domicilio del vendedor en ninguno de los dos.
 */
import { sellItemNotReceivedTemplate, sellItemsPickupTemplate, PickupCardLine } from '../src/modules/buylist/buylist-flujo-mail.templates';

const CARD = { cardName: 'Charizard', setName: 'Base Set', cardNumber: '4/102', finish: 'holofoil' as const };
const R = new Date('2026-11-23T12:00:00Z');
const base = {
  folio: 'SR-FICTICIO-1',
  storeAddress: 'Verapaz 123, Pedregal, CP 14210, Tlalpan, Ciudad de México',
  portalUrl: 'https://tienda.ejemplo.test/es/buylist/requests/SR-FICTICIO-1',
  returnDeadlineAt: new Date(R.getTime() + 7 * 864e5),
  abandonDeadlineAt: new Date(R.getTime() + 30 * 864e5),
  responseDays: 7,
  requestClosed: false,
};
const line = (o: Partial<PickupCardLine>): PickupCardLine => ({ ...CARD, cause: 'other', note: 'nota del dueño', ...o });

describe('C1 sellItemsPickupTemplate', () => {
  it('es: causa por linea + bloque recoger con direccion, enlace y las dos fechas', () => {
    const m = sellItemsPickupTemplate(
      {
        ...base,
        cards: [
          line({ cause: 'condition_mismatch', declaredCondition: 'NM' }),
          line({ cause: 'wrong_card', note: 'un Blastoise' }),
          line({ cause: 'other', note: 'viene con otro idioma' }),
          line({ cause: 'revision_declined', proposedCents: 45000, offeredCents: 60000 }),
          line({ cause: 'revision_expired', proposedCents: 45000, offeredCents: 60000 }),
        ],
      },
      'Ash',
      'es',
    );
    expect(m.subject).toBe('Tus 5 cartas te esperan');
    for (const t of [
      'llegó en una condición distinta a la que declaraste (NM), por eso no la incluimos en el pago.',
      'En lugar de Charizard (Base Set · #4/102) venía otra carta (un Blastoise), por eso no la incluimos en el pago.',
      'Charizard (Base Set · #4/102): viene con otro idioma',
      'No llegamos a un acuerdo en el precio de Charizard (Base Set · #4/102) (nuestra propuesta: $450.00; tu oferta original: $600.00).',
      'No recibimos tu respuesta a la propuesta de $450.00 por Charizard (Base Set · #4/102) en 7 días, así que no la compramos.',
      'Puedes pasar por ellas a Verapaz 123, Pedregal, CP 14210, Tlalpan, Ciudad de México sin costo (responde este correo y acordamos día y hora) o pedir que te las enviemos a tu cargo.',
      'Elige aquí: https://tienda.ejemplo.test/es/buylist/requests/SR-FICTICIO-1.',
    ]) {
      expect(m.text.replace(/ /g, ' ')).toContain(t);
    }
    expect(m.text).toMatch(/Tienes hasta el .* para elegir y hasta el .* para recogerlas; pasada esa fecha se consideran abandonadas\./);
    expect(m.html).toContain('Verapaz 123');
  });

  it('sin direccion de la tienda: «te confirmaremos la dirección al responder»; sin enlace: «Elige respondiendo este correo»', () => {
    const m = sellItemsPickupTemplate({ ...base, storeAddress: null, portalUrl: undefined, cards: [line({})] }, 'Ash', 'es');
    expect(m.text).toContain('te confirmaremos la dirección al responder');
    expect(m.text).toContain('Elige respondiendo este correo.');
    expect(m.text).not.toContain('Elige aquí');
    expect(m.subject).toBe('Tu carta te espera');
  });

  it('en: ingles completo y solicitud cerrada dice que no hay pago', () => {
    const m = sellItemsPickupTemplate({ ...base, requestClosed: true, cards: [line({ cause: 'wrong_card', note: null })] }, 'Ash', 'en');
    expect(m.subject).toBe('Your card is waiting for you');
    expect(m.text).toContain('at no cost (reply to this email');
    expect(m.text).toContain('your request is closed and there is no payment');
    expect(m.text).not.toMatch(/Hola|Puedes pasar/);
  });

  it('⛔ nunca la CLABE ni el domicilio del vendedor', () => {
    const m = sellItemsPickupTemplate({ ...base, cards: [line({})] }, 'Ash', 'es');
    expect(m.text + m.html).not.toMatch(/\b\d{18}\b/);
  });
});

describe('C2 sellItemNotReceivedTemplate', () => {
  it('es: texto del contrato; SIN plazos ni recoger ni promesa de devolucion', () => {
    const m = sellItemNotReceivedTemplate({ folio: 'SR-1', card: CARD, requestClosed: false, hasShippingFee: true }, 'Ash', 'es');
    expect(m.subject).toBe('Una carta de tu solicitud de venta no llegó');
    expect(m.text).toContain('Revisamos tu paquete (solicitud SR-1) y Charizard (Base Set · #4/102) no venía dentro.');
    expect(m.text).toContain('No la incluimos en el pago: se te deposita el resto, menos el envío que aceptaste.');
    expect(m.text).toContain('Como no la recibimos, no tenemos nada que devolverte.');
    expect(m.text).toContain('Si crees que sí la mandaste, responde este correo con tu guía.');
    expect(m.text).not.toMatch(/recog|pasar por|abandon|hasta el|plazo|devolución/i);
  });

  it('sin envio anunciado no promete un descuento; cerrada => no hay pago; en => ingles', () => {
    expect(sellItemNotReceivedTemplate({ folio: 'SR-1', card: CARD, requestClosed: false, hasShippingFee: false }, 'Ash', 'es').text).not.toContain('menos el envío');
    expect(sellItemNotReceivedTemplate({ folio: 'SR-1', card: CARD, requestClosed: true, hasShippingFee: true }, 'Ash', 'es').text).toContain('no hay pago');
    const en = sellItemNotReceivedTemplate({ folio: 'SR-1', card: CARD, requestClosed: false, hasShippingFee: true }, 'Ash', 'en');
    expect(en.text).toContain('was not inside');
    expect(en.text).toContain('we have nothing to return to you');
  });
});
