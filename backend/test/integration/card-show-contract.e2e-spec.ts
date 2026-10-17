/**
 * card-show-contract.e2e-spec.ts — ⭐ CANDADO DE CONTRATO de la landing del Card Show contra Postgres
 * REAL y por HTTP (§CARDSHOW.3/.5/.11/.12/.15). Propiedad: backend; la ejecuta QA (`npm run test:integration`).
 *
 * Nace de una regresión real: el DTO exige `formToken` (`dto/card-show.dto.ts`) pero el frontend mandaba
 * `token` ⇒ el `StrictBodyPipe` (`whitelist + forbidNonWhitelisted`) devolvía `400 VALIDATION_ERROR` y se
 * PERDÍAN TODAS las altas. No se cazó porque cada lado probaba contra su propio mock. Este spec levanta la
 * app Nest REAL (mismo pipe/filtro/prefijo que `main.ts`) y golpea el CONTRATO de verdad — SIN mockear la
 * validación ni la persistencia:
 *
 * | # | Qué fija |
 * |---|---|
 * | A1 | `POST /card-show/leads` (visitor) con `formToken` correcto + `name` (⭐M-84 obligatorio) ⇒ 202 y UNA fila PENDING |
 * | A2 | `POST /card-show/leads` con el campo VIEJO `token` ⇒ 400 VALIDATION_ERROR y 0 filas ← **el candado del mismatch de nombre** |
 * | B1 | `POST /card-show/players` FORMAL (`game:'pokemon'`, con `playerId`) ⇒ 202 y UNA fila PENDING |
 * | B2 | `POST /card-show/players` con el campo VIEJO `token` ⇒ 400 VALIDATION_ERROR y 0 filas |
 * | B3 | `POST /card-show/players` LIGERA (`game:'shardbugs'`, ⛔ sin `playerId`) ⇒ 202 y UNA fila PENDING con `playerId` NULL ← ⭐M-85 de punta a punta |
 * | C1 | lead M-84 válido: crea → **confirma** (POST /confirm) → `status:'new'` persistido → aparece en el **panel** y en el **CSV** (super_admin) |
 * | C2 | player FORMAL (pokemon): crea → confirma → `status:'confirmed'`, `playerId` presente → panel + CSV del torneo |
 * | C3 | player LIGERA (shardbugs): crea → confirma → `status:'confirmed'`, `playerId` VACÍO, `game:'shardbugs'` → panel + CSV ← ⭐M-85 |
 *
 * El bloque C cierra el hueco que señaló QA: antes solo había cobertura UNITARIA mockeada de que un
 * lead/player M-84 válido se acepta y persiste; aquí se recorre el ciclo (alta → doble opt-in → panel/CSV)
 * contra el stack REAL (Postgres, pipes, guards, roles).
 *
 * ÚNICA sustitución de INFRA (no del contrato): `MX_RESOLVER` ⇒ `true`, para no depender de DNS externo
 * en CI (es lo mismo que `e2e-app.ts` hace con Stripe: stub OFFLINE de la llamada de red, no del flujo que
 * se mide). El transporte de correo ya es Noop en el arnés. El token de FORMULARIO se verifica con el
 * secreto EFÍMERO real del proceso; el token de ENLACE del doble opt-in (que el usuario recibe por correo,
 * aquí Noop) se emite con el `CardShowTokensService` REAL de la app — ningún mock del pipe, del servicio ni
 * de Prisma.
 */
import { randomBytes } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { MX_RESOLVER } from '../../src/modules/card-show/card-show-mail.service';
import { CardShowTokensService } from '../../src/modules/card-show/card-show-tokens.service';
import { FORM_TOKEN_MIN_AGE_MS } from '../../src/modules/card-show/card-show.constants';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

jest.setTimeout(60_000);

