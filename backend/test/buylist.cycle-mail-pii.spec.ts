import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as templates from '../src/modules/buylist/buylist-mail.templates';
import { MailMessage, MailPort } from '../src/modules/mail/mail.port';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { SettingKey } from '../src/modules/settings/settings.constants';
import { variantKey } from '../src/common/variant-key';

/**
 * ⚠️⚠️ v1.54 · **B-1 — LO PROHIBIDO SE BUSCA EN LOS CINCO CORREOS, NO EN CUATRO.**
 *
 * ### El defecto que este spec ancla
 * El **correo 1 (la oferta)** le mandaba al vendedor **su domicilio completo** interpolado:
 * `Sale desde: Av. E2E 123, Centro, CDMX, CDMX, 01000`. Salía del snapshot de la solicitud, en las
 * dos mitades del cuerpo (HTML y texto plano).
 *
 * `PROJECT.md` §P.3 lo prohíbe en la misma frase que la CLABE, y lo dice **dos veces**:
 * > *«**Aplica a los cinco, sin excepción** … nada de **CLABE** (ni enmascarada), nada de **datos de
 * > terceros**, nada de **otras solicitudes**, nada de **cifras internas de la mesa** … y **nada de
 * > domicilio**. **La regla nunca dependió del número.**»*
 *
 * Y el **criterio 173(h)** dice **cómo se verifica**, que es lo que da forma a este archivo:
 * > *«se verifica buscando esos datos **en los cinco, no en cuatro**».*
 *
 * ### Por qué la suite no lo vio (y qué se hace distinto aquí)
 * Los dos specs que tocaban la plantilla pasaban **`pickupAddressLine: null` como fixture**. Un
 * fixture **no es una aserción**: apagaba el bloque en vez de mirarlo, así que 3 420 tests podían
 * estar en verde con el domicilio dentro. Aquí:
 *
 * 1. **Se busca en LOS CINCO** —no en el que se arregló—, en `subject`, `html` y `text`, en **es** y
 *    **en**. Un correo nuevo que filtre el dato cae aquí aunque nadie se acuerde de este archivo.
 * 2. **El registro es EXHAUSTIVO sobre los exports del módulo**: cualquier plantilla nueva **rompe
 *    este spec** hasta que alguien la clasifique (ciclo / fuera del ciclo). *El agujero no se cierra
 *    tapando el que apareció, sino haciendo obligatorio clasificar el siguiente.*
 * 3. **Se verifica el PRODUCTOR, no solo la plantilla**: la oferta se emite de verdad, con un
 *    `pickupAddressSnapshot` lleno, y se lee el correo que salió por el puerto. Ahí es donde el dato
 *    se inyectaba.
 * 4. **Se comprueba que el detector detecta** (`(4)`): una aserción de ausencia que no sabe
 *    reconocer la presencia no vale nada.
 */

const pii = new PiiCryptoService(new ConfigService({}));

// =============================================================================================
// LOS DATOS PROHIBIDOS. Valores centinela: si alguno aparece en un correo, es que ese dato viajó.
// La lista es la del criterio 173(h), completa y en su orden.
// =============================================================================================
const DOMICILIO = {
  line1: 'Av. E2E 123',
  line2: 'Interior 4B',
  neighborhood: 'Centro',
  city: 'CDMX',
  state: 'CDMX',
  postalCode: '01000',
  phone: '+52 55 1234 5678',
};
const CLABE = '012345678901234567';
const CLABE_ENMASCARADA = '****4567';
const TERCERO = { name: 'Misty Waterflower', email: 'misty@cerulean.mx' };
const OTRA_SOLICITUD = { folio: 'sr-OTRA-99', montoTexto: '$ 7,777.00' };
const CIFRA_DE_LA_MESA = {
  posicion: 'stock: 8',
  sugerencia: 'do_not_buy',
  tope: 'variantPositionCap',
};

