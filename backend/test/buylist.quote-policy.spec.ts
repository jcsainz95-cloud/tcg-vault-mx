import 'reflect-metadata';
import { BuylistController } from '../src/modules/buylist/buylist.controller';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import {
  SETTING_DEFAULTS,
  SettingKey,
} from '../src/modules/settings/settings.constants';

const pii = new PiiCryptoService(new ConfigService({}));

/**
 * v1.51.4 (D43 · API_CONTRACT §6/§11 · ARCHITECTURE §4.39r · criterio 132(a)) —
 * **`GET /api/v1/buylist/quote-policy`: la política pública del cotizador.**
 *
 * Lo que este archivo protege **no es que el campo esté** —eso es la parte fácil— sino las dos
 * propiedades que se rompen en silencio: que el DTO **siga teniendo exactamente un campo** y que el
 * número **salga del dial vigente y no de una constante**.
 */

/** Un `SettingsService` real sobre un prisma mockeado: la fila del dial es la única que existe. */
function buildSettings(vigente?: unknown) {
  const prisma = {
    configSetting: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.key === SettingKey.BUYLIST_MINIMUM_REQUEST_CENTS && vigente !== undefined
          ? { key: where.key, valueJson: vigente }
          : null,
      ),
    },
  } as unknown as PrismaService;
  return new SettingsService(prisma);
}

function buildService(vigente?: unknown) {
  const prisma = {} as PrismaService;
  return new BuylistService(
    prisma,
    {} as PricingService,
    buildSettings(vigente),
    {} as UsersService,
    pii,
  );
}

