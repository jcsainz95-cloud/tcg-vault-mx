import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  StripeService,
  StripeWebhookSecretMissingError,
} from '../src/modules/payments/stripe.service';
import { WebhooksController } from '../src/modules/payments/webhooks.controller';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { BusinessException } from '../src/common/business.exception';

/**
 * P-WH-1 (pentest ALTA, explotado LIVE-DB) — **el candado de la firma del webhook**.
 *
 * El agujero: `constructEvent` hacía `config.get('STRIPE_WEBHOOK_SECRET') ?? ''`, así que con el
 * secreto ausente la "verificación" era un HMAC de **clave vacía**, computable por cualquiera. El
 * pentester forjó un `payment_intent.succeeded`, dejó el pedido `settled` y movió la carta a la
 * bóveda del comprador **sin cobro**.
 *
 * Este spec no prueba "la línea": prueba **el ataque**. El caso central (`ATAQUE`) firma un evento
 * de dinero real con clave vacía —exactamente el PoC— y exige que NO se acepte y que el handler de
 * dinero NUNCA corra. Restaurar el `?? ''` en `constructEvent` pone estos casos en ROJO.
 *
 * Los controles positivos existen para que el candado **también pueda ponerse verde**: con un
 * secreto de verdad, una firma buena sigue verificando y una firma mala sigue dando 400.
 */

/** ConfigService de mentira: solo lo que StripeService le pregunta. */
const cfg = (env: Record<string, string | undefined>) =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;

/** Firma al estilo Stripe (`t=…,v1=HMAC`). Con `secret: ''` es LA firma del atacante. */
const signWith = (payload: string, secret: string) =>
  new Stripe('sk_test_dummy', {
    apiVersion: '2024-06-20' as Stripe.LatestApiVersion,
  }).webhooks.generateTestHeaderString({ payload, secret });

/** Un `payment_intent.succeeded` que CUADRA con una orden: el evento que liquida y transfiere. */
const moneyEvent = (paymentIntentId = 'pi_forge_poc', amountCents = 133400) =>
  JSON.stringify({
    id: 'evt_forge_poc',
    object: 'event',
    api_version: '2024-06-20',
    created: Math.floor(Date.now() / 1000),
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: paymentIntentId,
        object: 'payment_intent',
        amount: amountCents,
        amount_received: amountCents,
        currency: 'mxn',
      },
    },
  });

/** Los tres sabores de "no hay secreto" que el `?? ''` trataba como clave válida. */
const NO_SECRET: [string, string | undefined][] = [
  ['ausente', undefined],
  ['cadena vacía', ''],
  ['solo espacios', '   '],
];