const PROHIBIDOS: { etiqueta: string; aguja: string }[] = [
  // (1) DOMICILIO — el hallazgo B-1. Cada parte por separado: media dirección sigue siendo dirección.
  ...Object.entries(DOMICILIO).map(([k, v]) => ({ etiqueta: `domicilio.${k}`, aguja: v })),
  // (2) CLABE, **ni enmascarada**.
  { etiqueta: 'clabe', aguja: CLABE },
  { etiqueta: 'clabe enmascarada', aguja: CLABE_ENMASCARADA },
  // (3) datos de TERCEROS.
  { etiqueta: 'tercero.nombre', aguja: TERCERO.name },
  { etiqueta: 'tercero.email', aguja: TERCERO.email },
  // (4) montos de OTRAS solicitudes.
  { etiqueta: 'otra solicitud (folio)', aguja: OTRA_SOLICITUD.folio },
  { etiqueta: 'otra solicitud (monto)', aguja: OTRA_SOLICITUD.montoTexto },
  // (5) cifras INTERNAS de la mesa (posición, sugerencia, topes).
  ...Object.entries(CIFRA_DE_LA_MESA).map(([k, v]) => ({ etiqueta: `mesa.${k}`, aguja: v })),
];

/** Devuelve las etiquetas de lo prohibido que aparece en el texto. Vacío ⇒ limpio. */
function prohibidosEn(...partes: string[]): string[] {
  const cuerpo = partes.join('\n');
  return PROHIBIDOS.filter((p) => cuerpo.includes(p.aguja)).map((p) => p.etiqueta);
}

const NOMBRE = 'Ash Ketchum';
const FOLIO = 'sr-1';
const LOCALES = ['es', 'en'] as const;

// =============================================================================================
// EL REGISTRO DE LOS CINCO. Cada entrada RENDERIZA el correo real, con todos sus canales llenos.
// =============================================================================================
type Renderizador = (locale: string) => MailMessage[];

const CICLO: Record<string, Renderizador> = {
  '1 · oferta': (locale) => [
    templates.sellOfferTemplate(
      {
        folio: FOLIO,
        lines: [
          {
            cardName: 'Charizard VMAX',
            setName: 'Darkness Ablaze',
            cardNumber: '020',
            finish: 'normal',
            offeredPriceCents: 42000,
          },
          {
            cardName: 'Pikachu V',
            setName: 'Vivid Voltage',
            cardNumber: '043',
            finish: 'reverse_holo',
            offeredPriceCents: null,
          },
        ],
        grossCents: 42000,
        shippingFeeCents: 18000,
        netCents: 24000,
        acceptDeadlineAt: new Date('2026-08-12T15:00:00Z'),
        portalUrl: 'https://app.example.mx/es/buylist/requests/sr-1',
      },
      NOMBRE,
      locale,
    ),
  ],
  // El 2 tiene DOS variantes (aceptar / enviar) y son el mismo correo: se barren las dos.
  '2 · recordatorio': (locale) =>
    (['accept', 'ship'] as const).map((kind) =>
      templates.sellOfferReminderTemplate(
        {
          kind,
          folio: FOLIO,
          buyLineCount: 3,
          netCents: 24000,
          deadlineAt: new Date('2026-08-12T15:00:00Z'),
          carrier: 'Estafeta',
          trackingNumber: '1234567890',
          portalUrl: 'https://app.example.mx/es/buylist/requests/sr-1',
        },
        NOMBRE,
        locale,
      ),
    ),
  // El 3 también: «no respondiste» y «no enviaste» son el mismo correo con otro copy de plazo.
  '3 · expiración': (locale) =>
    (['no_response', 'not_shipped'] as const).map((kind) =>
      templates.sellRequestExpiredTemplate(
        {
          kind,
          folio: FOLIO,
          closedAt: new Date('2026-08-12T15:00:00Z'),
          portalUrl: 'https://app.example.mx/es/buylist/requests/sr-1',
        },
        NOMBRE,
        locale,
      ),
    ),
  '4 · no procederemos': (locale) => [
    templates.sellRequestNotPursuedTemplate(
      { folio: FOLIO, portalUrl: 'https://app.example.mx/es/buylist/requests/sr-1' },
      NOMBRE,
      locale,
    ),
  ],
  '5 · cancelamos la oferta': (locale) => [
    templates.sellOfferCancelledTemplate(
      {
        folio: FOLIO,
        offerSentAt: new Date('2026-08-10T15:00:00Z'),
        portalUrl: 'https://app.example.mx/es/buylist/requests/sr-1',
      },
      NOMBRE,
      locale,
    ),
  ],
};

