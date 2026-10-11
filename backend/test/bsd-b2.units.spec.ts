/**
 * bsd-b2.units.spec.ts — 💰 rev BSD-1, paso B-2 (API_CONTRACT §BSD.3, §BSD.4.1, §BSD.4.4, §BSD.8.2; erratas BSD-1.1 C-1/C-6
 * y BSD-1.3 puntos 2 y 5): las piezas PURAS de la guía de ENTRADA. Lo que necesita BD, candados o carreras vive en
 * `test/integration/bsd-b2-inbound.e2e-spec.ts`.
 *
 * | Bloque | Qué afirma (ID del contrato) | Mutación que lo pone rojo |
 * |---|---|---|
 * | política | `OPEN_FOR_LABEL_STATUS`/`LABELED_STATUS`/`openForLabelWhere()` por clase; `adminKindOf` (BSD-1.3 p. 2/5) | entrada ⇒ `picking` |
 * | BSD-B4 (puro) | la copia del domicilio: claves EXACTAS, ⛔ `addressId`, `recipientName` ausente si falta; cuerpo `{}` | copiar el objeto entero |
 * | BSD-B5 (puro) | `from` = vendedor neutralizado, `to` = la tienda; lo cobrado = tarifa; asegurado = bruto; empaque sellado/graded | `to` desde el snapshot |
 * | BSD-B6 (puro) | `to`/`destination`/`addressTo`/`address_to` ⇒ `400 destination_not_editable` en los tres cuerpos | quitar una clave de la lista |
 * | adaptador | `address_from` explícito (cotizar y comprar) y `address_to` con CP en la compra de entrada; salida sin cambio | perder `postal_code` |
 * | AV-7 | variantes M (sin cambio), S, S0, +R (§BSD.8.2, BSD-UX.2) | quitar la línea de sustitución |
 * | `MailMessage.attachments` | Resend los pasa; Noop los ignora | Resend sin `attachments` |
 * | C-1 / C-6 | `labelPdfAvailableOf`, `sellerCarrierLabelOf`, `sellerLabelFilenameOf` | `labelPdfAvailable` sin mirar `aceptada` |
 */
import { BusinessException } from '../src/common/business.exception';
import {
  INBOUND_ADMIN_KIND,
  LABELED_STATUS,
  OPEN_FOR_LABEL_STATUS,
  adminKindOf,
  labelSubjectOf,
  openForLabelWhere,
} from '../src/modules/shipments/label-subject';
import {
  INBOUND_SNAPSHOT_KEYS,
  assertInboundOpenForLabel,
  inboundAddressSnapshotOf,
  inboundChargedOf,
  inboundGuideBlock,
  inboundInsuredValueCents,
  inboundPackageLines,
  inboundPurchaseAddresses,
  inboundQuoteAddresses,
  labelPdfAvailableOf,
  rejectDestinationKeys,
  sellerCarrierLabelOf,
  sellerLabelFilenameOf,
  storeDestinationOf,
} from '../src/modules/shipments/label-inbound';
import { parseInboundShipmentBody } from '../src/modules/shipments/inbound-shipment.service';
import { parseQuoteBody } from '../src/modules/shipments/label-quote.service';
import { parseLabelBody } from '../src/modules/shipments/label-purchase.service';
import { parseCorrectAddressBody } from '../src/modules/shipments/shipment-address.service';
import { buildPurchaseBody, buildQuotationBody } from '../src/modules/shipping-provider/skydropx.adapter';
import { PurchaseInput, QuoteInput } from '../src/modules/shipping-provider/shipping-provider.port';
import { sellGuideTemplate } from '../src/modules/buylist/buylist-notice.templates';
import { ResendMailAdapter } from '../src/modules/mail/resend-mail.adapter';
import { NoopMailAdapter } from '../src/modules/mail/noop-mail.adapter';

const errOf = (fn: () => unknown): { status: number; code: string; details: unknown } | null => {
  try {
    fn();
    return null;
  } catch (e) {
    if (!(e instanceof BusinessException)) throw e;
    return { status: e.getStatus(), code: e.code, details: e.details };
  }
};

/** La tienda (`skydropx_origin_snapshot`) completa. */
const STORE = {
  name: 'TCG HUNT',
  company: 'TCG HUNT SA',
  street1: 'Verapaz 123',
  postalCode: '14210',
  areaLevel1: 'Ciudad de México',
  areaLevel2: 'Tlalpan',
  areaLevel3: 'Pedregal',
  phone: '5511112222',
  email: 'tienda@tcghunt.mx',
  reference: 'Portón gris',
};