const RUN = `cse2e${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('E2E — CARDSHOW contrato POST /card-show/{leads,players} (sin mocks, §CARDSHOW.3/.5/.11/.12/.15)', () => {
  let h: E2EHarness;
  let tokens: CardShowTokensService;
  let adminToken: string;

  beforeAll(async () => {
    // Sustitución SOLO de infra (DNS MX), para no depender de la red en CI. El resto del flujo es real.
    h = await E2EHarness.create((b) =>
      b.overrideProvider(MX_RESOLVER).useValue({ hasMailExchange: async () => true }),
    );
    tokens = h.app.get(CardShowTokensService);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
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

  /** Alta de un lead válido M-84 (devuelve el email usado), tras respetar el min-age. */
  const postLead = async (email: string, body: Record<string, unknown>): Promise<void> => {
    const token = await formToken('leads');
    await waitPastMinAge();
    const res = await h.api('POST', '/card-show/leads', { json: { email, formToken: token, ...body } });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
  };

  /** Alta de una preinscripción válida M-84 (devuelve el email usado), tras respetar el min-age. */
  const postPlayer = async (email: string, body: Record<string, unknown>): Promise<void> => {
    const token = await formToken('players');
    await waitPastMinAge();
    const res = await h.api('POST', '/card-show/players', { json: { email, formToken: token, ...body } });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
  };

  /** POST /card-show/confirm con un token de ENLACE emitido por el servicio REAL (el que viaja por correo). */
  const confirm = async (kind: 'lead' | 'signup', rowId: string) => {
    const linkToken = tokens.issueLinkToken(kind, rowId, 'confirm');
    const res = await h.api('POST', '/card-show/confirm', { json: { token: linkToken } });
    return res;
  };

  describe('A — leads', () => {
    it('A1 — `formToken` + `name` (⭐M-84) ⇒ 202 y UNA fila PERSISTIDA `status:"pending"`', async () => {
      const email = `avisame-${RUN}@e2e-cardshow.example`;
      await postLead(email, { type: 'visitor', name: 'Visitante de Prueba', source: 'cta_hero', consent: true });

      const rows = await h.prisma.cardShowLead.findMany({ where: { email } });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('pending');
      expect(rows[0].name).toBe('Visitante de Prueba');
      expect(rows[0].confirmedAt).toBeNull();
    });

    it('A2 (CANDADO) — campo VIEJO `token` en vez de `formToken` ⇒ 400 VALIDATION_ERROR y 0 filas', async () => {
      const token = await formToken('leads');
      await waitPastMinAge();
      const email = `viejo-campo-lead-${RUN}@e2e-cardshow.example`;
      const res = await h.api('POST', '/card-show/leads', {
        json: { type: 'visitor', name: 'Visitante de Prueba', email, source: 'cta_hero', consent: true, token }, // ⛔ `token`, no `formToken`
      });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');

      const rows = await h.prisma.cardShowLead.findMany({ where: { email } });
      expect(rows).toHaveLength(0);
    });
  });

  describe('B — players (torneo)', () => {
    it('B1 — FORMAL `game:"pokemon"` + `formToken` ⇒ 202 y UNA fila PERSISTIDA `status:"pending"`', async () => {
      const email = `jugador-${RUN}@e2e-cardshow.example`;
      const playerId = String(100000 + Math.floor(Math.random() * 800000));
      await postPlayer(email, {
        game: 'pokemon',
        day: 'sat',
        playerName: 'Jugador de Prueba',
        playerId,
        isMinor: false,
        consent: true,
      });

      const rows = await h.prisma.cardShowPlayerSignup.findMany({ where: { email } });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('pending');
      expect(rows[0].game).toBe('pokemon');
      expect(rows[0].playerId).toBe(playerId);
    });

    it('B2 (CANDADO) — campo VIEJO `token` en vez de `formToken` ⇒ 400 VALIDATION_ERROR y 0 filas', async () => {
      const token = await formToken('players');
      await waitPastMinAge();
      const email = `viejo-campo-player-${RUN}@e2e-cardshow.example`;
      const playerId = String(100000 + Math.floor(Math.random() * 800000));
      const res = await h.api('POST', '/card-show/players', {
        json: {
          game: 'pokemon',
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

    it('B3 (⭐M-85) — LIGERA `game:"shardbugs"` SIN `playerId` ⇒ 202 y UNA fila con `playerId` NULL', async () => {
      const email = `ligera-${RUN}@e2e-cardshow.example`;
      await postPlayer(email, {
        game: 'shardbugs',
        day: 'sun',
        playerName: 'Jugadora Ligera',
        isMinor: false,
        consent: true,
      });

      const rows = await h.prisma.cardShowPlayerSignup.findMany({ where: { email } });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('pending');
      expect(rows[0].game).toBe('shardbugs');
      expect(rows[0].playerId).toBeNull();
    });
  });

  // ⭐ Camino feliz M-84/M-85 de PUNTA A PUNTA contra el stack: alta → doble opt-in (confirm) → panel + CSV.
  // Cierra el hueco de QA (antes solo había cobertura unitaria mockeada de la aceptación/persistencia).
  describe('C — camino feliz: crea → confirma → panel/CSV (super_admin)', () => {
    it('C1 — lead visitor: confirma ⇒ `status:"new"` y aparece en el panel y el CSV', async () => {
      const email = `feliz-lead-${RUN}@e2e-cardshow.example`;
      await postLead(email, {
        type: 'visitor',
        name: 'Lead Feliz',
        gameInterest: 'shardbugs', // ⭐M-85 interés del visitante (visitor puede)
        source: 'cta_hero',
        consent: true,
      });
      const created = await h.prisma.cardShowLead.findFirstOrThrow({ where: { email } });

      const res = await confirm('lead', created.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, state: 'new' });

      const row = await h.prisma.cardShowLead.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.status).toBe('new');
      expect(row.confirmedAt).not.toBeNull();

      // Panel (⛔ PENDING no aparece; este ya es `new`): la fila está y el CSV la trae.
      const panel = await h.api('GET', `/admin/card-show/leads?q=${RUN}`, { token: adminToken });
      expect(panel.status).toBe(200);
      const emails = (panel.body as { data: { email: string }[] }).data.map((r) => r.email);
      expect(emails).toContain(email);

      const csv = await h.api('GET', `/admin/card-show/leads/export.csv?q=${RUN}`, { token: adminToken });
      expect(csv.status).toBe(200);
      expect(csv.text).toContain(email);
    });

    it('C2 — player FORMAL (pokemon): confirma ⇒ `status:"confirmed"` con `playerId`, en panel y CSV', async () => {
      const email = `feliz-pkmn-${RUN}@e2e-cardshow.example`;
      const playerId = String(100000 + Math.floor(Math.random() * 800000));
      await postPlayer(email, {
        game: 'pokemon',
        day: 'sat',
        playerName: 'Campeon Pokemon',
        playerId,
        isMinor: false,
        consent: true,
      });
      const created = await h.prisma.cardShowPlayerSignup.findFirstOrThrow({ where: { email } });

      const res = await confirm('signup', created.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, state: 'confirmed' });

      const row = await h.prisma.cardShowPlayerSignup.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.status).toBe('confirmed');
      expect(row.playerId).toBe(playerId);

      const panel = await h.api('GET', `/admin/card-show/players?q=${RUN}&game=pokemon`, { token: adminToken });
      expect(panel.status).toBe(200);
      const found = (panel.body as { data: { email: string; game: string; playerId: string | null }[] }).data.find((r) => r.email === email);
      expect(found).toBeTruthy();
      expect(found?.game).toBe('pokemon');

      const csv = await h.api('GET', `/admin/card-show/players/export.csv?q=${RUN}&game=pokemon`, { token: adminToken });
      expect(csv.status).toBe(200);
      expect(csv.text).toContain(email);
      expect(csv.text).toContain(playerId);
    });

    it('C3 (⭐M-85) — player LIGERA (shardbugs): confirma ⇒ `status:"confirmed"`, `playerId` vacío, en panel y CSV', async () => {
      const email = `feliz-shard-${RUN}@e2e-cardshow.example`;
      await postPlayer(email, {
        game: 'shardbugs',
        day: 'sun',
        playerName: 'Jugadora Shard',
        isMinor: false,
        consent: true,
      });
      const created = await h.prisma.cardShowPlayerSignup.findFirstOrThrow({ where: { email } });

      const res = await confirm('signup', created.id);
      expect(res.status).toBe(200);
      // LIGERA: pasa DIRECTO a `confirmed` (sin cupo/waitlist, §CARDSHOW.12).
      expect(res.body).toEqual({ ok: true, state: 'confirmed' });

      const row = await h.prisma.cardShowPlayerSignup.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.status).toBe('confirmed');
      expect(row.game).toBe('shardbugs');
      expect(row.playerId).toBeNull();

      const panel = await h.api('GET', `/admin/card-show/players?q=${RUN}&game=shardbugs`, { token: adminToken });
      expect(panel.status).toBe(200);
      const found = (panel.body as { data: { email: string; game: string; playerId: string | null }[] }).data.find((r) => r.email === email);
      expect(found).toBeTruthy();
      expect(found?.game).toBe('shardbugs');
      expect(found?.playerId).toBeNull();

      const csv = await h.api('GET', `/admin/card-show/players/export.csv?q=${RUN}&game=shardbugs`, { token: adminToken });
      expect(csv.status).toBe(200);
      expect(csv.text).toContain(email);
    });
  });
});
