/**
 * C7 (v1.80) — el `deviceToken` (`ARCHITECTURE §4.57.4`; parte de C7-10). Sin infraestructura.
 * Llave = HKDF-SHA256(JWT_REFRESH_SECRET, salt "", info "tcg-hunt/device-token/v1", 32 bytes).
 */
import { hkdfSync } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DeviceTokenService } from '../src/modules/auth/device-token.service';

const config = new ConfigService({ JWT_ACCESS_SECRET: 'acc-secret', JWT_REFRESH_SECRET: 'ref-secret' });
const jwt = new JwtService({});
const svc = new DeviceTokenService(jwt, config);

describe('C7 — DeviceTokenService', () => {
  it('emite un JWT HS256 { typ: device, sub, jti } que caduca a los 90 días', async () => {
    const t = await svc.issue('user-1');
    const [h] = t.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toMatchObject({ alg: 'HS256' });
    const p = jwt.decode(t) as Record<string, unknown>;
    expect(p).toMatchObject({ typ: 'device', sub: 'user-1' });
    expect(typeof p.jti).toBe('string');
    expect((p.exp as number) - (p.iat as number)).toBe(90 * 24 * 3600);
    await expect(svc.verify(t)).resolves.toEqual({ userId: 'user-1', jti: p.jti });
  });

  it('la llave es EXACTAMENTE la HKDF del contrato (verifica con la llave derivada a mano)', async () => {
    const t = await svc.issue('user-2');
    const key = Buffer.from(hkdfSync('sha256', 'ref-secret', Buffer.alloc(0), 'tcg-hunt/device-token/v1', 32));
    await expect(jwt.verifyAsync(t, { secret: key, algorithms: ['HS256'] })).resolves.toMatchObject({ sub: 'user-2' });
  });

  it('⛔ NO verifica como refresh ni como access (separación de dominio)', async () => {
    const t = await svc.issue('user-3');
    await expect(jwt.verifyAsync(t, { secret: 'ref-secret', algorithms: ['HS256'] })).rejects.toThrow();
    await expect(jwt.verifyAsync(t, { secret: 'acc-secret', algorithms: ['HS256'] })).rejects.toThrow();
  });

  it('se IGNORA (null, sin lanzar): ausente, basura, firmado con access, con refresh tal cual, caducado, typ ajeno', async () => {
    const key = Buffer.from(hkdfSync('sha256', 'ref-secret', Buffer.alloc(0), 'tcg-hunt/device-token/v1', 32));
    const withAccess = await jwt.signAsync({ typ: 'device', sub: 'u', jti: 'j' }, { secret: 'acc-secret', algorithm: 'HS256' });
    const withRefresh = await jwt.signAsync({ typ: 'device', sub: 'u', jti: 'j' }, { secret: 'ref-secret', algorithm: 'HS256' });
    const expired = await jwt.signAsync(
      { typ: 'device', sub: 'u', jti: 'j', exp: Math.floor(Date.now() / 1000) - 10 },
      { secret: key, algorithm: 'HS256' },
    );
    const wrongTyp = await jwt.signAsync({ typ: 'refresh', sub: 'u', jti: 'j' }, { secret: key, algorithm: 'HS256' });
    const noJti = await jwt.signAsync({ typ: 'device', sub: 'u' }, { secret: key, algorithm: 'HS256' });
    for (const t of [undefined, null, '', 'basura', 'a.b.c', withAccess, withRefresh, expired, wrongTyp, noJti]) {
      await expect(svc.verify(t as string)).resolves.toBeNull();
    }
  });

  it('dos emisiones ⇒ dos jti distintos (cada dispositivo, su contador)', async () => {
    const a = (jwt.decode(await svc.issue('u')) as { jti: string }).jti;
    const b = (jwt.decode(await svc.issue('u')) as { jti: string }).jti;
    expect(a).not.toBe(b);
  });
});