/** El domicilio de recolección del vendedor, con un `addressId` que ⛔ no debe viajar y un folio forjado en la colonia. */
const PICKUP = {
  addressId: 'addr-1',
  recipientName: 'Vendedora Pérez',
  line1: 'Calle Uno 1',
  line2: 'Depto 2',
  neighborhood: 'Centro ENV-000123',
  city: 'Puebla',
  state: 'Puebla',
  postalCode: '72000',
  country: 'MX',
  phone: '2221234567',
  references: 'Casa azul',
  isDefault: true,
};

describe('💰 BSD-1.3 punto 5 — estados por clase en `label-subject.ts`', () => {
  it('«abierta sin guía»: salida `picking`, entrada `solicitado`; tras la guía `guia` en las dos', () => {
    expect(OPEN_FOR_LABEL_STATUS).toEqual({ outbound: 'picking', buylist_inbound: 'solicitado' });
    expect(LABELED_STATUS).toEqual({ outbound: 'guia', buylist_inbound: 'guia' });
  });

  it('`openForLabelWhere()` es el OR de las dos clases (lo usa el job de «en proceso», `all_kinds`)', () => {
    expect(openForLabelWhere()).toEqual({
      OR: [
        { kind: 'outbound', status: 'picking' },
        { kind: 'buylist_inbound', status: 'solicitado' },
      ],
    });
  });

  it('la política de la entrada: sin preparación, la más barata a domicilio, re-emisión a `solicitado`', () => {
    const inb = labelSubjectOf({ kind: 'buylist_inbound', sellRequestId: 'sr-1' });
    expect({ open: inb.openStatus, reissue: inb.reissueStatus, prep: inb.requiresPreparation, rec: inb.recommendation, notice: inb.labelNotice }).toEqual({
      open: 'solicitado',
      reissue: 'solicitado',
      prep: false,
      rec: 'cheapest_home',
      notice: 'AV-7',
    });
    const out = labelSubjectOf({ kind: 'outbound', sellRequestId: null });
    expect({ open: out.openStatus, reissue: out.reissueStatus, prep: out.requiresPreparation, rec: out.recommendation }).toEqual({
      open: 'picking',
      reissue: 'picking',
      prep: true,
      rec: 'preferred_then_cheapest_home',
    });
  });

  it('BSD-1.3 punto 2 — `AdminShipmentDTO.kind`: la entrada ⇒ `buylist_inbound` (sin llamar a la derivación de salida)', () => {
    const outbound = jest.fn(() => 'vault_withdrawal' as const);
    expect(adminKindOf({ kind: 'buylist_inbound' }, outbound)).toBe('buylist_inbound');
    expect(outbound).not.toHaveBeenCalled();
    expect(adminKindOf({ kind: 'outbound' }, outbound)).toBe('vault_withdrawal');
    expect(INBOUND_ADMIN_KIND).toBe('buylist_inbound');
  });
});

describe('💰 BSD-B4 (puro) — la fila de entrada copia el domicilio con las claves EXACTAS de §BSD.4.1', () => {
  it('copia campo por campo, ⛔ sin `addressId` ni claves ajenas', () => {
    const snap = inboundAddressSnapshotOf(PICKUP);
    expect(Object.keys(snap).sort()).toEqual([...INBOUND_SNAPSHOT_KEYS].sort());
    for (const k of INBOUND_SNAPSHOT_KEYS) expect(snap[k]).toBe((PICKUP as Record<string, unknown>)[k]);
    expect(snap).not.toHaveProperty('addressId');
    expect(snap).not.toHaveProperty('isDefault');
  });

  it('`recipientName` y `references` AUSENTES si la copia no los trae (la ventana pide el nombre)', () => {
    const { recipientName: _r, references: _f, ...legacy } = PICKUP;
    const snap = inboundAddressSnapshotOf(legacy);
    expect(snap).not.toHaveProperty('recipientName');
    expect(snap).not.toHaveProperty('references');
    expect(snap.line1).toBe('Calle Uno 1');
  });

  it('el cuerpo es `{}`: cualquier clave ⇒ `400 VALIDATION_ERROR {field}`; sin cuerpo ⇒ ok', () => {
    expect(errOf(() => parseInboundShipmentBody(undefined))).toBeNull();
    expect(errOf(() => parseInboundShipmentBody({}))).toBeNull();
    expect(errOf(() => parseInboundShipmentBody({ addressSnapshot: {} }))).toEqual({ status: 400, code: 'VALIDATION_ERROR', details: { field: 'addressSnapshot' } });
  });
});

