/**
 * C-B9 (unidad) — `POST /measurement/banner-response` (API_CONTRACT §MKT.H.3/.11). La mitad Postgres real (incremento de
 * la celda con `utmMedium` NULL, 204 sin escribir con `off`, 31.ª petición ⇒ 429 con el throttler real) está en
 * `test/integration/measurement.e2e-spec.ts`.
 */
import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { MeasurementController, BANNER_RESPONSE_THROTTLE } from '../src/modules/measurement/measurement.controller';
import {
  BannerResponseService,
  bannerUtmMedium,
  deviceFromUserAgent,
  weekStartMx,
} from '../src/modules/measurement/banner-response.service';
import { MeasurementService } from '../src/modules/measurement/measurement.service';
import { fakeConfig, fullEnv } from './helpers/measurement-fixtures';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Instagram 300.0';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const ANDROID_TAB = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

function world(mode: string | undefined) {
  const writes: { op: string; arg: unknown }[] = [];
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    marketingBannerConsentCounter: {
      updateMany: jest.fn(async (arg: unknown) => (writes.push({ op: 'updateMany', arg }), { count: 0 })),
      create: jest.fn(async (arg: unknown) => (writes.push({ op: 'create', arg }), {})),
    },
  };
  const prisma = { $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) };
  const measurement = new MeasurementService(prisma as never, fakeConfig(fullEnv({ MEASUREMENT_MODE: mode })));
  return { svc: new BannerResponseService(prisma as never, measurement), prisma, writes };
}

describe('C-B9 · utmMedium fuera de los cuatro ⇒ null; el UA no se guarda', () => {
  it.each([['bio', 'bio'], ['story', 'story'], ['paid', 'paid'], ['dm', 'dm'], ['BIO', null], ['email', null], ['', null], [5, null], [undefined, null], [['bio'], null]])(
    'utmMedium %p ⇒ %p',
    (v, out) => expect(bannerUtmMedium(v)).toBe(out),
  );
  it.each([
    [IPHONE, 'móvil'],
    [ANDROID_PHONE, 'móvil'],
    [IPAD, 'tableta'],
    [ANDROID_TAB, 'tableta'],
    [DESKTOP, 'escritorio'],
    ['', null],
    [undefined, null],
  ])('device de %p ⇒ %p', (ua, d) => expect(deviceFromUserAgent(ua)).toBe(d));

  it('on: escribe UNA celda con utmMedium null y device derivado; ninguna columna lleva el UA ni la IP', async () => {
    const w = world('on');
    await expect(w.svc.record('custom', 'newsletter', IPHONE, new Date('2026-10-18T05:00:00Z'))).resolves.toBe(true);
    expect(w.writes.map((x) => x.op)).toEqual(['updateMany', 'create']);
    const created = (w.writes[1].arg as { data: Record<string, unknown> }).data;
    expect(created).toEqual({
      weekStart: new Date('2026-10-12T00:00:00.000Z'),
      response: 'custom',
      utmMedium: null,
      device: 'móvil',
      count: 1,
    });
    expect(JSON.stringify(w.writes)).not.toContain('iPhone');
    expect(JSON.stringify(w.writes)).not.toContain('Mozilla');
  });

  it('off: 0 escrituras (y ni abre transacción)', async () => {
    for (const mode of [undefined, '', 'ON']) {
      const w = world(mode);
      await expect(w.svc.record('accept', 'bio', IPHONE)).resolves.toBe(false);
      expect(w.prisma.$transaction).not.toHaveBeenCalled();
    }
  });

  it('un fallo de BD no lanza (el 204 no cambia)', async () => {
    const w = world('on');
    w.prisma.$transaction.mockRejectedValueOnce(new Error('caída'));
    await expect(w.svc.record('accept', 'bio', IPHONE)).resolves.toBe(false);
  });

  it('weekStart = lunes CDMX (domingo 23:30 CDMX sigue siendo la semana del lunes anterior)', () => {
    // 2026-10-19 05:30Z = domingo 18 23:30 en CDMX (UTC-6).
    expect(weekStartMx(new Date('2026-10-19T05:30:00Z')).toISOString()).toBe('2026-10-12T00:00:00.000Z');
    expect(weekStartMx(new Date('2026-10-19T06:30:00Z')).toISOString()).toBe('2026-10-19T00:00:00.000Z');
  });

  it('el handler es público, 204 y limitado a 30 por HORA', () => {
    const fn = MeasurementController.prototype.bannerResponse;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', fn)).toBe(30);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', fn)).toBe(3_600_000);
    expect(BANNER_RESPONSE_THROTTLE).toEqual({ default: { ttl: 3_600_000, limit: 30 } });
    expect(Reflect.getMetadata('__httpCode__', fn)).toBe(204);
  });
});

describe('QA M1 · §MKT.H.3 «400 body sin forma»: claves desconocidas ⇒ 400, también tras el ValidationPipe GLOBAL de main.ts', () => {
  // El mismo pipe global que `main.ts` (whitelist SIN forbidNonWhitelisted): si el handler confiara en él, `extra` se
  // borraría en silencio y respondería 204.
  const globalPipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false });
  const metatype = (Reflect.getMetadata('design:paramtypes', MeasurementController.prototype, 'bannerResponse') as unknown[])[0];
  /** Pipe global + handler, como el cable: el 400 puede salir de cualquiera de los dos. */
  const call = (body: unknown) => {
    const record = jest.fn(async () => true);
    const ctrl = new MeasurementController({ record } as never);
    const out = (async () => ctrl.bannerResponse((await globalPipe.transform(body, { type: 'body', metatype: metatype as never, data: '' })) as never, IPHONE))();
    return { record, out };
  };

  it.each([[{ response: 'accept', extra: 1 }], [{ response: 'accept', utmMedium: 'bio', email: 'a@b.mx' }]])('%j ⇒ 400 y no escribe', async (body) => {
    const { record, out } = call(body);
    await expect(out).rejects.toBeInstanceOf(BadRequestException);
    expect(record).not.toHaveBeenCalled();
  });

  it.each([[{ response: 'accept' }], [{ response: 'custom', utmMedium: 'raro' }]])('%j ⇒ 204 (sin cuerpo) y registra', async (body) => {
    const { record, out } = call(body);
    await expect(out).resolves.toBeUndefined();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it.each([[{ response: 'si' }], [[{ response: 'accept' }]], [null], ['accept']])('sin forma %j ⇒ 400', async (body) => {
    const { out } = call(body);
    await expect(out).rejects.toBeInstanceOf(BadRequestException);
  });
});