// ============================================================================================
describe('§6 — la ruta feliz: un entero, y el que dice el dial', () => {
  it('devuelve el mínimo VIGENTE cuando hay fila en `ConfigSetting`', async () => {
    const svc = buildService(50000);
    await expect(svc.quotePolicy()).resolves.toEqual({ minimumRequestCents: 50000 });
  });

  it('sin fila en `ConfigSetting` resuelve al DEFAULT del código (no a 0 ni a undefined)', async () => {
    // Un entorno recién migrado puede no tener la fila. Caer a 0 apagaría el mínimo entero y
    // dejaría pasar cualquier carrito; caer a `undefined` rompería el tipo del DTO.
    const svc = buildService(undefined);
    await expect(svc.quotePolicy()).resolves.toEqual({
      minimumRequestCents: SETTING_DEFAULTS[SettingKey.BUYLIST_MINIMUM_REQUEST_CENTS],
    });
  });

  it('⚠️ SALE DEL DIAL, NO DE UNA CONSTANTE: se mueve el dial y la respuesta cambia', async () => {
    // El test que de verdad importa. Uno que solo comprobara `minimumRequestCents === 50000`
    // pasaría igual con el número hardcodeado en el servicio — y hardcodearlo es exactamente lo que
    // R4 de DESIGN_SYSTEM §23 prohíbe y lo que el criterio 132(a) desmiente al pedir «el número
    // correcto». Se recorre una serie de valores para que ni siquiera un `?? 50000` colado pase.
    for (const valor of [1, 30000, 50000, 75000, 120000]) {
      const svc = buildService(valor);
      await expect(svc.quotePolicy()).resolves.toEqual({ minimumRequestCents: valor });
    }
  });

  it('la lectura ocurre EN CADA llamada (no hay caché en memoria que tape un cambio de dial)', async () => {
    // El contrato PERMITE una caché de servidor pero no la exige, y su TTL no podría superar el
    // `max-age` publicado. No se añadió: sumaría una SEGUNDA ventana de rancidez encima de los 300 s
    // — justo en el número que gatea un botón. Si el humano mueve el dial, el único retraso debe ser
    // el que está publicado.
    const prisma = {
      configSetting: { findUnique: jest.fn(async () => ({ valueJson: 50000 })) },
    } as unknown as PrismaService;
    const svc = new BuylistService(
      {} as PrismaService,
      {} as PricingService,
      new SettingsService(prisma),
      {} as UsersService,
      pii,
    );
    await svc.quotePolicy();
    await svc.quotePolicy();
    expect((prisma as any).configSetting.findUnique).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================================
describe('§6 — ⚠️ EL DTO TIENE EXACTAMENTE UNA CLAVE (la lista de exclusiones es CERRADA)', () => {
  it('exactamente UNA clave, y es `minimumRequestCents`', async () => {
    // ⚠️ ESTE es el guard que importa. Un test que solo asertara `minimumRequestCents` pasaría igual
    // el día que alguien añada la tarifa de envío «porque el front la necesitaba»: el DTO es tan
    // importante por lo que NO lleva como por lo que lleva.
    const body = await buildService(50000).quotePolicy();
    expect(Object.keys(body)).toEqual(['minimumRequestCents']);
    expect(Object.keys(body)).toHaveLength(1);
    expect(typeof body.minimumRequestCents).toBe('number');
    expect(Number.isInteger(body.minimumRequestCents)).toBe(true);
  });

  it('⚠️ `shippingFeeCents` NO viaja — la exclusión que sostiene D43 entera', async () => {
    // No es que el front «no deba pintarlo»: NO LO RECIBE. Un valor que no llega al navegador no se
    // puede pintar por accidente ⇒ D43 deja de depender de la disciplina del frontend y pasa a ser
    // una propiedad del contrato. La tarifa se dice CON CIFRA solo en el correo de oferta y en
    // `offer.terms`, y EN PALABRAS en el cotizador.
    const body = (await buildService(50000).quotePolicy()) as Record<string, unknown>;
    for (const prohibida of ['shippingFeeCents', 'buylistShippingFeeCents', 'feeCents']) {
      expect(body).not.toHaveProperty(prohibida);
    }
    // Y el VALOR de la tarifa (MX$180) no aparece por ninguna vía, ni renombrado.
    expect(Object.values(body)).not.toContain(
      SETTING_DEFAULTS[SettingKey.BUYLIST_SHIPPING_FEE_CENTS],
    );
  });

  it('⚠️⚠️ VETO DURO — ni los topes AML ni el umbral de INE, por clave NI por valor', async () => {
    // Publicar el umbral de INE y los topes AML es publicar EL MANUAL DE CÓMO ESTRUCTURAR POR
    // DEBAJO: un control de cumplimiento pierde eficacia al ser conocido. Ningún cambio futuro los
    // mueve aquí sin decisión explícita del humano y revisión de `seguridad`.
    // Se comprueba por VALOR además de por clave: renombrar la clave no sería una defensa.
    const svc = buildService(50000);
    const body = (await svc.quotePolicy()) as Record<string, unknown>;
    const vetados = [
      SettingKey.BUYLIST_CAP_PER_REQUEST_CENTS,
      SettingKey.BUYLIST_CAP_PER_MONTH_CENTS,
      SettingKey.INE_THRESHOLD_CENTS,
    ] as const;
    for (const k of vetados) {
      expect(Object.values(body)).not.toContain(SETTING_DEFAULTS[k]);
    }
    expect(Object.keys(body)).not.toContain('ineThresholdCents');
    expect(Object.keys(body).some((k) => /cap|ine|aml/i.test(k))).toBe(false);
  });

  it('ningún OTRO dial del ciclo viaja: 1 de 10, lista cerrada', async () => {
    const body = (await buildService(50000).quotePolicy()) as Record<string, unknown>;
    const losOtrosNueve = [
      SettingKey.BUYLIST_OFFER_ACCEPT_DEADLINE_BUSINESS_DAYS, // 1 — se CONGELA por solicitud
      SettingKey.BUYLIST_SHIP_DEADLINE_BUSINESS_DAYS, // 2 — se CONGELA por solicitud
      SettingKey.BUYLIST_OFFER_ISSUE_DEADLINE_BUSINESS_DAYS, // 4 — SLA nuestro, no se comunica
      SettingKey.BUYLIST_OPERATOR_OFFER_CAP_CENTS, // 5 — invita a quedarse justo debajo
      SettingKey.BUYLIST_VARIANT_POSITION_CAP, // 6 — dice cuándo dejamos de comprar
      SettingKey.BUYLIST_SHIPPING_FEE_CENTS, // 7 — arriba
      SettingKey.BUYLIST_SHIPMENT_CONFIRM_ALERT_BUSINESS_DAYS, // 8 — cola interna
      SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS, // 9 — se evalúa sobre el neto OFERTADO
      SettingKey.BUYLIST_OFFER_REISSUE_ALERT_COUNT, // 10 — mide NUESTRA conducta
    ] as const;
    expect(losOtrosNueve).toHaveLength(9);
    for (const k of losOtrosNueve) {
      expect(Object.values(body)).not.toContain(SETTING_DEFAULTS[k]);
    }
  });

  it('tampoco los campos que el contrato descarta por ser de un solo valor o del carrito', async () => {
    // `binding:false`/`isIndicative`/`disclaimer` serían un BOOLEANO DE UN SOLO VALOR —lo mismo que
    // D31 retiró de `SellOfferPublicDTO`—; `currency` sobra (centavos MXN por convención §0); y
    // `shortfallCents` depende del CARRITO, que es estado del cliente: el faltante autoritativo lo
    // da el `422 BUYLIST_MINIMUM_NOT_MET`.
    const body = await buildService(50000).quotePolicy();
    for (const k of [
      'binding',
      'isIndicative',
      'disclaimer',
      'currency',
      'shortfallCents',
      'netCents',
    ]) {
      expect(body).not.toHaveProperty(k);
    }
  });
});

// ============================================================================================
describe('§6 — la ruta: pública, throttled, cacheable y READ-ONLY', () => {
  const proto = BuylistController.prototype;

  it('el path es `quote-policy` y el verbo es GET (un POST no se cachea)', () => {
    expect(Reflect.getMetadata('path', proto.quotePolicy)).toBe('quote-policy');
    expect(Reflect.getMetadata('method', proto.quotePolicy)).toBe(0); // RequestMethod.GET
    // ⚠️ JAMÁS `GET /config`: un cajón llamado «config pública» invita a echarle la siguiente
    // bandera, y así es como el umbral de INE acaba publicado «porque ya había un endpoint».
    expect(Reflect.getMetadata('path', proto.quotePolicy)).not.toMatch(/config/i);
  });

  it('es `public` (sin JWT): el cotizador es anónimo', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.quotePolicy)).toBe(true);
  });

  it('lleva el MISMO throttle público que los otros anónimos del controller (60/min)', () => {
    const limit = (fn: unknown) => Reflect.getMetadata('THROTTLER:LIMITdefault', fn as object);
    const ttl = (fn: unknown) => Reflect.getMetadata('THROTTLER:TTLdefault', fn as object);
    expect(limit(proto.quotePolicy)).toBe(60);
    expect(ttl(proto.quotePolicy)).toBe(60_000);
    expect(limit(proto.quotePolicy)).toBe(limit(proto.bounties));
  });

  it('⚠️ `Cache-Control: public, max-age=300` es OBLIGATORIO por contrato, no una optimización', () => {
    const headers = Reflect.getMetadata('__headers__', proto.quotePolicy) as
      | { name: string; value: string }[]
      | undefined;
    expect(headers).toBeDefined();
    const cc = headers?.find((h) => h.name.toLowerCase() === 'cache-control');
    expect(cc?.value).toBe('public, max-age=300');
    // Y NO es `no-store`: es un entero sin PII, idéntico para todos y pedido en cada visita —
    // cacheable también en CDN, sin `Vary` por sesión y sin variante autenticada.
    expect(cc?.value).not.toMatch(/no-store|private/);
  });

  it('READ-ONLY ESTRICTO: no toca Prisma, así que no persiste, no escala pendientes ni mueve dinero', async () => {
    // Doctrina v1.12 de endpoints anónimos. El servicio recibe un `prisma` VACÍO: si el método
    // intentara escribir (o leer) cualquier tabla, reventaría aquí.
    const svc = buildService(50000);
    await expect(svc.quotePolicy()).resolves.toBeDefined();
  });

  it('no acepta query params ni body (la firma no tiene argumentos)', () => {
    expect(proto.quotePolicy).toHaveLength(0);
  });
});