describe('💰 BSD-B5 (puro) — direcciones, dinero y empaque de la guía de entrada (§BSD.3)', () => {
  const store = storeDestinationOf(STORE);

  it('cotizar: `from` = el VENDEDOR por áreas (neutralizado: ⛔ folio forjable), `to` = la TIENDA', () => {
    const a = inboundQuoteAddresses(inboundAddressSnapshotOf(PICKUP), store);
    expect(a.from).toEqual({ address: { countryCode: 'MX', postalCode: '72000', state: 'Puebla', city: 'Puebla', neighborhood: 'Centro ENV 000123' } });
    expect(a.to).toEqual({ countryCode: 'MX', postalCode: '14210', state: 'Ciudad de México', city: 'Tlalpan', neighborhood: 'Pedregal' });
  });

  it('comprar: `from` = vendedor explícito con el correo de la TIENDA (⛔ el del vendedor); `to` = tienda con el folio', () => {
    const a = inboundPurchaseAddresses(inboundAddressSnapshotOf(PICKUP), store, 'ENV-000045-01');
    expect(a.from).toEqual({
      address: {
        street1: 'Calle Uno 1 Depto 2',
        name: 'Vendedora Pérez',
        company: 'Vendedora Pérez',
        phone: '2221234567',
        email: 'tienda@tcghunt.mx',
        furtherInformation: 'Casa azul',
        postalCode: '72000',
        areaLevel1: 'Puebla',
        areaLevel2: 'Puebla',
        areaLevel3: 'Centro ENV 000123',
      },
    });
    expect(a.to).toEqual({
      street1: 'Verapaz 123',
      name: 'TCG HUNT',
      company: 'TCG HUNT SA',
      phone: '5511112222',
      email: 'tienda@tcghunt.mx',
      reference: 'Pedido ENV-000045-01',
      furtherInformation: 'Portón gris',
      postalCode: '14210',
      areaLevel1: 'Ciudad de México',
      areaLevel2: 'Tlalpan',
      areaLevel3: 'Pedregal',
    });
  });

  it('la tienda incompleta ⇒ `409 SHIPPING_PROVIDER_NOT_CONFIGURED {missing:[origin_snapshot]}`', () => {
    for (const k of ['postalCode', 'areaLevel1', 'areaLevel2', 'areaLevel3', 'street1', 'name', 'phone', 'email'] as const) {
      const e = errOf(() => storeDestinationOf({ ...STORE, [k]: null }));
      expect({ k, e }).toEqual({ k, e: { status: 409, code: 'SHIPPING_PROVIDER_NOT_CONFIGURED', details: { missing: ['origin_snapshot'] } } });
    }
    expect(errOf(() => storeDestinationOf(null))?.code).toBe('SHIPPING_PROVIDER_NOT_CONFIGURED');
  });

  it('lo cobrado = la tarifa congelada (bruto = neto); asegurado = `offerGrossCents`', () => {
    expect(inboundChargedOf({ offerShippingFeeCents: 18000, offerGrossCents: 150000 })).toEqual({ grossCents: 18000, netCents: 18000 });
    expect(inboundInsuredValueCents({ offerShippingFeeCents: 18000, offerGrossCents: 150000 })).toBe(150000);
  });

  it('empaque: solo líneas `buy`; `sealed` y `graded` cuentan como sellado', () => {
    const lines = inboundPackageLines([
      { id: 'a', offerDecision: 'buy', productType: 'raw', offeredPriceCents: 100 },
      { id: 'b', offerDecision: 'reject', productType: 'sealed', offeredPriceCents: 100 },
      { id: 'c', offerDecision: 'buy', productType: 'graded', offeredPriceCents: 200 },
      { id: 'd', offerDecision: null, productType: 'raw', offeredPriceCents: null },
    ]);
    expect(lines).toEqual([
      { inventoryItemId: 'a', sealed: false, paidCents: 100 },
      { inventoryItemId: 'c', sealed: true, paidCents: 200 },
    ]);
  });

  it('la guarda de la solicitud, en el orden de §BSD.4.1 (estado ⇒ cierre ⇒ «ya lo mandé» ⇒ confirmado ⇒ manual ⇒ fila)', () => {
    const ok = { status: 'aceptada', closedAt: null, shipmentTrackingNumber: null, sellerShippedDeclaredAt: null, shipmentConfirmedAt: null };
    const row = { status: 'solicitado', labelSource: null, trackingNumber: null };
    expect(inboundGuideBlock(ok)).toBeNull();
    expect(errOf(() => assertInboundOpenForLabel(row, { ...ok, status: 'en_transito' }, 'solicitado'))).toEqual({ status: 409, code: 'GUIDE_NOT_ALLOWED', details: { status: 'en_transito', reason: 'status' } });
    expect(errOf(() => assertInboundOpenForLabel(row, { ...ok, closedAt: new Date() }, 'solicitado'))?.details).toEqual({ status: 'aceptada', reason: 'closed' });
    expect(errOf(() => assertInboundOpenForLabel(row, { ...ok, sellerShippedDeclaredAt: new Date() }, 'solicitado'))?.details).toEqual({ status: 'aceptada', reason: 'seller_declared_shipped' });
    expect(errOf(() => assertInboundOpenForLabel(row, { ...ok, shipmentTrackingNumber: 'MAN1' }, 'solicitado'))).toEqual({ status: 409, code: 'SHIPMENT_ALREADY_LABELED', details: { labelSource: 'manual' } });
    expect(errOf(() => assertInboundOpenForLabel({ ...row, labelSource: 'skydropx', trackingNumber: 'X' }, { ...ok, shipmentTrackingNumber: 'X' }, 'solicitado'))?.details).toEqual({ labelSource: 'skydropx' });
    expect(errOf(() => assertInboundOpenForLabel({ ...row, status: 'cancelado' }, ok, 'solicitado'))?.details).toEqual({ status: 'cancelado', reason: 'status' });
    expect(errOf(() => assertInboundOpenForLabel(row, ok, 'solicitado'))).toBeNull();
  });
});

