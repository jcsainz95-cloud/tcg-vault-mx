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
import { ConfigService } from '@nestjs/config';
import { E2EHarness } from './helpers/e2e-app';
import { MX_RESOLVER } from '../../src/modules/card-show/card-show-mail.service';
import { CardShowTokensService } from '../../src/modules/card-show/card-show-tokens.service';
import { CardShowTournamentCountService } from '../../src/modules/card-show/card-show-tournament-count.service';
import { ENV, FORM_TOKEN_MIN_AGE_MS } from '../../src/modules/card-show/card-show.constants';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

jest.setTimeout(60_000);

const RUN = `cse2e${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Una IP de cliente DISTINTA por alta (QA, afd12b82: el bloque E daba 429 en vez de 202, 1/1 con Redis limpio).
 * El throttle REAL de la landing (`card-show-throttle.service.ts`, 5 POST/min y 20/h por IP y endpoint, en Redis)
 * se cuenta por `req.ip`; sin esto TODAS las altas de la suite salen de 127.0.0.1 y la 6.ª de `/players` en el
 * mismo minuto es 429. ⛔ No se toca el límite: cada alta es un «visitante» distinto, como en producción.
 * `req.ip` = la ÚLTIMA entrada de `X-Forwarded-For` (`trust proxy = 1`, `e2e-app.ts` ⇒ `applyTrustProxy`).
 * Rango 198.18.0.0/15 (RFC 2544, de pruebas); tercer octeto al azar por corrida, para que dos corridas en la
 * misma hora contra el mismo Redis no compartan el cubo de 20/h.
 */
const IP_BASE = `198.${18 + Math.floor(Math.random() * 2)}.${Math.floor(Math.random() * 256)}`;
let ipSeq = 0;
const freshClient = (): Record<string, string> => ({ 'x-forwarded-for': `${IP_BASE}.${(ipSeq++ % 254) + 1}` });

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
  const formToken = async (purpose: 'leads' | 'players', client: Record<string, string>): Promise<string> => {
    const r = await h.api('GET', `/card-show/form-token?purpose=${purpose}`, { headers: client });
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
    const client = freshClient();
    const token = await formToken('leads', client);
    await waitPastMinAge();
    const res = await h.api('POST', '/card-show/leads', { headers: client, json: { email, formToken: token, ...body } });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
  };

  /** Alta de una preinscripción válida M-84 (devuelve el email usado), tras respetar el min-age. */
  const postPlayer = async (email: string, body: Record<string, unknown>): Promise<void> => {
    const client = freshClient();
    const token = await formToken('players', client);
    await waitPastMinAge();
    const res = await h.api('POST', '/card-show/players', { headers: client, json: { email, formToken: token, ...body } });
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
      const client = freshClient();
      const token = await formToken('leads', client);
      await waitPastMinAge();
      const email = `viejo-campo-lead-${RUN}@e2e-cardshow.example`;
      const res = await h.api('POST', '/card-show/leads', {
        headers: client,
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
      const client = freshClient();
      const token = await formToken('players', client);
      await waitPastMinAge();
      const email = `viejo-campo-player-${RUN}@e2e-cardshow.example`;
      const playerId = String(100000 + Math.floor(Math.random() * 800000));
      const res = await h.api('POST', '/card-show/players', {
        headers: client,
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

  // ⭐v1.98 — M-86 (IMP-3, §CARDSHOW.15): `q` casa `name`/`email` en /leads y `playerName`/`email`/`playerId`
  // en /players (contains, INSENSIBLE a mayúsculas, parametrizado). CANDADO del hueco real: el panel decía
  // «nombre o correo» pero el código solo casaba `email`. La aserción «name casa / email NO ⇒ aparece» es el
  // CANARIO: si se quita la cláusula `name`/`playerName` del `OR`, esa fila desaparece y la prueba se pone roja.
  describe('D — semántica de `q` (⭐M-86 IMP-3)', () => {
    const base = {
      consentAt: new Date(),
      privacyVersion: 'provisional',
      confirmedAt: new Date(), // confirmado ⇒ el panel lo muestra (⛔ PENDING no aparece)
    };
    // Marcadores únicos cuyo PREFIJO ("Zq…") NO aparece en ningún email sembrado (los emails llevan `lead-…`/
    // `play-…`). Así q=marcador casa SOLO el campo bajo prueba, no colisiona con la cláusula `email`.
    const NAME_ONLY = `Zqname${RUN}`; // casa `name`/`playerName`, ⛔ no el email
    const EMAIL_ONLY = `qmail${RUN}`; // casa el email, ⛔ no el nombre
    const MIXED_CASE = `AnaMarca${RUN}`; // casa `name` con q en minúsculas (insensibilidad)
    const PENDING_NAME = `Zqpending${RUN}`; // nombre de una fila PENDING: q jamás debe traerla
    const SELLS_MARK = `Zqsells${RUN}`; // va en sellsWhat: q ⛔ no debe casarlo
    const PHONE_MARK = '5598765432'; // va en phone: q ⛔ no debe casarlo
    const PLAYER_ID = String(100000 + Math.floor(Math.random() * 800000)); // solo dígitos (como B1/C2)

    const names = (body: unknown) => (body as { data: { email: string; name?: string; playerName?: string }[] }).data;

    it('leads: `name` casa q pero `email` NO ⇒ aparece (CANARIO); `email` casa pero `name` NO ⇒ aparece; insensible a mayúsculas; q NUNCA trae PENDING; ⛔ no casa phone/sellsWhat', async () => {
      await h.prisma.cardShowLead.createMany({
        data: [
          { type: 'visitor', name: NAME_ONLY, email: `lead-a-${RUN}@e2e-cardshow.example`, mailboxHmac: `hmac-a-${RUN}`, source: 'cta_hero', status: 'new', ...base },
          { type: 'visitor', name: 'Lead Sin Marca', email: `${EMAIL_ONLY}@e2e-cardshow.example`, mailboxHmac: `hmac-b-${RUN}`, source: 'cta_hero', status: 'new', ...base },
          { type: 'visitor', name: MIXED_CASE, email: `lead-c-${RUN}@e2e-cardshow.example`, mailboxHmac: `hmac-c-${RUN}`, source: 'cta_hero', status: 'new', ...base },
          // Fila PENDING cuyo nombre casa NAME_ONLY: q no debe traerla NUNCA (confirmedAt NULL).
          { type: 'visitor', name: PENDING_NAME, email: `lead-pend-${RUN}@e2e-cardshow.example`, mailboxHmac: `hmac-pend-${RUN}`, source: 'cta_hero', status: 'pending', consentAt: base.consentAt, privacyVersion: base.privacyVersion },
          // merchant con marcador en phone y sellsWhat: q ⛔ no debe casar ninguno de los dos.
          { type: 'merchant', name: 'Comercio Neutro', phone: PHONE_MARK, sellsWhat: SELLS_MARK, email: `lead-m-${RUN}@e2e-cardshow.example`, mailboxHmac: `hmac-m-${RUN}`, source: 'cta_hero', status: 'new', ...base },
        ],
      });

      // name casa, email NO ⇒ aparece. ← CANARIO (sin la cláusula `name` en el OR, esto se pone rojo).
      const r1 = await h.api('GET', `/admin/card-show/leads?q=${NAME_ONLY}`, { token: adminToken });
      expect(r1.status).toBe(200);
      expect(names(r1.body).map((x) => x.name)).toContain(NAME_ONLY);

      // email casa, name NO ⇒ aparece.
      const r2 = await h.api('GET', `/admin/card-show/leads?q=${EMAIL_ONLY}`, { token: adminToken });
      expect(names(r2.body).some((x) => x.email === `${EMAIL_ONLY}@e2e-cardshow.example`)).toBe(true);

      // insensible a mayúsculas: q en minúsculas casa un `name` con mayúsculas.
      const r3 = await h.api('GET', `/admin/card-show/leads?q=${MIXED_CASE.toLowerCase()}`, { token: adminToken });
      expect(names(r3.body).map((x) => x.name)).toContain(MIXED_CASE);

      // q NUNCA trae PENDING (aunque el nombre case).
      const r4 = await h.api('GET', `/admin/card-show/leads?q=${PENDING_NAME}`, { token: adminToken });
      expect(names(r4.body)).toHaveLength(0);

      // ⛔ q no casa sellsWhat…
      const r5 = await h.api('GET', `/admin/card-show/leads?q=${SELLS_MARK}`, { token: adminToken });
      expect(names(r5.body)).toHaveLength(0);
      // …ni phone.
      const r6 = await h.api('GET', `/admin/card-show/leads?q=${PHONE_MARK}`, { token: adminToken });
      expect(names(r6.body)).toHaveLength(0);
    });

    it('players: `playerName` casa pero `email` NO ⇒ aparece (CANARIO); `playerId` casa ⇒ aparece; fila LIGERA sin playerId no rompe ni casa por playerId; q NUNCA trae PENDING', async () => {
      await h.prisma.cardShowPlayerSignup.createMany({
        data: [
          { game: 'pokemon', day: 'sat', playerName: NAME_ONLY, playerId: PLAYER_ID, email: `play-a-${RUN}@e2e-cardshow.example`, mailboxHmac: `phmac-a-${RUN}`, isMinor: false, status: 'confirmed', ...base },
          { game: 'shardbugs', day: 'sun', playerName: `Zqligera${RUN}`, playerId: null, email: `play-b-${RUN}@e2e-cardshow.example`, mailboxHmac: `phmac-b-${RUN}`, isMinor: false, status: 'confirmed', ...base },
          // PENDING cuyo nombre casa NAME_ONLY: q no debe traerla.
          { game: 'pokemon', day: 'sat', playerName: NAME_ONLY, playerId: `${PLAYER_ID}9`, email: `play-pend-${RUN}@e2e-cardshow.example`, mailboxHmac: `phmac-pend-${RUN}`, isMinor: false, status: 'pending', consentAt: base.consentAt, privacyVersion: base.privacyVersion },
        ],
      });

      // playerName casa, email NO ⇒ aparece. ← CANARIO.
      const r1 = await h.api('GET', `/admin/card-show/players?q=${NAME_ONLY}`, { token: adminToken });
      expect(r1.status).toBe(200);
      const found1 = (r1.body as { data: { email: string }[] }).data;
      expect(found1.some((x) => x.email === `play-a-${RUN}@e2e-cardshow.example`)).toBe(true);
      // la fila PENDING con el mismo playerName NO aparece.
      expect(found1.some((x) => x.email === `play-pend-${RUN}@e2e-cardshow.example`)).toBe(false);

      // playerId (dígitos) casa ⇒ aparece; la fila LIGERA (playerId NULL) no rompe el OR y no casa por playerId.
      const r2 = await h.api('GET', `/admin/card-show/players?q=${PLAYER_ID}`, { token: adminToken });
      const found2 = (r2.body as { data: { email: string }[] }).data;
      expect(found2.some((x) => x.email === `play-a-${RUN}@e2e-cardshow.example`)).toBe(true);
      expect(found2.some((x) => x.email === `play-b-${RUN}@e2e-cardshow.example`)).toBe(false);

      // la fila LIGERA SÍ casa por su playerName (prueba de que el OR con playerId NULL no la excluye).
      const r3 = await h.api('GET', `/admin/card-show/players?q=Zqligera${RUN}`, { token: adminToken });
      expect((r3.body as { data: { email: string }[] }).data.some((x) => x.email === `play-b-${RUN}@e2e-cardshow.example`)).toBe(true);
    });

    it('q > 200 chars ⇒ 400 {field:q} (gramática §0)', async () => {
      const long = 'a'.repeat(201);
      const r = await h.api('GET', `/admin/card-show/leads?q=${long}`, { token: adminToken });
      expect(r.status).toBe(400);
      expect(r.body?.error?.code).toBe('VALIDATION_ERROR');
    });
  });

  // ⭐M-88 (§CARDSHOW.12, BLOQ-A / D-CS-7) — Confirmación de GRUPO «los dos días». El alta `day:'both'`
  // crea 2 filas (`sat`+`sun`, `pending`) y UN solo correo con el token de `rows[0]` (=`sat`). Antes de
  // M-88, confirmar ese correo confirmaba SOLO `sat` y `sun` quedaba `pending` colgado hasta caducar a
  // 72 h (lo midió tester-e2e sobre el stack real). Estas pruebas MUERDEN ese defecto: contra el código
  // anterior, (a)/(b)/(c) dejaban una fila `pending` colgada y (a)/(b) devolvían 1 sola fila confirmed.
  describe('E — M-88 confirmación de grupo «los dos días» (torneo)', () => {
    /** Devuelve las filas del grupo (por email) ordenadas por `createdAt` (igual que el servicio). */
    const groupRows = (email: string) =>
      h.prisma.cardShowPlayerSignup.findMany({ where: { email }, orderBy: { createdAt: 'asc' } });
    /** El token que viaja por correo = el de `rows[0]` (la fila `sat`), como arma `sendConfirmation`. */
    const confirmGroupByFirstRow = async (email: string) => {
      const rows = await groupRows(email);
      const first = rows[0]; // createdAt asc ⇒ `sat`
      const linkToken = tokens.issueLinkToken('signup', first.id, 'confirm');
      return h.api('POST', '/card-show/confirm', { json: { token: linkToken } });
    };

    it('(a) FORMAL pokemon `both` + cupo libre ⇒ 2 filas `confirmed`, 0 `pending` colgada; `days[]` nombra sat y sun', async () => {
      const email = `grupo-pkmn-${RUN}@e2e-cardshow.example`;
      const playerId = String(100000 + Math.floor(Math.random() * 800000));
      await postPlayer(email, { game: 'pokemon', day: 'both', playerName: 'Entrenador Doble', playerId, isMinor: false, consent: true });

      const before = await groupRows(email);
      expect(before).toHaveLength(2);
      expect(before.map((r) => r.day)).toEqual(['sat', 'sun']); // rows[0]=sat lleva el token
      expect(before.every((r) => r.status === 'pending')).toBe(true);

      const res = await confirmGroupByFirstRow(email);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.state).toBe('confirmed'); // estado de la fila del token (sat)
      // ⭐ Desglose por día ADITIVO (§0): el frontend lo usa para nombrar sábado Y domingo.
      expect(res.body.days).toEqual([
        { day: 'sat', state: 'confirmed' },
        { day: 'sun', state: 'confirmed' },
      ]);

      const after = await groupRows(email);
      expect(after.filter((r) => r.status === 'confirmed')).toHaveLength(2); // ⛔ 0 pending colgada
      expect(after.some((r) => r.status === 'pending')).toBe(false);
      expect(after.every((r) => r.confirmedAt !== null)).toBe(true);
    });

    it('(b) LIGERA shardbugs `both` + confirmar ⇒ 2 filas `confirmed` (sin cupo/waitlist), 0 `pending`', async () => {
      const email = `grupo-shard-${RUN}@e2e-cardshow.example`;
      await postPlayer(email, { game: 'shardbugs', day: 'both', playerName: 'Jugadora Doble Ligera', isMinor: false, consent: true });

      const before = await groupRows(email);
      expect(before).toHaveLength(2);
      expect(before.every((r) => r.status === 'pending' && r.playerId === null)).toBe(true);

      const res = await confirmGroupByFirstRow(email);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.state).toBe('confirmed');
      expect(res.body.days).toEqual([
        { day: 'sat', state: 'confirmed' },
        { day: 'sun', state: 'confirmed' },
      ]);

      const after = await groupRows(email);
      expect(after.filter((r) => r.status === 'confirmed')).toHaveLength(2);
      expect(after.some((r) => r.status === 'pending')).toBe(false);
    });

    it('(c) FORMAL pokemon `both` con `sun` lleno (cupo agotado) ⇒ `sat confirmed` + `sun waitlist`, 0 `pending`', async () => {
      const email = `grupo-wl-${RUN}@e2e-cardshow.example`;
      const playerId = String(100000 + Math.floor(Math.random() * 800000));
      await postPlayer(email, { game: 'pokemon', day: 'both', playerName: 'Entrenador WL', playerId, isMinor: false, consent: true });

      // Cupo determinista pese a la BD compartida: cap = (confirmados en sat ahora) + 1 ⇒ sat (satNow) < cap
      // ⇒ confirmed; y sembramos `sun` hasta `confirmados(sun) >= cap` ⇒ el `sun` del grupo waitlist.
      const config = h.app.get(ConfigService);
      const satNow = await h.prisma.cardShowPlayerSignup.count({ where: { game: 'pokemon', day: 'sat', status: 'confirmed' } });
      const sunNow = await h.prisma.cardShowPlayerSignup.count({ where: { game: 'pokemon', day: 'sun', status: 'confirmed' } });
      const cap = satNow + 1;
      const needed = Math.max(0, cap - sunNow);
      // Base de playerId SOLO dígitos y única por corrida (evita chocar con el índice único parcial
      // `(playerId, day)` de otras corridas que compartan la BD de integración).
      const fillBase = 10_000_000 + Math.floor(Math.random() * 80_000_000);
      if (needed > 0) {
        await h.prisma.cardShowPlayerSignup.createMany({
          data: Array.from({ length: needed }, (_, i) => ({
            game: 'pokemon' as const,
            day: 'sun' as const,
            playerName: `Relleno Sun ${i}`,
            playerId: String(fillBase + i),
            email: `relleno-sun-${i}-${RUN}@e2e-cardshow.example`,
            mailboxHmac: `fill-hmac-${i}-${RUN}`,
            isMinor: false,
            status: 'confirmed' as const,
            confirmedAt: new Date(),
            consentAt: new Date(),
            privacyVersion: 'provisional',
          })),
        });
      }
      config.set(ENV.TOURNAMENT_CAP_PER_DAY, String(cap));
      try {
        const res = await confirmGroupByFirstRow(email);
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.state).toBe('confirmed'); // fila del token (sat) sí entra
        expect(res.body.days).toEqual([
          { day: 'sat', state: 'confirmed' },
          { day: 'sun', state: 'waitlist' },
        ]);
      } finally {
        config.set(ENV.TOURNAMENT_CAP_PER_DAY, ''); // '' ⇒ cupo desconocido (null) para el resto de la suite
      }

      const after = await groupRows(email);
      const byDay = Object.fromEntries(after.map((r) => [r.day, r.status]));
      expect(byDay).toEqual({ sat: 'confirmed', sun: 'waitlist' });
      expect(after.some((r) => r.status === 'pending')).toBe(false); // ⛔ 0 pending colgada
    });

    it('(d) idempotencia: reusar el token tras confirmar el grupo ⇒ 410 LINK_ALREADY_USED, ⛔ sin 500', async () => {
      const email = `grupo-idem-${RUN}@e2e-cardshow.example`;
      const playerId = String(100000 + Math.floor(Math.random() * 800000));
      await postPlayer(email, { game: 'pokemon', day: 'both', playerName: 'Entrenador Idem', playerId, isMinor: false, consent: true });

      const first = await confirmGroupByFirstRow(email);
      expect(first.status).toBe(200);
      expect((await groupRows(email)).filter((r) => r.status === 'confirmed')).toHaveLength(2);

      // El token de `rows[0]` (sat) ya quedó usado (confirmedAt) ⇒ el 2.º uso es 410, nunca 500.
      const reuse = await confirmGroupByFirstRow(email);
      expect(reuse.status).toBe(410);
      expect(reuse.body?.error?.code).toBe('LINK_ALREADY_USED');
    });

    it('(e) TUTOR: otro `playerId` en el MISMO buzón es OTRO grupo ⇒ confirmar el 1.º ⛔ NO auto-confirma al 2.º', async () => {
      const email = `grupo-tutor-${RUN}@e2e-cardshow.example`;
      const playerA = String(100000 + Math.floor(Math.random() * 400000));
      const playerB = String(500000 + Math.floor(Math.random() * 400000));
      await postPlayer(email, { game: 'pokemon', day: 'sat', playerName: 'Jugador A', playerId: playerA, isMinor: false, consent: true });
      await postPlayer(email, { game: 'pokemon', day: 'sat', playerName: 'Jugador B', playerId: playerB, isMinor: false, consent: true });

      const rows = await groupRows(email);
      const rowA = rows.find((r) => r.playerId === playerA)!;
      const rowB = rows.find((r) => r.playerId === playerB)!;
      expect(rowA.status).toBe('pending');
      expect(rowB.status).toBe('pending');

      // Confirmar el token del jugador A: su grupo es (buzón, pokemon, playerA); B (playerB) queda fuera.
      const linkTokenA = tokens.issueLinkToken('signup', rowA.id, 'confirm');
      const res = await h.api('POST', '/card-show/confirm', { json: { token: linkTokenA } });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const rowAafter = await h.prisma.cardShowPlayerSignup.findUniqueOrThrow({ where: { id: rowA.id } });
      const rowBafter = await h.prisma.cardShowPlayerSignup.findUniqueOrThrow({ where: { id: rowB.id } });
      expect(rowAafter.status).toBe('confirmed');
      expect(rowBafter.status).toBe('pending'); // ⛔ el 2.º jugador NO se auto-confirma (otro grupo)
      expect(rowBafter.confirmedAt).toBeNull();
    });
  });
  // ⭐M-90 (§CARDSHOW.1a-quater / §CARDSHOW.12-bis / D-CS-8) — criterios §13 [M-90] (1)-(7) contra Postgres REAL.
  // BD COMPARTIDA: todo se mide en DELTAS sobre la línea base (otras corridas pueden dejar filas), y el cupo se
  // fija relativo a lo ya ocupado, como el bloque E (c).
  describe('F — M-90 Magic (LIGERA) + contador público del torneo + D-CS-8', () => {
    const occupied = (day: 'sat' | 'sun') =>
      h.prisma.cardShowPlayerSignup.count({ where: { game: 'pokemon', day, status: { in: ['confirmed', 'checked_in'] } } });
    /** El contador cachea 30 s en memoria del proceso; entre pasos de la prueba se vacía (hook de prueba). */
    const dropCountCache = () => {
      (h.app.get(CardShowTournamentCountService) as unknown as { cache: unknown }).cache = null;
    };
    const getCount = (client: Record<string, string> = freshClient()) => h.api('GET', '/card-show/tournament/count', { headers: client });
    const satOf = (body: unknown) => (body as { days: { day: string; confirmed: number; cap: number | null; full: boolean }[] }).days;
    let seedSeq = 0;
    const seed = async (rows: { game: 'pokemon' | 'magic'; day: 'sat' | 'sun'; status: 'confirmed' | 'checked_in' | 'pending' | 'waitlist' | 'cancelled' }[]) => {
      const base = 20_000_000 + Math.floor(Math.random() * 70_000_000);
      await h.prisma.cardShowPlayerSignup.createMany({
        data: rows.map((r, i) => {
          const n = seedSeq++;
          return {
            game: r.game,
            day: r.day,
            playerName: `Semilla ${n}`,
            playerId: r.game === 'pokemon' ? String(base + i) : null,
            email: `semilla-${n}-${RUN}@e2e-cardshow.example`,
            mailboxHmac: `seed-hmac-${n}-${RUN}`,
            isMinor: false,
            status: r.status,
            confirmedAt: r.status === 'pending' ? null : new Date(),
            consentAt: new Date(),
            privacyVersion: 'provisional',
          };
        }),
      });
    };
    const postPokemon = async (email: string, day: 'sat' | 'sun') => {
      await postPlayer(email, { game: 'pokemon', day, playerName: 'Entrenador Cupo', playerId: String(100000 + Math.floor(Math.random() * 800000)), isMinor: false, consent: true });
      return h.prisma.cardShowPlayerSignup.findFirstOrThrow({ where: { email } });
    };

    it('(2) magic LIGERA: sin playerId ⇒ 202 y al confirmar `confirmed` directo AUNQUE el cupo esté lleno; con playerId ⇒ 400; MAGIC ⇒ 400; gameInterest=magic ⇒ 202; ?game=magic ⇒ 200', async () => {
      const config = h.app.get(ConfigService);
      const email = `magic-${RUN}@e2e-cardshow.example`;
      await postPlayer(email, { game: 'magic', day: 'sat', playerName: 'Planeswalker', isMinor: false, consent: true });
      const row = await h.prisma.cardShowPlayerSignup.findFirstOrThrow({ where: { email } });
      expect(row.game).toBe('magic');
      expect(row.playerId).toBeNull();
      config.set(ENV.TOURNAMENT_CAP_PER_DAY, '0'); // cupo Pokémon lleno
      try {
        const res = await confirm('signup', row.id);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true, state: 'confirmed' });
      } finally {
        config.set(ENV.TOURNAMENT_CAP_PER_DAY, '');
      }

      for (const [body, field] of [
        [{ game: 'magic', day: 'sat', playerName: 'Con Id', playerId: '1234567', isMinor: false, consent: true }, 'playerId'],
        [{ game: 'MAGIC', day: 'sat', playerName: 'Mayus', isMinor: false, consent: true }, 'game'],
      ] as const) {
        const client = freshClient();
        const token = await formToken('players', client);
        await waitPastMinAge();
        const bad = `magic-bad-${field}-${RUN}@e2e-cardshow.example`;
        const r = await h.api('POST', '/card-show/players', { headers: client, json: { email: bad, formToken: token, ...body } });
        expect(r.status).toBe(400);
        expect(JSON.stringify(r.body)).toContain(field);
        expect(await h.prisma.cardShowPlayerSignup.count({ where: { email: bad } })).toBe(0);
      }

      // `POST /leads` responde el NEUTRO 202 (§CARDSHOW.3); el «200» del criterio se lee como «aceptado».
      const leadEmail = `magic-lead-${RUN}@e2e-cardshow.example`;
      await postLead(leadEmail, { type: 'visitor', name: 'Visitante Magic', source: 'cta_hero', consent: true, gameInterest: 'magic' });
      expect((await h.prisma.cardShowLead.findFirstOrThrow({ where: { email: leadEmail } })).gameInterest).toBe('magic');

      const panel = await h.api('GET', `/admin/card-show/players?q=${RUN}&game=magic`, { token: adminToken });
      expect(panel.status).toBe(200);
      const data = (panel.body as { data: { email: string; game: string }[] }).data;
      expect(data.find((r) => r.email === email)?.game).toBe('magic');
      expect(data.every((r) => r.game === 'magic')).toBe(true);
    });

    it('(3)(4) contador: +2 confirmed +1 checked_in (+ pending/waitlist/cancelled/magic que NO cuentan) ⇒ +3 ese día, +0 el otro; sat,sun; 0 PII; sin Set-Cookie; Cache-Control 30 s', async () => {
      dropCountCache();
      const before = await getCount();
      expect(before.status).toBe(200);
      await seed([
        { game: 'pokemon', day: 'sat', status: 'confirmed' },
        { game: 'pokemon', day: 'sat', status: 'confirmed' },
        { game: 'pokemon', day: 'sat', status: 'checked_in' },
        { game: 'pokemon', day: 'sat', status: 'pending' },
        { game: 'pokemon', day: 'sat', status: 'waitlist' },
        { game: 'pokemon', day: 'sat', status: 'cancelled' },
        { game: 'magic', day: 'sat', status: 'confirmed' },
      ]);
      dropCountCache();
      const after = await getCount();
      expect(after.status).toBe(200);
      const b = satOf(before.body);
      const a = satOf(after.body);
      expect(a.map((d) => d.day)).toEqual(['sat', 'sun']);
      expect(a[0].confirmed - b[0].confirmed).toBe(3);
      expect(a[1].confirmed - b[1].confirmed).toBe(0);
      expect(a[0].confirmed).toBe(await occupied('sat'));
      expect((after.body as { game: string }).game).toBe('pokemon');
      expect(Object.keys(after.body as object).sort()).toEqual(['asOf', 'days', 'game']);
      expect(after.text).not.toMatch(/playerName|playerId|email|"id"|Semilla|semilla/);
      expect(after.headers['set-cookie']).toBeUndefined();
      expect(after.headers['cache-control']).toBe('public, max-age=30');
    });

    it('(5) cap = ocupados ⇒ full=true y la siguiente confirmación Pokémon ⇒ waitlist; variable vacía ⇒ cap=null, full=false', async () => {
      const config = h.app.get(ConfigService);
      const row = await postPokemon(`cupo-lleno-${RUN}@e2e-cardshow.example`, 'sat');
      const cap = await occupied('sat');
      config.set(ENV.TOURNAMENT_CAP_PER_DAY, String(cap));
      try {
        dropCountCache();
        const r = await getCount();
        expect(satOf(r.body)[0]).toMatchObject({ day: 'sat', confirmed: cap, cap, full: true });
        const res = await confirm('signup', row.id);
        expect(res.body).toEqual({ ok: true, state: 'waitlist' });
      } finally {
        config.set(ENV.TOURNAMENT_CAP_PER_DAY, '');
      }
      dropCountCache();
      const r2 = await getCount();
      for (const d of satOf(r2.body)) expect(d).toMatchObject({ cap: null, full: false });
    });

    it('(6) [D-CS-8] 1 confirmed + 1 checked_in con cap = ocupados ⇒ confirmar otra Pokémon ⇒ waitlist (el checked_in OCUPA plaza)', async () => {
      const config = h.app.get(ConfigService);
      await seed([
        { game: 'pokemon', day: 'sun', status: 'confirmed' },
        { game: 'pokemon', day: 'sun', status: 'checked_in' },
      ]);
      const row = await postPokemon(`dcs8-${RUN}@e2e-cardshow.example`, 'sun');
      // cap = confirmed + checked_in de `sun` ⇒ contando solo `confirmed` (defecto) quedaría 1 plaza libre.
      const cap = await occupied('sun');
      config.set(ENV.TOURNAMENT_CAP_PER_DAY, String(cap));
      try {
        const res = await confirm('signup', row.id);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true, state: 'waitlist' });
      } finally {
        config.set(ENV.TOURNAMENT_CAP_PER_DAY, '');
      }
      expect((await h.prisma.cardShowPlayerSignup.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('waitlist');
    });

    it('(7) caché: confirmar una fila NO mueve el contador dentro de la ventana (mismo asOf); 61 GET desde 1 IP ⇒ 429 en la 61.ª con Retry-After ≥ 1', async () => {
      dropCountCache();
      const first = await getCount();
      const row = await postPokemon(`cache-${RUN}@e2e-cardshow.example`, 'sat');
      expect((await confirm('signup', row.id)).body).toEqual({ ok: true, state: 'confirmed' });
      const cached = await getCount();
      expect(cached.body).toEqual(first.body); // dentro de los 30 s: el valor de caché (el reloj simulado está en la unitaria)
      dropCountCache();
      expect(satOf((await getCount()).body)[0].confirmed).toBe(satOf(first.body)[0].confirmed + 1);

      const client = freshClient();
      const statuses: number[] = [];
      let last: Awaited<ReturnType<typeof getCount>> | undefined;
      for (let i = 0; i < 61; i += 1) {
        last = await getCount(client);
        statuses.push(last.status);
      }
      expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
      expect(statuses[60]).toBe(429);
      const ra = Number(last!.headers['retry-after']);
      expect(Number.isInteger(ra) && ra >= 1).toBe(true);
      // 0 efecto en los topes de POST: la MISMA IP aún puede pedir token y dar de alta.
      const token = await formToken('players', client);
      await waitPastMinAge();
      const after429 = await h.api('POST', '/card-show/players', {
        headers: client,
        json: { email: `tras-429-${RUN}@e2e-cardshow.example`, formToken: token, game: 'magic', day: 'sun', playerName: 'Tras Limite', isMinor: false, consent: true },
      });
      expect(after429.status).toBe(202);
      expect(await h.prisma.cardShowPlayerSignup.count({ where: { email: `tras-429-${RUN}@e2e-cardshow.example` } })).toBe(1);
    });
  });
});
