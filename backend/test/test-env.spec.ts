import { isSchedulerDisabled, isTestEnv, isThrottlerDisabled } from '../src/config/test-env';

/**
 * `config/test-env.ts` es el ÚNICO punto donde el código de producción se comporta distinto por
 * estar bajo la suite. Estos tests son el candado: verifican que **ninguna** env var puede apagar
 * el rate-limiting ni el scheduler fuera de `NODE_ENV=test` (producción/staging nunca se debilitan).
 */
describe('config/test-env — el relajo SOLO existe en NODE_ENV=test', () => {
  const prev = { ...process.env };
  afterEach(() => {
    process.env = { ...prev };
  });

  const setEnv = (nodeEnv: string | undefined, extra: Record<string, string> = {}) => {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    delete process.env.E2E_ENABLE_THROTTLER;
    delete process.env.E2E_ENABLE_SCHEDULER;
    Object.assign(process.env, extra);
  };

  it('en test: throttler y scheduler quedan omitidos (suite determinista)', () => {
    setEnv('test');
    expect(isTestEnv()).toBe(true);
    expect(isThrottlerDisabled()).toBe(true);
    expect(isSchedulerDisabled()).toBe(true);
  });

  it('en test se pueden RE-ACTIVAR explícitamente (specs que verifican el 429 real)', () => {
    setEnv('test', { E2E_ENABLE_THROTTLER: 'true', E2E_ENABLE_SCHEDULER: 'true' });
    expect(isThrottlerDisabled()).toBe(false);
    expect(isSchedulerDisabled()).toBe(false);
  });

  it.each(['production', 'staging', 'development', 'local'])(
    'en %s NUNCA se apagan, ni siquiera con las envs de escape puestas',
    (env) => {
      setEnv(env, { E2E_ENABLE_THROTTLER: 'false', E2E_ENABLE_SCHEDULER: 'false' });
      expect(isTestEnv()).toBe(false);
      expect(isThrottlerDisabled()).toBe(false);
      expect(isSchedulerDisabled()).toBe(false);
    },
  );

  it('sin NODE_ENV tampoco se apagan (fail-safe)', () => {
    setEnv(undefined);
    expect(isThrottlerDisabled()).toBe(false);
    expect(isSchedulerDisabled()).toBe(false);
  });
});
