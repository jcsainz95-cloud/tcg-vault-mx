import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerStorageService } from '@nestjs/throttler';
import { AuthController } from '../src/modules/auth/auth.controller';
import { OrdersController } from '../src/modules/orders/orders.controller';
import { ShipmentsController } from '../src/modules/shipments/shipments.controller';
import { BuylistController } from '../src/modules/buylist/buylist.controller';
import { AppThrottlerGuard } from '../src/common/guards/app-throttler.guard';
import { EmailVerifiedGuard } from '../src/common/guards/email-verified.guard';
import { REQUIRE_EMAIL_VERIFIED_KEY } from '../src/common/decorators/require-email-verified.decorator';
import { APP_THROTTLERS, SIGNUP_DAY_LIMIT, SIGNUP_LIMIT_PER_MINUTE } from '../src/common/throttle/signup-throttle';
import { ACCOUNT_SETUP_TTL_HOURS, isAccountSetupPending } from '../src/modules/auth/account-setup';
import { AUTH_TOKEN_TTL_MS } from '../src/modules/auth/auth-token.service';
import { accountSetupTemplate } from '../src/modules/mail/mail.templates';
import { BusinessException } from '../src/common/business.exception';
import { SignupConflictTelemetry } from '../src/modules/auth/signup-telemetry';
import { MeEmailController } from '../src/modules/users/me-email.controller';

/**
 * 🔒 v1.117⟨cuenta-correo⟩ (API_CONTRACT §CTA) — unidades de CTA: `setupPending` (CTA.2), el guard con modo (CTA.5),
 * los throttlers `signup`/`signup-day` con reloj falso (CTA-B4, mitad de 24 h), la telemetría del `409`, TTL y plantilla.
 */

describe('CTA.2 — isAccountSetupPending', () => {
  const base = { role: 'customer', status: 'active', email: 'a@b.mx', passwordHash: null, googleId: null } as const;
  it('cliente activo con correo, sin hash y sin Google ⇒ true', () => {
    expect(isAccountSetupPending(base)).toBe(true);
  });
  it.each([
    ['con contraseña', { passwordHash: 'h' }],
    ['con Google', { googleId: 'g' }],
    ['sin correo', { email: null }],
    ['bloqueada', { status: 'blocked' }],
    ['borrada', { status: 'deleted' }],
    ['operador', { role: 'vault_operator' }],
    ['super_admin', { role: 'super_admin' }],
  ])('%s ⇒ false', (_l, patch) => {
    expect(isAccountSetupPending({ ...base, ...patch } as never)).toBe(false);
  });
  it('TTL de account_setup = 24 h (constante, no dial)', () => {
    expect(ACCOUNT_SETUP_TTL_HOURS).toBe(24);
    expect(AUTH_TOKEN_TTL_MS.account_setup).toBe(24 * 60 * 60 * 1000);
  });
});

describe('CTA.5 — EmailVerifiedGuard con modo `present | verified`', () => {
  const ctx = (user: Record<string, unknown>): ExecutionContext =>
    ({ switchToHttp: () => ({ getRequest: () => ({ user }) }), getHandler: () => ({}), getClass: () => ({}) }) as unknown as ExecutionContext;
  const guardWith = (meta: unknown) => {
    const r = new Reflector();
    jest.spyOn(r, 'getAllAndOverride').mockReturnValue(meta);
    return new EmailVerifiedGuard(r);
  };
  const codeOf = (fn: () => unknown) => {
    try {
      fn();
      return 'pasa';
    } catch (e) {
      return (e as BusinessException).code;
    }
  };

  it("'present': cuenta con correo sin verificar pasa; sin correo ⇒ ACCOUNT_WITHOUT_EMAIL (STF-28)", () => {
    const g = guardWith('present');
    expect(codeOf(() => g.canActivate(ctx({ hasEmail: true, emailVerified: false })))).toBe('pasa');
    expect(codeOf(() => g.canActivate(ctx({ hasEmail: false, emailVerified: false })))).toBe('ACCOUNT_WITHOUT_EMAIL');
  });
  it.each([['verified'], [true]])("%p: sin verificar ⇒ EMAIL_NOT_VERIFIED; sin correo ⇒ ACCOUNT_WITHOUT_EMAIL; verificada pasa", (meta) => {
    const g = guardWith(meta);
    expect(codeOf(() => g.canActivate(ctx({ hasEmail: true, emailVerified: false })))).toBe('EMAIL_NOT_VERIFIED');
    expect(codeOf(() => g.canActivate(ctx({ hasEmail: false, emailVerified: false })))).toBe('ACCOUNT_WITHOUT_EMAIL');
    expect(codeOf(() => g.canActivate(ctx({ hasEmail: true, emailVerified: true })))).toBe('pasa');
  });
  it('las cinco rutas: checkout/session = present; claimable, claim, shipments y buylist/requests = verified', () => {
    const meta = (fn: unknown) => Reflect.getMetadata(REQUIRE_EMAIL_VERIFIED_KEY, fn as object);
    expect(meta(OrdersController.prototype.session)).toBe('present');
    expect(meta(OrdersController.prototype.claimable)).toBe('verified');
    expect(meta(OrdersController.prototype.claim)).toBe('verified');
    expect(meta(ShipmentsController.prototype.create)).toBe('verified');
    expect(meta(BuylistController.prototype.create)).toBe('verified');
  });
});

