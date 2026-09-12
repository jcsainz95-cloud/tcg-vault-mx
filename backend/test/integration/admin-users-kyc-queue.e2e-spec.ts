/**
 * admin-users-kyc-queue.e2e-spec.ts — **`A5` contra la app REAL y Postgres REAL.**
 * API_CONTRACT §M6-L (candados **L-1, L-2, L-3, L-4, L-5, L-6**) · ARCHITECTURE §4.53.
 *
 * ### Por qué esta suite existe y no basta la unitaria
 * La unitaria (`test/admin.users-kyc-filter.spec.ts`) observa el `where` que se construye. Lo que
 * **no puede** ver es si Postgres devuelve lo que ese `where` promete: la partición de `L-2` —que
 * los cuatro filtros suman EXACTAMENTE el padrón entero— es una propiedad de **la consulta contra
 * datos reales**, y es la que caza el caso «usuario **sin fila** en `KycProfile`», que en el mundo
 * de los mocks nunca falla porque nadie lo simula. Igual `L-1`: que el `vault_operator` reciba el
 * campo depende del guard montado, y un `@Roles` bien escrito con un guard mal montado **se leen
 * igual en el código**.
 *
 * ### La medición que originó la ficha (2026-09-12, esta misma app, este mismo Postgres)
 * Antes de `A5`: `?kycStatus=pending` ⇒ `200` con `total` **idéntico** al del listado sin filtro (la
 * cola falsa), `?status=banana` ⇒ **`500 INTERNAL`** y `?zzz=1` ⇒ `200` ignorado. Los tres se
 * comprueban aquí en su forma nueva.
 */
import { KycStatus, UserStatus } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

/** Marca única de esta corrida: todo lo que siembro lleva este prefijo y se borra al final. */
const TAG = `a5queue${Date.now().toString(36)}`;

type Row = { id: string; email: string; kycStatus: string };
type ListBody = { data: Row[]; page: number; pageSize: number; total: number };