/**
 * Plantillas del módulo que **NO** son del ciclo. Están declaradas —y no simplemente ignoradas—
 * porque la exhaustividad de abajo exige clasificar **todo** lo que exporte el módulo.
 */
const FUERA_DEL_CICLO = ['sellItemRejectedTemplate'];

// =============================================================================================
describe('⚠️ (1) el conteo es CINCO, y la lista se cierra sola', () => {
  it('el registro tiene exactamente los cinco correos obligatorios del ciclo', () => {
    expect(Object.keys(CICLO)).toHaveLength(5);
  });

  it('⚠️ EXHAUSTIVIDAD: toda plantilla del módulo está clasificada (ciclo o fuera del ciclo)', () => {
    // Ésta es la aserción que impide que el agujero se repita: quien añada un `sexoTemplate` a este
    // módulo **rompe este test** hasta que decida si es del ciclo (y entonces lo barre lo prohibido)
    // o no lo es. *No se cierra tapando el correo que apareció; se cierra obligando a clasificar el
    // siguiente.*
    const exportadas = Object.entries(templates)
      .filter(([k, v]) => typeof v === 'function' && k.endsWith('Template'))
      .map(([k]) => k)
      .sort();
    const clasificadas = [
      'sellOfferTemplate',
      'sellOfferReminderTemplate',
      'sellRequestExpiredTemplate',
      'sellRequestNotPursuedTemplate',
      'sellOfferCancelledTemplate',
      ...FUERA_DEL_CICLO,
    ].sort();
    expect(exportadas).toEqual(clasificadas);
  });
});

// =============================================================================================
describe('⚠️⚠️ (2) LO PROHIBIDO, BUSCADO EN LOS CINCO (criterio 173h)', () => {
  for (const [correo, render] of Object.entries(CICLO)) {
    for (const locale of LOCALES) {
      it(`correo ${correo} [${locale}] no lleva domicilio, CLABE, terceros, otras solicitudes ni cifras de la mesa`, () => {
        for (const msg of render(locale)) {
          expect(prohibidosEn(msg.subject, msg.html, msg.text)).toEqual([]);
        }
      });
    }
  }

  it('⚠️ y el DOMICILIO en particular: ni una de sus partes, en ninguno de los cinco', () => {
    // Redundante con el barrido de arriba **a propósito**: es el dato del hallazgo, y el que la
    // regla nombra dos veces. Si alguien reduce la lista de prohibidos, esta aserción sigue en pie.
    const encontrados: string[] = [];
    for (const [correo, render] of Object.entries(CICLO)) {
      for (const locale of LOCALES) {
        for (const msg of render(locale)) {
          const cuerpo = [msg.subject, msg.html, msg.text].join('\n');
          for (const [campo, valor] of Object.entries(DOMICILIO)) {
            if (cuerpo.includes(valor)) encontrados.push(`${correo} [${locale}] → ${campo}`);
          }
        }
      }
    }
    expect(encontrados).toEqual([]);
  });

  it('el aviso ÚTIL sobre la dirección se conserva (se retiró el dato, no la advertencia)', () => {
    // La razón por la que el domicilio estaba ahí era buena —que el vendedor corrija una dirección
    // vieja ANTES de aceptar, porque después ya compramos la etiqueta con ella—. Eso se conserva sin
    // el dato: se consulta en la cuenta, que es superficie autenticada.
    const es = CICLO['1 · oferta']('es')[0];
    expect(es.text).toContain('corrígela antes de aceptar');
    const en = CICLO['1 · oferta']('en')[0];
    expect(en.text).toContain('correct it before accepting');
  });
});

