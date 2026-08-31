import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { envOr } from './mail-env.util';

/**
 * P-21 (ronda de cierre, condición techlead) — robustez de env VACÍA en las lecturas de correo.
 * `??` no cubre cadena vacía: con `MAIL_FROM=` el `from` salía `''` (Resend rechaza TODO) y con
 * `DISPUTE_EVIDENCE_CONTACT=` la API exponía `evidenceContact: ""`. `envOr` trata vacío/blanco
 * como ausente. Aquí se prueba el helper puro y sus 4 consumidores (constantes import-time vía
 * `jest.isolateModules` y la factory de `MailModule` vía ConfigService stub).
 */
describe('P-21 cierre — envOr (env vacía/blanca cae al default)', () => {
  const FALLBACK = 'default@example.com';

  it('env ausente (undefined/null) cae al default', () => {
    expect(envOr(undefined, FALLBACK)).toBe(FALLBACK);
    expect(envOr(null, FALLBACK)).toBe(FALLBACK);
  });

  it('env definida pero VACÍA cae al default', () => {
    expect(envOr('', FALLBACK)).toBe(FALLBACK);
  });

  it('env definida pero solo espacios/blancos cae al default', () => {
    expect(envOr('   ', FALLBACK)).toBe(FALLBACK);
    expect(envOr('\t\n', FALLBACK)).toBe(FALLBACK);
  });

  it('env con valor real lo usa (y lo devuelve saneado con trim)', () => {
    expect(envOr('soporte@tcghunt.mx', FALLBACK)).toBe('soporte@tcghunt.mx');
    expect(envOr('  soporte@tcghunt.mx  ', FALLBACK)).toBe('soporte@tcghunt.mx');
    expect(envOr('TCG HUNT <no-reply@tcghunt.mx>', FALLBACK)).toBe(
      'TCG HUNT <no-reply@tcghunt.mx>',
    );
  });
});

describe('P-21 cierre — consumidores import-time de envOr', () => {
  /**
   * VALOR CORRECTO del default de soporte tras la migración P-21 (ago-2026): el buzón
   * `@tcghunt.mx` ya recibe correo, que era la condición para moverlo. El histórico
   * `soporte@tcgvaultmx.com` es un buzón MUERTO — si alguien ve fallar este test, la corrección
   * es alinear el test al dominio vivo, NUNCA devolver el código al dominio viejo.
   */
  const DEFAULT_SUPPORT = 'soporte@tcghunt.mx';
  const ENV_KEYS = ['DISPUTE_EVIDENCE_CONTACT', 'SUPPORT_EMAIL'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  /** Re-evalúa el módulo con el process.env actual (las constantes se fijan al importar). */
  function freshImport<T>(path: string): T {
    let mod!: T;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require(path) as T;
    });
    return mod;
  }

  it('disputes.constants: env vacía → default vivo (soporte@tcghunt.mx); con valor → lo usa', () => {
    process.env.DISPUTE_EVIDENCE_CONTACT = '';
    let mod = freshImport<{ DISPUTE_EVIDENCE_CONTACT: string }>('../disputes/disputes.constants');
    expect(mod.DISPUTE_EVIDENCE_CONTACT).toBe(DEFAULT_SUPPORT);

    process.env.DISPUTE_EVIDENCE_CONTACT = '  soporte@tcghunt.mx ';
    mod = freshImport<{ DISPUTE_EVIDENCE_CONTACT: string }>('../disputes/disputes.constants');
    expect(mod.DISPUTE_EVIDENCE_CONTACT).toBe('soporte@tcghunt.mx');
  });

  it('guest-checkout.constants: env con espacios → default vivo (soporte@tcghunt.mx); con valor → lo usa', () => {
    process.env.DISPUTE_EVIDENCE_CONTACT = '   ';
    let mod = freshImport<{ SUPPORT_EVIDENCE_CONTACT: string }>(
      '../orders/guest-checkout.constants',
    );
    expect(mod.SUPPORT_EVIDENCE_CONTACT).toBe(DEFAULT_SUPPORT);

    process.env.DISPUTE_EVIDENCE_CONTACT = 'soporte@tcghunt.mx';
    mod = freshImport<{ SUPPORT_EVIDENCE_CONTACT: string }>('../orders/guest-checkout.constants');
    expect(mod.SUPPORT_EVIDENCE_CONTACT).toBe('soporte@tcghunt.mx');
  });

  it('buylist-mail.templates: cascada SUPPORT_EMAIL → DISPUTE_EVIDENCE_CONTACT → default vivo, saltando vacíos', () => {
    type Tpl = {
      sellItemRejectedTemplate: (
        params: {
          cardName: string;
          setName: string;
          cardNumber: string;
          finish: string;
          reason: string;
          returnDeadlineAt: Date | null;
          abandonDeadlineAt: Date | null;
        },
        name: string,
        locale?: string | null,
      ) => { text: string };
    };
    const params = {
      cardName: 'Pikachu',
      setName: 'Base',
      cardNumber: '58/102',
      finish: 'normal',
      reason: 'dañada',
      returnDeadlineAt: null,
      abandonDeadlineAt: null,
    };

    // Ambas vacías → default de código = buzón VIVO (P-21 migrado), no el histórico muerto.
    process.env.SUPPORT_EMAIL = '';
    process.env.DISPUTE_EVIDENCE_CONTACT = '';
    let tpl = freshImport<Tpl>('../buylist/buylist-mail.templates');
    expect(tpl.sellItemRejectedTemplate(params, 'Vendedor', 'es').text).toContain(DEFAULT_SUPPORT);

    // SUPPORT_EMAIL en blanco pero DISPUTE_EVIDENCE_CONTACT con valor → cae en cascada al segundo.
    process.env.SUPPORT_EMAIL = '   ';
    process.env.DISPUTE_EVIDENCE_CONTACT = 'soporte@tcghunt.mx';
    tpl = freshImport<Tpl>('../buylist/buylist-mail.templates');
    expect(tpl.sellItemRejectedTemplate(params, 'Vendedor', 'es').text).toContain(
      'soporte@tcghunt.mx',
    );

    // SUPPORT_EMAIL con valor → gana sobre la cascada.
    process.env.SUPPORT_EMAIL = 'buylist@tcghunt.mx';
    tpl = freshImport<Tpl>('../buylist/buylist-mail.templates');
    expect(tpl.sellItemRejectedTemplate(params, 'Vendedor', 'es').text).toContain(
      'buylist@tcghunt.mx',
    );
  });
});

