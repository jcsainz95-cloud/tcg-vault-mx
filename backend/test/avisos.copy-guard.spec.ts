import { readFileSync } from 'fs';
import { join } from 'path';
import { MailMessage } from '../src/modules/mail/mail.port';
import * as kycTpl from '../src/modules/admin/mail/kyc-notice.templates';
import * as orderTpl from '../src/modules/orders/mail/order-notice.templates';
import * as shipmentTpl from '../src/modules/shipments/mail/shipment-notice.templates';
import * as buylistTpl from '../src/modules/buylist/buylist-notice.templates';
import * as disputeTpl from '../src/modules/disputes/mail/dispute-notice.templates';

/**
 * # ⭐⭐ `C-AV-9` — NI CIFRAS INVENTADAS, NI DERECHO, NI DIALES (criterios 201/207/208/209)
 *
 * Barrido **sobre los ONCE correos nuevos a la vez**, en **es** y en **en**, en `subject`, `html` y
 * `text`. Y **exhaustivo sobre los exports** de los cinco ficheros de plantillas: *quien añada un
 * `avisoTemplate` rompe este test hasta que lo clasifique*. **El agujero no se cierra tapando el que
 * apareció, se cierra obligando a clasificar el siguiente** — misma doctrina que
 * `buylist.cycle-mail-pii.spec.ts`, que es el precedente vivo.
 *
 * ## ⭐⭐ Y EL QUE MUERDE DE VERDAD
 * `Order.ivaTransferPct` **es una columna de la fila** desde v1.64: un correo que renderice «la
 * orden» **la filtra sin que nadie lo escriba** (criterio **209**). Aquí se le pasa a cada plantilla
 * un valor centinela por todos los huecos que acepta y se comprueba que **ni el nombre del campo ni
 * su valor aparecen en ninguna parte** del correo. ⚠️ La defensa real es de diseño —**las plantillas
 * reciben campos sueltos, jamás un `Order`**— y este test es el que impide que alguien «simplifique»
 * pasándole la fila entera.
 */