describe('`A5` · §M6-L — el estado de identidad en el listado y su filtro', () => {
  let h: E2EHarness;
  let adminToken: string;
  let operatorToken: string;
  const sembrados: string[] = [];

  /** Siembra un usuario con (o sin) fila de `KycProfile`. `kyc: undefined` ⇒ SIN FILA. */
  async function seedUser(slug: string, kyc?: KycStatus): Promise<string> {
    const user = await h.prisma.user.create({
      data: {
        email: `${TAG}.${slug}@e2e.local`,
        name: `${TAG} ${slug}`,
        role: 'customer',
        status: UserStatus.active,
        ...(kyc === undefined ? {} : { kycProfile: { create: { kycStatus: kyc } } }),
      },
      select: { id: true },
    });
    sembrados.push(user.id);
    return user.id;
  }

  const list = (query: string, token = adminToken) =>
    h.api<ListBody>('GET', `/admin/users${query}`, { token });

  beforeAll(async () => {
    h = await E2EHarness.create();
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operatorToken = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);

    // Un usuario por estado + el caso que solo existe en la BD: SIN FILA de `KycProfile`.
    await seedUser('pending', KycStatus.pending);
    await seedUser('verified', KycStatus.verified);
    await seedUser('rejected', KycStatus.rejected);
    await seedUser('rowNone', KycStatus.none);
    await seedUser('sinFila');
  });

  afterAll(async () => {
    if (sembrados.length > 0) {
      await h.prisma.kycProfile.deleteMany({ where: { userId: { in: sembrados } } });
      await h.prisma.user.deleteMany({ where: { id: { in: sembrados } } });
    }
    await h?.close();
  });

  // ---------------------------------------------------------------- L-1
  describe('`L-1` — el campo viaja para los DOS roles', () => {
    it.each([
      ['super_admin', () => adminToken],
      ['vault_operator', () => operatorToken],
    ])('con token %s: TODA fila trae `kycStatus` ∈ KycStatus (⛔ ninguna sin la clave)', async (_rol, tok) => {
      const res = await list('?pageSize=100', tok());
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const row of res.body.data) {
        expect(Object.prototype.hasOwnProperty.call(row, 'kycStatus')).toBe(true);
        expect(Object.values(KycStatus) as string[]).toContain(row.kycStatus);
      }
    });

    it('los dos roles reciben EL MISMO DTO (un solo DTO, no dos — §M6-L.2)', async () => {
      const comoAdmin = await list('?pageSize=100');
      const comoOperador = await list('?pageSize=100', operatorToken);
      const claves = (b: ListBody) => Object.keys(b.data[0]).sort();
      expect(claves(comoOperador.body)).toEqual(claves(comoAdmin.body));
      expect(claves(comoAdmin.body)).toEqual(['createdAt', 'email', 'id', 'kycStatus', 'name', 'role', 'status']);
    });

    it('el usuario SIN FILA en `KycProfile` emite `none` (no `null`, no clave ausente)', async () => {
      const res = await list(`?q=${TAG}.sinFila&pageSize=100`);
      expect(res.body.total).toBe(1);
      expect(res.body.data[0].kycStatus).toBe('none');
    });
  });

  // ---------------------------------------------------------------- L-2
  describe('⭐ `L-2` — PARTICIÓN: el filtro devuelve exactamente lo que el DTO afirma', () => {
    it('cada fila devuelta trae el estado pedido, y los CUATRO `total` suman el `total` sin filtro', async () => {
      const sinFiltro = await list('?pageSize=1');
      const totales: Record<string, number> = {};
      for (const estado of Object.values(KycStatus)) {
        const res = await list(`?kycStatus=${estado}&pageSize=100`);
        expect(res.status).toBe(200);
        for (const row of res.body.data) expect(row.kycStatus).toBe(estado);
        totales[estado] = res.body.total;
      }
      const suma = Object.values(totales).reduce((a, b) => a + b, 0);
      // Si `none` no incluyera al usuario SIN FILA, esta suma quedaría CORTA. Ése es el caso que
      // la partición caza y que ningún mock simula.
      expect(suma).toBe(sinFiltro.body.total);
      expect(totales.pending).toBeGreaterThanOrEqual(1);
    });

    it('el filtro es SERVER-SIDE: `total` es el tamaño de la COLA, no el de la página (§M6-L.5)', async () => {
      const pagina = await list('?kycStatus=none&pageSize=1');
      const cola = await list('?kycStatus=none&pageSize=100');
      expect(pagina.body.data.length).toBe(1);
      expect(pagina.body.total).toBe(cola.body.total);
      expect(pagina.body.total).toBeGreaterThan(1);
    });
  });

  // ---------------------------------------------------------------- L-3
  describe('⭐⭐ `L-3` — `q` + `kycStatus` es INTERSECCIÓN, no unión', () => {
    it('`?q=<A>&kycStatus=none` no devuelve ni a A (que casa con `q` pero es `verified`) ni a B (que es `none` pero no casa)', async () => {
      const qA = `${TAG}.verified`;
      const soloQ = await list(`?q=${qA}&pageSize=100`);
      expect(soloQ.body.total).toBe(1); // A existe y `q` lo encuentra

      const res = await list(`?q=${qA}&kycStatus=none&pageSize=100`);
      expect(res.status).toBe(200);
      // Ni A (casa con q, pero `verified`) ni B (`none`, pero no casa con q): CERO.
      expect(res.body.total).toBe(0);
      expect(res.body.data).toEqual([]);
    });

    it('el buscador SOBREVIVE al segundo filtro: `?q=<TAG>&kycStatus=none` devuelve solo los DOS `none` del TAG', async () => {
      const res = await list(`?q=${TAG}&kycStatus=none&pageSize=100`);
      const emails = res.body.data.map((r) => r.email).sort();
      // Si un segundo `where.OR` hubiera pisado al del buscador, aquí saldría TODO el padrón `none`.
      expect(emails).toEqual([`${TAG}.rowNone@e2e.local`, `${TAG}.sinFila@e2e.local`]);
      expect(res.body.total).toBe(2);
    });

    it('los TRES ejes a la vez (`q` + `status` + `kycStatus`) siguen siendo AND', async () => {
      const ok = await list(`?q=${TAG}&status=active&kycStatus=pending&pageSize=100`);
      expect(ok.body.total).toBe(1);
      expect(ok.body.data[0].email).toBe(`${TAG}.pending@e2e.local`);

      const vacio = await list(`?q=${TAG}&status=blocked&kycStatus=pending&pageSize=100`);
      expect(vacio.body.total).toBe(0);
    });

    it('`?kycStatus=` (cadena vacía) ≡ ausente: el `Select` en «Todas» no rompe la pantalla', async () => {
      const vacio = await list(`?q=${TAG}&kycStatus=&pageSize=100`);
      const ausente = await list(`?q=${TAG}&pageSize=100`);
      expect(vacio.status).toBe(200);
      expect(vacio.body.total).toBe(ausente.body.total);
      expect(vacio.body.total).toBe(5);
    });
  });

  // ---------------------------------------------------------------- L-4 / L-5
  describe('`L-4` / `L-5` — el valor inválido es `400`, NUNCA una lista sin filtrar', () => {
    it('`?kycStatus=banana` ⇒ 400 VALIDATION_ERROR con `details.field=kycStatus` (⛔ nunca 200)', async () => {
      const res = await h.api('GET', '/admin/users?kycStatus=banana', { token: adminToken });
      expect(res.status).toBe(400);
      expect((res.body as any).error.code).toBe('VALIDATION_ERROR');
      expect((res.body as any).error.details.field).toBe('kycStatus');
      expect((res.body as any).error.details.allowed).toEqual(['none', 'pending', 'verified', 'rejected']);
    });

    it('⭐ `?status=banana` ⇒ 400 — ANTES de `A5` esto contestaba `500 INTERNAL` (`N-A5-1`, medido)', async () => {
      const res = await h.api('GET', '/admin/users?status=banana', { token: adminToken });
      expect(res.status).toBe(400);
      expect((res.body as any).error.code).toBe('VALIDATION_ERROR');
      expect((res.body as any).error.details.field).toBe('status');
    });

    it('⭐ los dos ejes cruzados: `?status=pending` y `?kycStatus=active` ⇒ 400 diciendo el campo', async () => {
      const cruzado = await h.api('GET', '/admin/users?status=pending', { token: adminToken });
      expect(cruzado.status).toBe(400);
      expect((cruzado.body as any).error.details.field).toBe('status');

      const alReves = await h.api('GET', '/admin/users?kycStatus=active', { token: adminToken });
      expect(alReves.status).toBe(400);
      expect((alReves.body as any).error.details.field).toBe('kycStatus');
    });

    it('el `400` es igual para el `vault_operator` (no hay puerta trasera por rol)', async () => {
      const res = await h.api('GET', '/admin/users?kycStatus=banana', { token: operatorToken });
      expect(res.status).toBe(400);
    });

    it('`D-A5-3` — `?zzz=1` ⇒ 400 (antes: `200` con el padrón entero, ignorado en silencio)', async () => {
      const res = await h.api('GET', '/admin/users?zzz=1', { token: adminToken });
      expect(res.status).toBe(400);
      expect((res.body as any).error.details.field).toBe('zzz');
    });

    it('⚠️ ACOTADO a este endpoint: otra ruta admin SIGUE tolerando query de más (⛔ no es regla global)', async () => {
      const res = await h.api('GET', '/admin/users/' + sembrados[0] + '?zzz=1', { token: adminToken });
      expect(res.status).toBe(200);
    });

    it('sin token sigue siendo 401 y con token de cliente 403 (la validación no adelanta al guard)', async () => {
      const anon = await h.api('GET', '/admin/users?kycStatus=banana');
      expect(anon.status).toBe(401);
      const cliente = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
      const prohibido = await h.api('GET', '/admin/users?kycStatus=banana', { token: cliente });
      expect(prohibido.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------- L-6
  describe('`L-6` — el listado sigue SIN acercarse al documento (`K-2` re-ejecutado)', () => {
    it.each([
      ['super_admin', () => adminToken],
      ['vault_operator', () => operatorToken],
    ])('con token %s el JSON no matchea `/kyc_ine\\//` ni trae `rejectionReason`/`ineOnFile`', async (_rol, tok) => {
      for (const query of ['?pageSize=100', '?kycStatus=pending&pageSize=100', '?kycStatus=rejected&pageSize=100']) {
        const res = await list(query, tok());
        expect(res.status).toBe(200);
        expect(res.text).not.toMatch(/kyc_ine\//);
        expect(res.text).not.toMatch(/rejectionReason/);
        expect(res.text).not.toMatch(/ineOnFile/);
        expect(res.text).not.toMatch(/clabe/i);
        expect(res.text).not.toMatch(/rfc/i);
      }
    });

    it('un usuario RECHAZADO con motivo escrito: el motivo NO sale por el listado (sí por la ficha)', async () => {
      const id = await seedUser('conMotivo', KycStatus.rejected);
      await h.prisma.kycProfile.update({
        where: { userId: id },
        data: { rejectionReason: 'MOTIVO-QUE-NO-DEBE-VIAJAR-EN-LA-LISTA' },
      });
      const res = await list(`?q=${TAG}.conMotivo&kycStatus=rejected&pageSize=100`);
      expect(res.body.total).toBe(1);
      expect(res.text).not.toMatch(/MOTIVO-QUE-NO-DEBE-VIAJAR/);
    });
  });

  // ---------------------------------------------------------------- orden
  describe('⛔ el ORDEN no es de esta ficha (`A5-b`, `M-56`)', () => {
    it('con `?kycStatus=pending` el orden sigue siendo `createdAt desc` del listado', async () => {
      const res = await list('?kycStatus=pending&pageSize=100');
      const fechas = await Promise.all(
        res.body.data.map(async (r) => {
          const u = await h.prisma.user.findUnique({ where: { id: r.id }, select: { createdAt: true } });
          return u!.createdAt.getTime();
        }),
      );
      const desc = [...fechas].sort((a, b) => b - a);
      expect(fechas).toEqual(desc);
    });
  });
});