describe('P-21 cierre — factory de MailModule (MAIL_FROM vacía → default)', () => {
  /**
   * VALOR CORRECTO del remitente por defecto tras la migración P-21 (ago-2026). Este default
   * gobierna el remitente de TODOS los correos transaccionales cuando `MAIL_FROM` no está fijada:
   * si apuntara al histórico `no-reply@tcgvaultmx.com` (dominio ya no verificado en Resend),
   * Resend rechazaría cada envío y nadie recibiría verificación de email, reset de contraseña ni
   * confirmación de pedido. Si este test falla, alinea el test al dominio vivo — NUNCA el código
   * al dominio muerto.
   */
  const DEFAULT_FROM = 'no-reply@tcghunt.mx';

  /** Extrae la factory del provider MAIL_PORT de la metadata del módulo (sin levantar Nest). */
  function getMailPortFactory(): (config: {
    get: (key: string) => string | undefined;
  }) => unknown {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MailModule } = require('./mail.module') as { MailModule: unknown };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MAIL_PORT } = require('./mail.port') as { MAIL_PORT: unknown };
    const providers = Reflect.getMetadata('providers', MailModule as object) as Array<{
      provide?: unknown;
      useFactory?: (config: unknown) => unknown;
    }>;
    const provider = providers.find((p) => p.provide === MAIL_PORT);
    if (!provider?.useFactory) throw new Error('MAIL_PORT factory no encontrada');
    return provider.useFactory as (config: {
      get: (key: string) => string | undefined;
    }) => unknown;
  }

  function stubConfig(env: Record<string, string | undefined>) {
    return { get: (key: string) => env[key] };
  }

  it('MAIL_FROM definida pero vacía → from = default (Resend rechazaría from="")', () => {
    const adapter = getMailPortFactory()(
      stubConfig({ RESEND_API_KEY: 're_test_key', MAIL_FROM: '' }),
    ) as { from?: string };
    expect(adapter.constructor.name).toBe('ResendMailAdapter');
    expect(adapter.from).toBe(DEFAULT_FROM);
  });

  it('MAIL_FROM solo espacios → from = default', () => {
    const adapter = getMailPortFactory()(
      stubConfig({ RESEND_API_KEY: 're_test_key', MAIL_FROM: '   ' }),
    ) as { from?: string };
    expect(adapter.from).toBe(DEFAULT_FROM);
  });

  it('MAIL_FROM con valor → lo usa', () => {
    const adapter = getMailPortFactory()(
      stubConfig({ RESEND_API_KEY: 're_test_key', MAIL_FROM: 'TCG HUNT <no-reply@tcghunt.mx>' }),
    ) as { from?: string };
    expect(adapter.from).toBe('TCG HUNT <no-reply@tcghunt.mx>');
  });

  /**
   * P-21: con envío REAL y sin `MAIL_FROM`, el remitente lo decide el default de código. Si ese
   * dominio no estuviera verificado en Resend, TODOS los envíos fallarían y el síntoma llega tarde
   * (un usuario que nunca recibió su correo). El arranque lo avisa para que sea visible en el log.
   */
  it('sin MAIL_FROM avisa en el arranque de que el remitente sale del default de código', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const adapter = getMailPortFactory()(
        stubConfig({ RESEND_API_KEY: 're_test_key' }),
      ) as { from?: string };
      expect(adapter.from).toBe(DEFAULT_FROM);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('MAIL_FROM no está fijada'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(DEFAULT_FROM));
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });

  it('con MAIL_FROM fijada NO avisa (el remitente es explícito del entorno)', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      getMailPortFactory()(
        stubConfig({ RESEND_API_KEY: 're_test_key', MAIL_FROM: 'TCG HUNT <no-reply@tcghunt.mx>' }),
      );
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });
});