// =============================================================================================
describe('⚠️⚠️ (3) EL PRODUCTOR: se emite una oferta REAL y se lee lo que salió por el puerto', () => {
  /** Emite la oferta con un snapshot de dirección COMPLETO y devuelve el correo enviado. */
  async function emitirOferta(): Promise<MailMessage> {
    const card = {
      id: 'card-1',
      name: 'Charizard VMAX',
      number: '020',
      rarity: 'Rare Holo',
      rarityCanonical: 'rare',
      subtypes: null,
      availableFinishes: ['normal'],
      set: { id: 'swsh3', name: 'Darkness Ablaze' },
    };
    const items = [
      {
        id: 'it-1',
        sellRequestId: 'sr-1',
        cardId: 'card-1',
        card,
        productType: 'raw' as const,
        rawCondition: 'NM' as const,
        finish: 'normal' as const,
        cardProductId: null,
        quotedPriceCents: 90000,
        approvedPriceCents: null,
        itemStatus: 'cotizada',
        inventoryItemId: null,
        offerDecision: null as string | null,
        offeredPriceCents: null as number | null,
        offerDerivedPriceCents: null as number | null,
        offerOverrideReason: null as string | null,
      },
    ];
    const request: Record<string, unknown> = {
      id: 'sr-1',
      userId: 'u-1',
      user: { id: 'u-1', name: NOMBRE, email: 'ash@example.mx', locale: 'es' },
      status: 'cotizada',
      offerState: null,
      closedAt: null,
      quotedTotalCents: 90000,
      createdAt: new Date('2026-08-01T00:00:00Z'),
      // ⚠️ EL SNAPSHOT COMPLETO. Éste es el dato que se colaba al correo.
      pickupAddressSnapshot: { ...DOMICILIO },
      offerSentAt: null,
      offerAcceptDeadlineAt: null,
      offerGrossCents: null,
      offerShippingFeeCents: null,
      offerNetCents: null,
      offerIssueClockStartedAt: null,
      offerReissueCount: 0,
      offerCancelledAt: null,
      ineRequired: false,
      ineProvided: false,
    };

    const prisma: any = {
      sellRequest: {
        findUnique: jest.fn(async () => ({ ...request, items: items.map((i) => ({ ...i })) })),
        updateMany: jest.fn(async ({ data }: any) => {
          Object.assign(request, data);
          return { count: 1 };
        }),
        findMany: jest.fn(async () => []),
      },
      sellRequestItem: {
        findMany: jest.fn(async () => []),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const ids: string[] = where?.id?.in ?? (where?.id ? [where.id] : items.map((i) => i.id));
          for (const it of items) if (ids.includes(it.id)) Object.assign(it, data);
          return { count: ids.length };
        }),
        aggregate: jest.fn(async () => ({
          _sum: { approvedPriceCents: null },
          _count: { approvedPriceCents: 0 },
        })),
      },
      // La CLABE del vendedor existe y está cifrada: si algún día el correo la tocara, el barrido
      // de prohibidos la vería.
      kycProfile: jest.fn,
      inventoryItem: { groupBy: jest.fn(async () => []) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    prisma.kycProfile = {
      findUnique: jest.fn(async () => ({ userId: 'u-1', clabeEnc: pii.encrypt(CLABE) })),
    };

    const pricing = {
      loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
      gradeKeyFor: jest.fn(PricingService.prototype.gradeKeyFor),
      getVariantOverridesBatch: jest.fn(async () => new Map()),
      getReferencesBatch: jest.fn(async (list: any[]) => {
        const m = new Map<string, unknown>();
        for (const i of list) m.set(variantKey(i), { status: 'priced', referenceMxnCents: 200000 });
        return m;
      }),
      findCardProductsByTcgIds: jest.fn(async () => new Map()),
      getReferencesByCardProductBatch: jest.fn(async () => new Map()),
    };
    const DIALS: Record<string, number> = {
      [SettingKey.BUYLIST_SHIPPING_FEE_CENTS]: 18000,
      [SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS]: 20000,
      [SettingKey.BUYLIST_OFFER_ACCEPT_DEADLINE_BUSINESS_DAYS]: 2,
    };
    const settings = { getNumber: jest.fn(async (k: any) => DIALS[k as string] ?? 0) };
    const enviados: MailMessage[] = [];
    const mail: MailPort = {
      send: jest.fn(async (msg: MailMessage) => {
        enviados.push(msg);
        return { id: 'm1' };
      }),
    };
    const svc = new BuylistService(
      prisma as PrismaService,
      pricing as unknown as PricingService,
      settings as unknown as SettingsService,
      {} as UsersService,
      pii,
      mail,
    );
    await svc.adminOffer('sr-1', { id: 'sa-1', role: 'super_admin' as never }, [
      { itemId: 'it-1', decision: 'buy' },
    ]);
    expect(enviados).toHaveLength(1);
    return enviados[0];
  }

  it('⚠️ el correo de oferta REALMENTE emitido no lleva NADA del snapshot de dirección', async () => {
    const msg = await emitirOferta();
    expect(prohibidosEn(msg.subject, msg.html, msg.text)).toEqual([]);
  });

  it('y sí lleva lo que le corresponde: los tres montos y el plazo (la resta se ENSEÑA)', async () => {
    // Contrapeso deliberado: un correo vacío también pasaría el barrido de PII. Éste comprueba que
    // lo que se quitó fue el domicilio y **no** la información vinculante (criterio 134).
    const msg = await emitirOferta();
    expect(msg.text).toContain('Valor de las cartas');
    expect(msg.text).toContain('Envío que ponemos nosotros');
    expect(msg.text).toContain('SE TE DEPOSITAN');
  });
});