describe('💰 BSD-B6 (puro) — ⛔ el destino no viaja en el cuerpo (criterio 532)', () => {
  const VALID_LABEL = { quoteId: 'q', rateId: 'r', expectedPriceCents: 1, expectedMarginCents: 1 };
  const VALID_ADDRESS = { expectedAddressVersion: 0, recipientName: 'A', line1: 'B', postalCode: '01000', neighborhood: 'C', city: 'D', state: 'E' };
  for (const key of ['to', 'destination', 'addressTo', 'address_to']) {
    it(`\`${key}\` ⇒ 400 {field:'${key}', reason:'destination_not_editable'} en quote, label y address`, () => {
      const want = { status: 400, code: 'VALIDATION_ERROR', details: { field: key, reason: 'destination_not_editable' } };
      expect(errOf(() => parseQuoteBody({ [key]: { postalCode: '99999' } }))).toEqual(want);
      expect(errOf(() => parseLabelBody({ ...VALID_LABEL, [key]: {} }))).toEqual(want);
      expect(errOf(() => parseCorrectAddressBody({ ...VALID_ADDRESS, [key]: 'x' }))).toEqual(want);
      expect(errOf(() => rejectDestinationKeys({ [key]: null }))).toEqual(want);
    });
  }
  it('CONTROL: los cuerpos legítimos siguen pasando', () => {
    expect(errOf(() => parseQuoteBody({ packageCode: 'box' }))).toBeNull();
    expect(errOf(() => parseLabelBody(VALID_LABEL))).toBeNull();
  });
});