// =================================================================================================
// LOS DATOS PROHIBIDOS. Centinelas: si alguno aparece, ese dato viajó.
// =================================================================================================
const IVA_TRANSFER_PCT_VALOR = '1600';
const PROHIBIDOS: { etiqueta: string; aguja: string | RegExp }[] = [
  // (209) el dial de traslado del IVA — ni el nombre del campo, ni su valor, en ninguna forma.
  { etiqueta: 'ivaTransferPct (nombre)', aguja: /ivaTransferPct/i },
  { etiqueta: 'ivaTransferPct (valor)', aguja: IVA_TRANSFER_PCT_VALOR },
  // (208)/(195) vocabulario del traslado y afirmaciones jurídicas — tampoco en negativo.
  { etiqueta: 'traslado del IVA', aguja: /trasladad?[oa]s?\b/i },
  { etiqueta: 'IVA trasladado (en)', aguja: /transferred VAT|VAT transfer/i },
  { etiqueta: 'cita de norma', aguja: /\bLIVA\b|art[íi]culo\s+\d|CFF|Código Fiscal|Tax Code/i },
  { etiqueta: 'afirmación fiscal', aguja: /deducible|acreditable|deductible|creditable/i },
  { etiqueta: 'CFDI/factura como promesa', aguja: /CFDI/i },
  // (201) topes, umbrales y acumulados — aplica a los once **y** a los seis motivos de rechazo.
  { etiqueta: 'tope/umbral', aguja: /\btope\b|\bumbral\b|\bl[íi]mite\b|\bcap\b|\bthreshold\b/i },
  { etiqueta: 'acumulado mensual', aguja: /acumulad|monthly limit|per month/i },
  // (§R.8 fila 7) PII que ningún correo puede llevar.
  { etiqueta: 'CLABE', aguja: /CLABE/i },
  { etiqueta: 'RFC', aguja: /\bRFC\b/i },
  { etiqueta: 'object key de INE', aguja: /kyc_ine\//i },
  // (§R.2.3 prohibición 2) el estado admin-only que NUNCA puede asomar.
  { etiqueta: 'SellOfferState', aguja: /pending_authorization|autorizaci[óo]n pendiente/i },
];

function prohibidosEn(...partes: string[]): string[] {
  const cuerpo = partes.join('\n');
  return PROHIBIDOS.filter((p) =>
    typeof p.aguja === 'string' ? cuerpo.includes(p.aguja) : p.aguja.test(cuerpo),
  ).map((p) => p.etiqueta);
}

const LOCALES = ['es', 'en'] as const;
const NOMBRE = 'Ash Ketchum';

/**
 * ⭐ **Todos los huecos, llenos con valores REALISTAS.** Un fixture que pase `null` por el campo
 * peligroso **apaga el bloque en vez de mirarlo** — ése fue exactamente el defecto que dejó pasar el
 * domicilio en el correo de la oferta (B-1): *un fixture no es una aserción*.
 */
const LOS_ONCE: Record<string, (locale: string) => Omit<MailMessage, 'to'>[]> = {
  'AV-1 · rechazo de identidad': (l) => [
    kycTpl.kycRejectedTemplate(
      { reason: 'No se alcanza a leer: la foto está borrosa, con reflejo o cortada.' },
      NOMBRE,
      l,
    ),
  ],
  'AV-2 · pedido liquidado (registrado)': (l) => [
    orderTpl.orderSettledTemplate(
      {
        orderNumber: 'TCG-1001',
        items: [{ name: 'Charizard VMAX', setName: 'Darkness Ablaze', number: '020' }],
        totalCents: 148000,
      },
      l,
    ),
  ],
  'AV-3 · reembolso': (l) => [
    orderTpl.orderRefundedTemplate({ orderNumber: 'TCG-1001', totalCents: 148000 }, l),
  ],
  'AV-4 · guía al comprador': (l) => [
    shipmentTpl.shipmentGuideTemplate(
      { shipmentId: 'shp-1', orderNumber: 'TCG-1001', carrier: 'Estafeta', trackingNumber: 'EST-1' },
      l,
    ),
  ],
  'AV-5 · salida del envío': (l) => [
    // Las DOS variantes: con etiqueta y sin ella (`D-AV-2` permite `guia` sin número).
    shipmentTpl.shipmentShippedTemplate(
      { shipmentId: 'shp-1', orderNumber: 'TCG-1001', carrier: 'Estafeta', trackingNumber: 'EST-1' },
      l,
    ),
    shipmentTpl.shipmentShippedTemplate({ shipmentId: 'shp-1', orderNumber: null }, l),
  ],
  'AV-6 · envío cancelado': (l) => [
    shipmentTpl.shipmentCancelledTemplate({ shipmentId: 'shp-1', orderNumber: null }, l),
  ],
  'AV-7 · guía al vendedor': (l) => [
    buylistTpl.sellGuideTemplate(
      {
        folio: 'sr-1',
        carrier: 'Estafeta',
        trackingNumber: 'EST-1',
        shipDeadlineAt: new Date('2026-09-18T21:00:00Z'),
        portalUrl: 'https://app.example.mx/es/buylist/requests/sr-1',
      },
      NOMBRE,
      l,
    ),
  ],
  'AV-8 · acuse de recibido': (l) => [
    buylistTpl.sellReceivedTemplate(
      { folio: 'sr-1', portalUrl: 'https://app.example.mx/es/buylist/requests/sr-1' },
      NOMBRE,
      l,
    ),
  ],
  'AV-9 · buylist pagada': (l) => [
    buylistTpl.sellPaidTemplate(
      {
        folio: 'sr-1',
        payoutNetCents: 240000,
        speiReference: 'SPEI-2026-0001',
        portalUrl: 'https://app.example.mx/es/buylist/requests/sr-1',
      },
      NOMBRE,
      l,
    ),
  ],
  'AV-10 · disputa con recompra': (l) => [
    disputeTpl.disputeRepurchaseTemplate(
      { folio: 'dsp-1', resolution: 'Aceptamos la aclaración (repurchase 42000 cents)' },
      l,
    ),
  ],
  'AV-11 · disputa rechazada': (l) => [
    disputeTpl.disputeRejectedTemplate({ folio: 'dsp-1', resolution: 'La carta llegó como se describió' }, l),
  ],
};

// =================================================================================================
describe('⭐ (1) el conteo es ONCE, y la lista se cierra sola', () => {
  it('el registro tiene exactamente los ONCE avisos del catálogo (§R.3)', () => {
    expect(Object.keys(LOS_ONCE)).toHaveLength(11);
  });

  it('⚠️ EXHAUSTIVIDAD: toda plantilla de los cinco ficheros de avisos está clasificada', () => {
    const exportadas = [kycTpl, orderTpl, shipmentTpl, buylistTpl, disputeTpl]
      .flatMap((m) => Object.entries(m))
      .filter(([k, v]) => typeof v === 'function' && k.endsWith('Template'))
      .map(([k]) => k)
      .sort();
    const clasificadas = [
      'kycRejectedTemplate',
      'orderSettledTemplate',
      'orderRefundedTemplate',
      'shipmentGuideTemplate',
      'shipmentShippedTemplate',
      'shipmentCancelledTemplate',
      'sellGuideTemplate',
      'sellReceivedTemplate',
      'sellPaidTemplate',
      'disputeRepurchaseTemplate',
      'disputeRejectedTemplate',
    ].sort();
    expect(exportadas).toEqual(clasificadas);
  });

  it('⛔ y NO existe plantilla de «entregado» ni de «pago fallido» ni de «contracargo»', () => {
    // Criterio 206, **por exceso**: los tres mudos no tienen dónde nacer. Si alguien escribe
    // `shipmentDeliveredTemplate`, la exhaustividad de arriba se pone roja **antes** de que exista
    // un llamador. *Lo que se deja fuera vale tanto como lo que se mete.*
    const nombres = Object.keys({ ...shipmentTpl, ...orderTpl });
    expect(nombres.some((n) => /delivered|entregad/i.test(n))).toBe(false);
    expect(nombres.some((n) => /failed|chargeback|contracargo/i.test(n))).toBe(false);
  });
});

// =================================================================================================
describe('⭐⭐ (2) LO PROHIBIDO, buscado en LOS ONCE (criterios 201/207/208/209)', () => {
  for (const [aviso, render] of Object.entries(LOS_ONCE)) {
    for (const locale of LOCALES) {
      it(`${aviso} [${locale}] no lleva diales, derecho, topes ni PII`, () => {
        for (const msg of render(locale)) {
          expect(prohibidosEn(msg.subject, msg.html, msg.text)).toEqual([]);
        }
      });
    }
  }

  it('⭐⭐ y el dial de IVA en particular: ni el nombre ni el valor, en ninguno de los once', () => {
    const encontrados: string[] = [];
    for (const [aviso, render] of Object.entries(LOS_ONCE)) {
      for (const locale of LOCALES) {
        for (const msg of render(locale)) {
          const cuerpo = [msg.subject, msg.html, msg.text].join('\n');
          if (/ivaTransferPct/i.test(cuerpo) || cuerpo.includes(IVA_TRANSFER_PCT_VALOR)) {
            encontrados.push(`${aviso} [${locale}]`);
          }
        }
      }
    }
    expect(encontrados).toEqual([]);
  });

  it('CANARIO: el detector RECONOCE lo prohibido cuando sí está', () => {
    // Una aserción de ausencia que no sabe reconocer la presencia no vale nada.
    expect(prohibidosEn('el IVA trasladado es del 16%')).toContain('traslado del IVA');
    expect(prohibidosEn('{"ivaTransferPct":1600}')).toContain('ivaTransferPct (nombre)');
    expect(prohibidosEn('tu tope mensual es de $50,000')).toContain('tope/umbral');
    expect(prohibidosEn('tu CLABE ****4567')).toContain('CLABE');
    expect(prohibidosEn('la oferta está en pending_authorization')).toContain('SellOfferState');
  });
});

// =================================================================================================
describe('⭐ (3) LOS SEIS MOTIVOS DE RECHAZO — el criterio 201 aplica a ellos también', () => {
  /**
   * ⚠️ **Se leen del frontend, que es donde viven, y SOLO SE LEEN.** El copy es de ux-ui; este test
   * no lo escribe ni lo corrige: **comprueba que sigue cumpliendo** lo que §R.1.a midió (*«el criterio
   * 201 ya se cumple en los seis presets»*). Lo que queda es **mantenerlo**, y eso es este candado.
   */
  const presets = (locale: 'es' | 'en'): Record<string, string> => {
    const raw = readFileSync(
      join(__dirname, '..', '..', 'frontend', 'messages', `${locale}.json`),
      'utf8',
    );
    return JSON.parse(raw).admin.m6.kycReview.rejectPreset;
  };

  for (const locale of LOCALES) {
    it(`los seis motivos [${locale}] existen y ninguno menciona topes, umbrales ni cifras`, () => {
      const p = presets(locale);
      expect(Object.keys(p).sort()).toEqual(
        ['expired', 'missingSide', 'nameMismatch', 'notAnId', 'other', 'unreadable'].sort(),
      );
      for (const [clave, texto] of Object.entries(p)) {
        expect({ clave, prohibidos: prohibidosEn(texto) }).toEqual({ clave, prohibidos: [] });
        // ⛔ Y ninguna cifra de dinero: un motivo con un importe es un tope dicho de otra forma.
        expect(texto).not.toMatch(/\$\s?\d/);
      }
    });
  }

  it('el motivo viaja VERBATIM al correo: lo que el operador eligió es lo que el cliente lee', () => {
    const motivo = presets('es').expired;
    const msg = kycTpl.kycRejectedTemplate({ reason: motivo }, NOMBRE, 'es');
    expect(msg.text).toContain(motivo);
  });
});