// =============================================================================================
describe('⚠️ (4) el detector detecta, y el módulo no sabe componer una dirección', () => {
  it('una aserción de ausencia que no reconoce la presencia no vale nada', () => {
    const fuga = `Sale desde: ${DOMICILIO.line1}, ${DOMICILIO.neighborhood}, ${DOMICILIO.postalCode}`;
    expect(prohibidosEn(fuga)).toEqual(
      expect.arrayContaining(['domicilio.line1', 'domicilio.neighborhood', 'domicilio.postalCode']),
    );
    expect(prohibidosEn(`Tu CLABE ${CLABE_ENMASCARADA}`)).toContain('clabe enmascarada');
  });

  it('⚠️ el módulo de plantillas no nombra ningún campo de domicilio ni de CLABE (código, sin comentarios)', () => {
    // Ancla ESTRUCTURAL, complementaria del barrido de salida: `pickupAddressLine()` —el helper que
    // componía la línea legible del snapshot— **se eliminó**, y con él la única rampa por la que el
    // dato volvía a entrar. Si alguien lo reintroduce con otro nombre, tendrá que nombrar los campos.
    // Se leen los comentarios FUERA: este spec habla de código, y los comentarios de la plantilla
    // explican justamente qué se quitó.
    const ruta = join(__dirname, '..', 'src', 'modules', 'buylist', 'buylist-mail.templates.ts');
    const codigo = readFileSync(ruta, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const campo of ['pickupAddress', 'postalCode', 'neighborhood', 'line1', 'clabe']) {
      expect(codigo.toLowerCase()).not.toContain(campo.toLowerCase());
    }
  });
});