describe('P-WH-1 — la firma del webhook NO se verifica con clave vacía', () => {
  describe('ATAQUE — evento de dinero forjado y firmado con clave vacía', () => {
    it.each(NO_SECRET)(
      'secreto %s: el evento forjado NO se acepta y el handler de dinero NUNCA corre',
      async (_label, secret) => {
        const payload = moneyEvent();
        // El atacante NO necesita saber nada: firma con la misma clave vacía a la que degradaba
        // el backend. Este header es literalmente el del PoC del pentester.
        const forgedHeader = signWith(payload, '');

        const stripe = new StripeService(cfg({ STRIPE_WEBHOOK_SECRET: secret }));
        const handleEvent = jest.fn();
        const payments = {
          verifyAndParse: (p: Buffer, s: string) => stripe.constructEvent(p, s),
          handleEvent,
        } as unknown as PaymentsService;
        const controller = new WebhooksController(payments);

        const req = { rawBody: Buffer.from(payload) } as never;
        const err = await controller.stripe(req, forgedHeader).then(
          () => null,
          (e: unknown) => e,
        );

        // 1) No hubo 200. El pedido no se liquida porque el evento ni siquiera se parsea.
        expect(err).toBeInstanceOf(BusinessException);
        // 2) 503, no 400: el fallo es de CONFIGURACIÓN nuestra, y un 5xx hace que Stripe
        //    reintente (un evento legítimo sobrevive al arreglo del secreto).
        expect((err as BusinessException).getStatus()).toBe(503);
        // 3) Al cable no se le confirma el estado de nuestra config.
        expect(JSON.stringify((err as BusinessException).getResponse())).not.toMatch(
          /STRIPE_WEBHOOK_SECRET/,
        );
        // 4) LO QUE IMPORTA: la lógica de dinero no se tocó. Sin esto, el 503 sería cosmético.
        expect(handleEvent).not.toHaveBeenCalled();
      },
    );

    it.each(NO_SECRET)(
      'secreto %s: `constructEvent` LANZA en vez de devolver el evento forjado',
      (_label, secret) => {
        const payload = moneyEvent();
        const stripe = new StripeService(cfg({ STRIPE_WEBHOOK_SECRET: secret }));
        expect(() => stripe.constructEvent(Buffer.from(payload), signWith(payload, ''))).toThrow(
          StripeWebhookSecretMissingError,
        );
      },
    );

    it('tampoco acepta un evento SIN firma cuando falta el secreto (el header vacío no es un atajo)', () => {
      const stripe = new StripeService(cfg({}));
      expect(() => stripe.constructEvent(Buffer.from(moneyEvent()), '')).toThrow(
        StripeWebhookSecretMissingError,
      );
    });
  });

  describe('CONTROLES — con un secreto de verdad, el candado se pone verde y rojo como debe', () => {
    const SECRET = 'whsec_un_secreto_de_verdad_para_la_suite';

    it('firma buena con el secreto real ⇒ el evento se verifica y se parsea', () => {
      const payload = moneyEvent('pi_ok', 1000);
      const stripe = new StripeService(cfg({ STRIPE_WEBHOOK_SECRET: SECRET }));
      const event = stripe.constructEvent(Buffer.from(payload), signWith(payload, SECRET));
      expect(event.type).toBe('payment_intent.succeeded');
      expect((event.data.object as { id: string }).id).toBe('pi_ok');
    });

    it('firma de CLAVE VACÍA contra un backend con secreto real ⇒ falla la verificación (no es el fallo de config)', () => {
      const payload = moneyEvent();
      const stripe = new StripeService(cfg({ STRIPE_WEBHOOK_SECRET: SECRET }));
      let thrown: unknown;
      try {
        stripe.constructEvent(Buffer.from(payload), signWith(payload, ''));
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(Stripe.errors.StripeSignatureVerificationError);
      expect(thrown).not.toBeInstanceOf(StripeWebhookSecretMissingError);
    });

    it('firma inválida con secreto real ⇒ 400 VALIDATION_ERROR (contrato §9), NO 503', async () => {
      const payload = moneyEvent();
      const stripe = new StripeService(cfg({ STRIPE_WEBHOOK_SECRET: SECRET }));
      const handleEvent = jest.fn();
      const controller = new WebhooksController({
        verifyAndParse: (p: Buffer, s: string) => stripe.constructEvent(p, s),
        handleEvent,
      } as unknown as PaymentsService);

      const err = await controller
        .stripe({ rawBody: Buffer.from(payload) } as never, 't=1,v1=deadbeef')
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect((err as BusinessException).getStatus()).toBe(400);
      expect(handleEvent).not.toHaveBeenCalled();
    });

    it('firma buena con secreto real ⇒ 200 y el handler SÍ corre (el candado no está soldado)', async () => {
      const payload = moneyEvent('pi_ok', 1000);
      const stripe = new StripeService(cfg({ STRIPE_WEBHOOK_SECRET: SECRET }));
      const handleEvent = jest.fn();
      const controller = new WebhooksController({
        verifyAndParse: (p: Buffer, s: string) => stripe.constructEvent(p, s),
        handleEvent,
      } as unknown as PaymentsService);

      const res = await controller.stripe(
        { rawBody: Buffer.from(payload) } as never,
        signWith(payload, SECRET),
      );
      expect(res).toEqual({ received: true });
      expect(handleEvent).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * El fail-fast de arranque ya NO se condiciona a `NODE_ENV` (era la mitad del hallazgo: staging y
   * dev con Stripe real arrancaban sin secreto). Se condiciona al HECHO relevante: si hay Stripe
   * cableado, el secreto es obligatorio.
   */
  describe('arranque — fail-fast por «hay Stripe», no por «es producción»', () => {
    const ENVS = ['production', 'staging', 'development', 'test', 'local', undefined];

    it.each(ENVS)('NODE_ENV=%s: con STRIPE_SECRET_KEY y sin secreto de webhook, NO arranca', (nodeEnv) => {
      const svc = new StripeService(
        cfg({ NODE_ENV: nodeEnv, STRIPE_SECRET_KEY: 'sk_test_algo', STRIPE_WEBHOOK_SECRET: '' }),
      );
      expect(() => svc.onModuleInit()).toThrow(/STRIPE_WEBHOOK_SECRET/);
    });

    it.each(ENVS)('NODE_ENV=%s: con Stripe cableado y secreto de solo espacios, NO arranca', (nodeEnv) => {
      const svc = new StripeService(
        cfg({ NODE_ENV: nodeEnv, STRIPE_SECRET_KEY: 'sk_test_algo', STRIPE_WEBHOOK_SECRET: '  ' }),
      );
      expect(() => svc.onModuleInit()).toThrow(/STRIPE_WEBHOOK_SECRET/);
    });

    it.each(ENVS)('NODE_ENV=%s: con ambas claves, arranca', (nodeEnv) => {
      const svc = new StripeService(
        cfg({ NODE_ENV: nodeEnv, STRIPE_SECRET_KEY: 'sk_test_algo', STRIPE_WEBHOOK_SECRET: 'whsec_x' }),
      );
      expect(() => svc.onModuleInit()).not.toThrow();
    });

    it('producción sin NINGUNA clave sigue sin arrancar (B6 intacto)', () => {
      const svc = new StripeService(cfg({ NODE_ENV: 'production' }));
      expect(() => svc.onModuleInit()).toThrow(/STRIPE_SECRET_KEY.*STRIPE_WEBHOOK_SECRET/);
    });

    /**
     * **La asimetría deliberada.** El arnés local/CI tiene que poder correr SIN Stripe: «no hay
     * proveedor de pago» ≠ «acepto cualquier firma». Arranca — y aun así el webhook falla cerrado.
     */
    it.each(['development', 'test', 'local', undefined])(
      'NODE_ENV=%s SIN Stripe: arranca (arnés sin proveedor) pero el webhook sigue fallando CERRADO',
      (nodeEnv) => {
        const svc = new StripeService(cfg({ NODE_ENV: nodeEnv }));
        expect(() => svc.onModuleInit()).not.toThrow();
        const payload = moneyEvent();
        expect(() => svc.constructEvent(Buffer.from(payload), signWith(payload, ''))).toThrow(
          StripeWebhookSecretMissingError,
        );
      },
    );
  });
});