describe('CTA-B4 (reloj falso) — throttlers `signup` (compartido, 5/min) y `signup-day` (30/24 h, solo email-only)', () => {
  let prevEnv: string | undefined;
  beforeEach(() => {
    prevEnv = process.env.E2E_ENABLE_THROTTLER;
    process.env.E2E_ENABLE_THROTTLER = 'true';
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    if (prevEnv === undefined) delete process.env.E2E_ENABLE_THROTTLER;
    else process.env.E2E_ENABLE_THROTTLER = prevEnv;
  });

  async function makeGuard() {
    const storage = new ThrottlerStorageService();
    const g = new AppThrottlerGuard(APP_THROTTLERS, storage, new Reflector());
    await g.onModuleInit();
    return { g, storage };
  }
  /** `handler` de `AuthController`, o `'patchEmail'` = `PATCH /users/me/email` (`MeEmailController.correctEmail`). */
  type Handler = keyof AuthController | 'patchEmail';
  const ctxFor = (handler: Handler, ip: string): ExecutionContext => {
    const res = { header: jest.fn(), setHeader: jest.fn() };
    const patch = handler === 'patchEmail';
    return {
      getHandler: () => (patch ? MeEmailController.prototype.correctEmail : AuthController.prototype[handler as keyof AuthController]),
      getClass: () => (patch ? MeEmailController : AuthController),
      switchToHttp: () => ({ getRequest: () => ({ ip, headers: {} }), getResponse: () => res }),
      getType: () => 'http',
    } as unknown as ExecutionContext;
  };
  const hit = async (g: AppThrottlerGuard, handler: Handler, ip: string) => {
    try {
      await g.canActivate(ctxFor(handler, ip));
      return 'ok';
    } catch (e) {
      if (e instanceof ThrottlerException) return '429';
      throw e;
    }
  };

  it('los límites son los del contrato', () => {
    expect(SIGNUP_LIMIT_PER_MINUTE).toBe(5);
    expect(SIGNUP_DAY_LIMIT).toBe(30);
  });

  it('3 register + 2 email-only en un minuto ⇒ el 6.º (cualquiera) 429; al pasar el minuto vuelve a pasar', async () => {
    const { g } = await makeGuard();
    const seqs: string[] = [];
    for (let i = 0; i < 3; i += 1) seqs.push(await hit(g, 'register', '1.1.1.1'));
    for (let i = 0; i < 2; i += 1) seqs.push(await hit(g, 'registerEmailOnly', '1.1.1.1'));
    seqs.push(await hit(g, 'register', '1.1.1.1'));
    expect(seqs).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', '429']);
    expect(await hit(g, 'registerEmailOnly', '1.1.1.1')).toBe('429');
    expect(await hit(g, 'registerEmailOnly', '2.2.2.2')).toBe('ok');
    jest.advanceTimersByTime(61_000);
    expect(await hit(g, 'registerEmailOnly', '1.1.1.1')).toBe('ok');
  });

  it('30 email-only en 24 h (uno cada 61 s) pasan y el 31.º es 429; register no cuenta en el techo diario; tras 24 h vuelve', async () => {
    const { g } = await makeGuard();
    const out: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      out.push(await hit(g, 'registerEmailOnly', '3.3.3.3'));
      jest.advanceTimersByTime(61_000);
    }
    expect(out.every((s) => s === 'ok')).toBe(true);
    expect(await hit(g, 'registerEmailOnly', '3.3.3.3')).toBe('429');
    // register no lleva `signup-day` (y su `signup` está limpio tras el minuto).
    jest.advanceTimersByTime(61_000);
    expect(await hit(g, 'register', '3.3.3.3')).toBe('ok');
    jest.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(await hit(g, 'registerEmailOnly', '3.3.3.3')).toBe('ok');
  });

  // 🔒 CTA-B17 (v1.117.2, PT-CTA-3, D-CTA-13): el PATCH del correo gasta los MISMOS cubos que el alta.
  it('CTA-B17 — misma IP: 3 register + 2 email-only ⇒ el PATCH siguiente 429; y un PATCH gasta el cubo de un alta', async () => {
    const { g } = await makeGuard();
    const seqs: string[] = [];
    for (let i = 0; i < 3; i += 1) seqs.push(await hit(g, 'register', '5.5.5.5'));
    for (let i = 0; i < 2; i += 1) seqs.push(await hit(g, 'registerEmailOnly', '5.5.5.5'));
    expect(seqs).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(await hit(g, 'patchEmail', '5.5.5.5')).toBe('429');
    for (let i = 0; i < 5; i += 1) expect(await hit(g, 'patchEmail', '5.5.5.6')).toBe('ok');
    expect(await hit(g, 'registerEmailOnly', '5.5.5.6')).toBe('429');
  });

  it('CTA-B17 — 30 entre email-only y PATCH en 24 h (uno cada 61 s) pasan; el 31.º (cualquiera de los dos) 429', async () => {
    const { g } = await makeGuard();
    const outs: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      outs.push(await hit(g, i % 2 === 0 ? 'registerEmailOnly' : 'patchEmail', '6.6.6.6'));
      jest.advanceTimersByTime(61_000);
    }
    expect(outs.every((x) => x === 'ok')).toBe(true);
    expect(await hit(g, 'patchEmail', '6.6.6.6')).toBe('429');
    expect(await hit(g, 'registerEmailOnly', '6.6.6.6')).toBe('429');
  });

  it('otras rutas (login) no gastan el cubo signup', async () => {
    const { g } = await makeGuard();
    for (let i = 0; i < 4; i += 1) expect(await hit(g, 'login', '4.4.4.4')).toBe('ok');
    for (let i = 0; i < 5; i += 1) expect(await hit(g, 'registerEmailOnly', '4.4.4.4')).toBe('ok');
  });
});

