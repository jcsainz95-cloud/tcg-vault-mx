/**
 * card-show-contract.e2e-spec.ts — ⭐ CANDADO DE CONTRATO de la landing del Card Show contra Postgres
 * REAL y por HTTP (§CARDSHOW.3/.5/.11). Propiedad: backend; la ejecuta QA (`npm run test:integration`).
 *
 * Nace de una regresión real: el DTO exige `formToken` (`dto/card-show.dto.ts:31,54`) pero el frontend
 * mandaba `token` ⇒ el `StrictBodyPipe` (`whitelist + forbidNonWhitelisted`) devolvía `400
 * VALIDATION_ERROR` y se PERDÍAN TODAS las altas. No se cazó porque cada lado probaba contra su propio
 * mock. Este spec levanta la app Nest REAL (mismo pipe/filtro/prefijo que `main.ts`) y golpea el CONTRATO
 * de verdad — SIN mockear la validación ni la persistencia:
 *
 * | # | Qué fija |
 * |---|---|
 * | A1 | `POST /card-show/leads` con el campo CORRECTO `formToken` (emitido por `GET /form-token`, respetando el min-age de 2 s) + email/consent válidos ⇒ 202 y UNA fila PERSISTIDA `status:"pending"`, `confirmedAt` NULL |
 * | A2 | `POST /card-show/leads` con el campo VIEJO `token` (en vez de `formToken`) ⇒ 400 VALIDATION_ERROR y 0 filas ← **el candado del mismatch de nombre** |
 * | B1 | `POST /card-show/players` con `formToken` + cuerpo válido ⇒ 202 y UNA fila PERSISTIDA `status:"pending"` |
 * | B2 | `POST /card-show/players` con el campo VIEJO `token` ⇒ 400 VALIDATION_ERROR y 0 filas |
 *
 * ÚNICA sustitución de INFRA (no del contrato): `MX_RESOLVER` ⇒ `true`, para no depender de DNS externo
 * en CI (es lo mismo que `e2e-app.ts` hace con Stripe: stub OFFLINE de la llamada de red, no del flujo que
 * se mide). El transporte de correo ya es Noop en el arnés. El token se verifica con el secreto EFÍMERO
 * real del proceso: ningún mock del pipe, del servicio ni de Prisma.
 */
import { randomBytes } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { MX_RESOLVER } from '../../src/modules/card-show/card-show-mail.service';
import { FORM_TOKEN_MIN_AGE_MS } from '../../src/modules/card-show/card-show.constants';

jest.setTimeout(60_000);

const RUN = `cse2e${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('E2E — CARDSHOW contrato POST /card-show/{leads,players} (sin mocks, §CARDSHOW.3/.5/.11)', () => {
  let h: E2EHarness;

  beforeAll(async () => {
    // Sustitución SOLO de infra (DNS MX), para no depender de la red en CI. El resto del flujo es real.
    h = await E2EHarness.create((b) =>
      b.overrideProvider(MX_RESOLVER).useValue({ hasMailExchange: async () => true }),
    );
  }, 180_000);

  afterAll(async () => {
    if (!h) return;
    await h.prisma.cardShowLead.deleteMany({ where: { email: { contains: RUN } } });
    await h.prisma.cardShowPlayerSignup.deleteMany({ where: { email: { contains: RUN } } });
    await h.close();
  });

  /** Pide un token de formulario REAL emitido por el endpoint (con `iat = now`). */
  const formToken = async (purpose: 'leads' | 'players'): Promise<string> => {
    const r = await h.api('GET', `/card-show/form-token?purpose=${purpose}`);
    expect(r.status).toBe(200);
    const t = (r.body as { formToken?: string }).formToken;
    expect(typeof t).toBe('string');
    return t as string;
  };

  // El min-age (§CARDSHOW.5): un POST < 2 s tras emitir el token es «demasiado rápido para un humano» y
  // se descarta en SILENCIO (202, 0 filas). El controlador usa `Date.now()` real (no inyectable por HTTP),
  // así que hay que esperar de verdad > 2 s entre emitir el token y postear.
  const waitPastMinAge = () => sleep(FORM_TOKEN_MIN_AGE_MS + 200);

  describe('A — leads', () => {
    it('A1 — `formToken` correcto ⇒ 202 y UNA fila PERSISTIDA `status:"pending"`', async () => {
      const token = await formToken('leads');
      await waitPastMinAge();
      const email = `avisame-${RUN}@e2e-cardshow.example`;
      const res = await h.api('POST', '/card-show/leads', {
        json: { type: 'visitor', email, source: 'cta_hero', consent: true, formToken: token },
      });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ ok: true });

      const rows = await h.prisma.cardShowLead.findMany({ where: { email } });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('pending');
      expect(rows[0].confirmedAt).toBeNull();
    });

    it('A2 (CANDADO) — campo VIEJO `token` en vez de `formToken` ⇒ 400 VALIDATION_ERROR y 0 filas', async () => {
      const token = await formToken('leads');
      await waitPastMinAge();
      const email = `viejo-campo-lead-${RUN}@e2e-cardshow.example`;
      const res = await h.api('POST', '/card-show/leads', {
        json: { type: 'visitor', email, source: 'cta_hero', consent: true, token }, // ⛔ `token`, no `formToken`
      });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');

      const rows = await h.prisma.cardShowLead.findMany({ where: { email } });
      expect(rows).toHaveLength(0);
    });
  });

  describe('B — players (torneo)', () => {
    it('B1 — `formToken` correcto ⇒ 202 y UNA fila PERSISTIDA `status:"pending"`', async () => {
      const token = await formToken('players');
      await waitPastMinAge();
      const email = `jugador-${RUN}@e2e-cardshow.example`;
      const playerId = String(100000 + Math.floor(Math.random() * 800000));
      const res = await h.api('POST', '/card-show/players', {
        json: {
          day: 'sat',
          playerName: 'Jugador de Prueba',
          playerId,
          email,
          isMinor: false,
          consent: true,
          formToken: token,
        },
      });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ ok: true });

      const rows = await h.prisma.cardShowPlayerSignup.findMany({ where: { email } });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('pending');
    });

    it('B2 (CANDADO) — campo VIEJO `token` en vez de `formToken` ⇒ 400 VALIDATION_ERROR y 0 filas', async () => {
      const token = await formToken('players');
      await waitPastMinAge();
      const email = `viejo-campo-player-${RUN}@e2e-cardshow.example`;
      const playerId = String(100000 + Math.floor(Math.random() * 800000));
      const res = await h.api('POST', '/card-show/players', {
        json: {
          day: 'sat',
          playerName: 'Jugador de Prueba',
          playerId,
          email,
          isMinor: false,
          consent: true,
          token, // ⛔ `token`, no `formToken`
        },
      });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');

      const rows = await h.prisma.cardShowPlayerSignup.findMany({ where: { email } });
      expect(rows).toHaveLength(0);
    });
  });
});
