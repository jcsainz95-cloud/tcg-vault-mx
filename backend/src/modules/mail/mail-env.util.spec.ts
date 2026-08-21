import 'reflect-metadata';
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
  const HIST = 'soporte@tcgvaultmx.com';
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

  it('disputes.constants: env vacía → default histórico; con valor → lo usa', () => {
    process.env.DISPUTE_EVIDENCE_CONTACT = '';
    let mod = freshImport<{ DISPUTE_EVIDENCE_CONTACT: string }>('../disputes/disputes.constants');
    expect(mod.DISPUTE_EVIDENCE_CONTACT).toBe(HIST);

    process.env.DISPUTE_EVIDENCE_CONTACT = '  soporte@tcghunt.mx ';
    mod = freshImport<{ DISPUTE_EVIDENCE_CONTACT: string }>('../disputes/disputes.constants');
    expect(mod.DISPUTE_EVIDENCE_CONTACT).toBe('soporte@tcghunt.mx');
  });

  it('guest-checkout.constants: env con espacios → default; con valor → lo usa', () => {
    process.env.DISPUTE_EVIDENCE_CONTACT = '   ';
    let mod = freshImport<{ SUPPORT_EVIDENCE_CONTACT: string }>(
      '../orders/guest-checkout.constants',
    );
    expect(mod.SUPPORT_EVIDENCE_CONTACT).toBe(HIST);

    process.env.DISPUTE_EVIDENCE_CONTACT = 'soporte@tcghunt.mx';
    mod = freshImport<{ SUPPORT_EVIDENCE_CONTACT: string }>('../orders/guest-checkout.constants');
    expect(mod.SUPPORT_EVIDENCE_CONTACT).toBe('soporte@tcghunt.mx');
  });

  it('buylist-mail.templates: cascada SUPPORT_EMAIL → DISPUTE_EVIDENCE_CONTACT → histórico, saltando vacíos', () => {
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

    // Ambas vacías → default histórico.
    process.env.SUPPORT_EMAIL = '';
    process.env.DISPUTE_EVIDENCE_CONTACT = '';
    let tpl = freshImport<Tpl>('../buylist/buylist-mail.templates');
    expect(tpl.sellItemRejectedTemplate(params, 'Vendedor', 'es').text).toContain(HIST);

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
  const DEFAULT_FROM = 'no-reply@tcgvaultmx.com';

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
});