describe('CTA.4 — telemetría del 409 (warn agregado por IP, sin correos)', () => {
  it('más de 10 409 desde una IP en 24 h ⇒ UN warn con 12 caracteres del HMAC; nada de la IP en claro', () => {
    const warn = jest.fn();
    const t = new SignupConflictTelemetry((ip) => `hmac-of-${ip}-padding-xxxxxxxx`, { warn });
    for (let i = 0; i < 10; i += 1) t.record('9.9.9.9', 1_000 + i);
    expect(warn).not.toHaveBeenCalled();
    t.record('9.9.9.9', 2_000);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('hmac-of-9.9.');
    expect(line).not.toContain('9.9.9.9-');
    t.record('9.9.9.9', 3_000);
    expect(warn).toHaveBeenCalledTimes(1);
    // Fuera de la ventana de 24 h se olvidan.
    for (let i = 0; i < 10; i += 1) t.record('9.9.9.9', 2_000 + 25 * 3_600_000 + i);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('CTA.6 — plantilla «Termina tu cuenta» (ES/EN)', () => {
  const LINK = 'https://tienda.example.test/es/account-setup?token=abc';
  it.each([['es'], ['en']])('%s: dice qué es, un uso, 24 h, ignorar si no fue él; lleva el enlace; sin datos de pedido', (l) => {
    const m = accountSetupTemplate(LINK, null, l);
    const body = `${m.subject}\n${m.text}\n${m.html}`;
    expect(m.html).toContain(LINK.replace(/&/g, '&amp;'));
    expect(m.text).toContain(LINK);
    if (l === 'es') {
      expect(m.subject).toBe('Termina tu cuenta');
      expect(body).toMatch(/24 horas/);
      expect(body).toMatch(/una sola vez/);
      expect(body).toMatch(/ignora/i);
    } else {
      expect(m.subject).toBe('Finish your account');
      expect(body).toMatch(/24 hours/);
      expect(body).toMatch(/only once/);
      expect(body).toMatch(/ignore/i);
    }
    expect(body).not.toMatch(/pedido|order #|\$|MX\$|total/i);
  });
});