/**
 * P-21 — RED ANTI-REGRESIÓN del rebrand de dominio (ago-2026).
 *
 * Contexto para quien lea esto en el futuro: el proyecto arrastró tres dominios —
 * `tcgvaultmx.com` y `tcgvault.mx` (AMBOS MUERTOS, del nombre viejo) y `tcghunt.mx` (el VIVO, la
 * marca real "TCG HUNT"). Los defaults de código de correo apuntaban al muerto porque el buzón
 * nuevo aún no existía; el humano confirmó que ya recibe correo y la migración se cerró.
 *
 * Este bloque falla si CUALQUIER default de correo vuelve a un dominio muerto. Consecuencia real
 * de esa regresión: Resend rechaza remitentes de dominio no verificado ⇒ ningún correo
 * transaccional sale, y los canales de soporte publicados al cliente apuntan a buzones que nadie
 * lee. Si falla: la corrección va SIEMPRE en dirección al dominio vivo `tcghunt.mx`.
 */
describe('P-21 — ningún default de correo apunta a un dominio muerto', () => {
  const DEAD_DOMAINS = ['tcgvaultmx.com', 'tcgvault.mx'];
  const LIVE_DOMAIN = 'tcghunt.mx';

  const ENV_KEYS = ['MAIL_FROM', 'DISPUTE_EVIDENCE_CONTACT', 'SUPPORT_EMAIL'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k]; // sin envs: se ejercita el DEFAULT DE CÓDIGO, que es lo que se prueba.
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function freshRequire<T>(path: string): T {
    let mod!: T;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require(path) as T;
    });
    return mod;
  }

  function expectLive(value: string) {
    for (const dead of DEAD_DOMAINS) expect(value).not.toContain(dead);
    expect(value).toContain(LIVE_DOMAIN);
  }

  it('remitente por defecto de TODOS los correos (MailModule) usa el dominio vivo', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MailModule } = require('./mail.module') as { MailModule: object };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MAIL_PORT } = require('./mail.port') as { MAIL_PORT: unknown };
    const providers = Reflect.getMetadata('providers', MailModule) as Array<{
      provide?: unknown;
      useFactory?: (config: unknown) => unknown;
    }>;
    const factory = providers.find((p) => p.provide === MAIL_PORT)!.useFactory! as (config: {
      get: (key: string) => string | undefined;
    }) => unknown;
    // Con RESEND_API_KEY (envío REAL) y SIN MAIL_FROM: el remitente lo pone el default de código.
    const adapter = factory({
      get: (key: string) => (key === 'RESEND_API_KEY' ? 're_test_key' : undefined),
    }) as { from?: string };
    expectLive(adapter.from!);
    jest.restoreAllMocks();
  });

  it('contacto de evidencia de disputa (API §7) usa el dominio vivo', () => {
    const mod = freshRequire<{ DISPUTE_EVIDENCE_CONTACT: string }>(
      '../disputes/disputes.constants',
    );
    expectLive(mod.DISPUTE_EVIDENCE_CONTACT);
  });

  it('contacto de soporte del pedido de invitado usa el dominio vivo', () => {
    const mod = freshRequire<{ SUPPORT_EVIDENCE_CONTACT: string }>(
      '../orders/guest-checkout.constants',
    );
    expectLive(mod.SUPPORT_EVIDENCE_CONTACT);
  });

  it('correo de soporte de la plantilla de rechazo de buylist usa el dominio vivo', () => {
    const tpl = freshRequire<{
      sellItemRejectedTemplate: (
        params: Record<string, unknown>,
        name: string,
        locale?: string | null,
      ) => { text: string };
    }>('../buylist/buylist-mail.templates');
    const { text } = tpl.sellItemRejectedTemplate(
      {
        cardName: 'Pikachu',
        setName: 'Base',
        cardNumber: '58/102',
        finish: 'normal',
        reason: 'dañada',
        returnDeadlineAt: null,
        abandonDeadlineAt: null,
      },
      'Vendedor',
      'es',
    );
    for (const dead of DEAD_DOMAINS) expect(text).not.toContain(dead);
    expect(text).toContain(`soporte@${LIVE_DOMAIN}`);
  });
});