describe('💰 adaptador — `address_from` explícito (NM-1/NM-2 NO MEDIDOS contra Skydropx; aquí la forma del cuerpo)', () => {
  const quoteIn: QuoteInput = {
    from: { address: { countryCode: 'MX', postalCode: '72000', state: 'Puebla', city: 'Puebla', neighborhood: 'Centro' } },
    to: { countryCode: 'MX', postalCode: '14210', state: 'CDMX', city: 'Tlalpan', neighborhood: 'Pedregal' },
    parcel: { lengthCm: 30, widthCm: 20, heightCm: 10, weightKg: 1, coverageCents: 250000 },
  };
  it('cotizar: `address_from` por áreas (sin plantilla) y `address_to` de siempre', () => {
    const b = buildQuotationBody(quoteIn) as { quotation: Record<string, unknown> };
    expect(b.quotation.address_from).toEqual({ country_code: 'MX', postal_code: '72000', area_level1: 'Puebla', area_level2: 'Puebla', area_level3: 'Centro' });
    expect(b.quotation.address_to).toEqual({ country_code: 'MX', postal_code: '14210', area_level1: 'CDMX', area_level2: 'Tlalpan', area_level3: 'Pedregal' });
  });
  it('CONTROL salida: la plantilla sigue igual', () => {
    const b = buildQuotationBody({ ...quoteIn, from: { templateId: 'tpl' } }) as { quotation: Record<string, unknown> };
    expect(b.quotation.address_from).toEqual({ address_template_id: 'tpl' });
  });

  const store = storeDestinationOf(STORE);
  const purchaseIn: PurchaseInput = {
    rateId: 'r1',
    printingFormat: 'standard',
    ...inboundPurchaseAddresses(inboundAddressSnapshotOf(PICKUP), store, 'ENV-000045-01'),
    package: { coverageCents: 250000, consignmentNote: '49101600', packageType: '4G' },
    idempotencyKey: 'label:x:r1',
  };
  it('comprar: `address_from` explícito con CP y `address_to` = la tienda con su CP (BSD-B6: `to.postalCode = origin.postalCode`)', () => {
    const b = buildPurchaseBody(purchaseIn) as { shipment: Record<string, any> };
    expect(b.shipment.address_from).not.toHaveProperty('address_template_id');
    expect(b.shipment.address_from).toMatchObject({ postal_code: '72000', area_level3: 'Centro ENV 000123', email: 'tienda@tcghunt.mx', name: 'Vendedora Pérez', further_information: 'Casa azul' });
    expect(b.shipment.address_to).toMatchObject({ postal_code: '14210', area_level1: 'Ciudad de México', reference: 'Pedido ENV-000045-01', further_information: 'Portón gris' });
    expect(b.shipment.packages[0].consignment_note).toBe('49101600');
  });
  it('CONTROL salida: sin CP en `address_to` (lo pone la cotización) y la plantilla en `address_from`', () => {
    const out: PurchaseInput = { ...purchaseIn, from: { templateId: 'tpl', snapshot: null }, to: { street1: 'a', name: 'b', company: 'b', phone: '1', email: 'e', reference: 'Pedido ENV-1-01' } };
    const b = buildPurchaseBody(out) as { shipment: Record<string, any> };
    expect(b.shipment.address_from).toEqual({ address_template_id: 'tpl' });
    expect(b.shipment.address_to).not.toHaveProperty('postal_code');
  });
});

describe('💰 §BSD.8.2 / BSD-UX.2 — AV-7 con la etiqueta: variantes M, S, S0 y +R', () => {
  const base = { folio: 'sr-abcdef12-3456', carrier: '99minutos', trackingNumber: 'TRK123', shipDeadlineAt: new Date('2026-10-09T18:00:00Z') };
  const M = sellGuideTemplate(base, 'Ana', 'es');

  it('M (guía manual) sin cambio: ni sucursal, ni PDF, ni «sustituye»', () => {
    expect(M.subject).toBe('TCG HUNT — Tu guía prepagada');
    expect(M.text).toContain('La guía ya está pagada por nosotros.');
    expect(M.text).not.toMatch(/sucursal|PDF|sustituye/);
  });

  it('S: intro con el descuento y el adjunto, la sucursal con el NOMBRE legible, rastreo en prosa, «vuelve a descargarlo»', () => {
    const S = sellGuideTemplate({ ...base, skydropx: { pdfAttached: true, replaced: false, trackingUrl: 'https://track.example/T' } }, 'Ana', 'es');
    expect(S.subject).toBe('TCG HUNT — Tu guía prepagada');
    expect(S.text).toContain('Va adjunta a este correo en PDF');
    expect(S.text).toContain('Lleva el paquete a una sucursal de 99minutos: la paquetería no pasa a recogerlo.');
    expect(S.text).toContain('Puedes seguir tu paquete en la página de 99minutos: https://track.example/T');
    expect(S.text).toContain('Si pierdes el PDF, vuelve a descargarlo');
    expect(S.text).not.toContain('sustituye');
  });

  it('S0: «No pudimos adjuntarla», ⛔ «vuelve a descargarlo» (no hay PDF que perder); sin liga si Skydropx no la dio', () => {
    const S0 = sellGuideTemplate({ ...base, skydropx: { pdfAttached: false, replaced: false, trackingUrl: null } }, 'Ana', 'en');
    expect(S0.text).toContain("We couldn't attach it to this email");
    expect(S0.text).not.toContain('If you lose the PDF');
    expect(S0.text).not.toContain("website:");
  });

  it('+R: asunto y titular «nueva», la línea de sustitución PRIMERO tras el saludo y en el preheader', () => {
    const R = sellGuideTemplate({ ...base, skydropx: { pdfAttached: true, replaced: true, trackingUrl: null } }, 'Ana', 'es');
    expect(R.subject).toBe('TCG HUNT — Tu nueva guía prepagada');
    const lines = R.text.split('\n').filter((l) => l.trim() !== '');
    expect(lines[0]).toBe('Hola Ana:');
    expect(lines[1]).toBe('Tu nueva guía prepagada ya está lista');
    expect(lines[2]).toBe('Esta guía sustituye a la que te enviamos antes: no uses la anterior.');
    expect(R.html).toContain('Esta guía sustituye a la que te enviamos antes');
  });
});

describe('💰 §BSD.8.2 — `MailMessage.attachments`', () => {
  const pdf = Buffer.from('%PDF-1.4 x');
  it('Resend los pasa al SDK (filename, Buffer, contentType); sin adjuntos la clave no viaja', async () => {
    const a = new ResendMailAdapter('re_test', 'TCG <x@y.z>');
    const send = jest.fn(async () => ({ data: { id: 'm1' }, error: null }));
    (a as unknown as { resend: { emails: { send: typeof send } } }).resend = { emails: { send } };
    await a.send({ to: 't@x', subject: 's', html: 'h', text: 't', attachments: [{ filename: 'guia-abc.pdf', content: pdf, contentType: 'application/pdf' }] });
    await a.send({ to: 't@x', subject: 's', html: 'h', text: 't' });
    const calls = send.mock.calls as unknown as [Record<string, unknown>][];
    expect(calls[0][0].attachments).toEqual([{ filename: 'guia-abc.pdf', content: pdf, contentType: 'application/pdf' }]);
    expect(calls[1][0]).not.toHaveProperty('attachments');
  });
  it('Noop los ignora (no lanza)', async () => {
    await expect(new NoopMailAdapter().send({ to: 't', subject: 's', html: 'h', text: 't', attachments: [{ filename: 'g.pdf', content: pdf, contentType: 'application/pdf' }] })).resolves.toEqual({ id: undefined });
  });
});

describe('💰 BSD-1.1 C-1 / C-6 — `labelPdfAvailable`, paquetería legible y nombre del PDF', () => {
  const live = { status: 'guia', labelSource: 'skydropx', providerShipmentId: 'p1', providerCanceledAt: null, trackingNumber: 'T1' };
  it('true ⇔ guía VIVA de entrada con número ∧ solicitud `aceptada`', () => {
    expect(labelPdfAvailableOf({ status: 'aceptada' }, live)).toBe(true);
    expect(labelPdfAvailableOf({ status: 'en_transito' }, live)).toBe(false);
    expect(labelPdfAvailableOf({ status: 'aceptada' }, { ...live, providerCanceledAt: new Date() })).toBe(false);
    expect(labelPdfAvailableOf({ status: 'aceptada' }, { ...live, trackingNumber: null })).toBe(false);
    expect(labelPdfAvailableOf({ status: 'aceptada' }, { ...live, labelSource: 'manual' })).toBe(false);
    expect(labelPdfAvailableOf({ status: 'aceptada' }, { ...live, status: 'solicitado' })).toBe(false);
    expect(labelPdfAvailableOf({ status: 'aceptada' }, null)).toBe(false);
  });
  it('C-6: el legible (`carrierLabel`); vacío ⇒ `carrierName`; nada ⇒ el respaldo', () => {
    expect(sellerCarrierLabelOf({ carrierLabel: 'Paquetexpress', carrierName: 'paquetexpress' }, 'x')).toBe('Paquetexpress');
    expect(sellerCarrierLabelOf({ carrierLabel: '  ', carrierName: 'fedex' }, 'x')).toBe('fedex');
    expect(sellerCarrierLabelOf(null, 'dhl')).toBe('dhl');
  });
  it('`guia-<8 primeros del folio>.pdf`, solo `[A-Za-z0-9]`', () => {
    expect(sellerLabelFilenameOf('3f2a9c1b-77aa-4e0e-9b1c-000000000000')).toBe('guia-3f2a9c1b.pdf');
    expect(sellerLabelFilenameOf('a"b;c')).toBe('guia-abc.pdf');
  });
});
