/**
 * vault-sealed-enum-filters.e2e-spec.ts — ⭐⭐ **`EQ-D0` / `P-93`: la bóveda del CLIENTE ignoraba en
 * silencio sus propios filtros.** (API_CONTRACT §3 `GET /vault/sealed` · §M1
 * `GET /admin/vaults/:userId/sealed` · §0-Q puntos 1 y 6. Dueño: backend.)
 *
 * ### El defecto, medido por QA por HTTP con sesión de CLIENTE (2026-09-13, sobre `91d4318`)
 *
 * ```
 * /vault/sealed                     200 → 2 grupos  [box/mint, etb/minor_box_damage]
 * /vault/sealed?sealedSubtype=box   200 → 1 grupo   ← filtra bien
 * /vault/sealed?sealedSubtype=zzz   200 → 2 grupos  ← LA BÓVEDA ENTERA
 * /vault/sealed?condition=zzz       200 → 2 grupos  ← LA BÓVEDA ENTERA
 * ```
 *
 * El patrón era `if (q.x && SET.has(q.x))` (`vault.service.ts:327` y `:330`): si el valor no está en
 * el dominio, **la condición entera se cae** y el `where` sale sin ese filtro. El cliente pide *«mi
 * sellado, filtrado a cajas»* y recibe **todo su sellado** con cara de lista filtrada.
 *
 * ### Por qué ESTA fila de las 22, y no otra (techlead, y es lo que la desbloqueó)
 * Su defecto **no depende de la decisión de clase del arquitecto**: ignorar el filtro en silencio lo
 * prohíbe §0-Q punto 1 **sea cual sea la clase** que se le asigne. Y es *«la única fila de las 22
 * donde quien recibe la mentira no es personal nuestro y no tiene cómo notarlo»*: un operador que ve
 * una lista admin sin filtrar tiene otros caminos para darse cuenta; un cliente que mira «mi
 * sellado, filtrado a cajas» y recibe todo su sellado, **no**.
 *
 * ### El contraste que lo prueba: no es que la plataforma no valide, es que esta pantalla no
 * El **mismo nombre de eje** sobre el **mismo enum** en `/catalog/sealed?sealedSubtype=zzz` ⇒ `400`.
 * Se mide aquí al lado, porque un arreglo que dejara la bóveda distinta de su hermana pública
 * seguiría siendo dos respuestas para la misma pregunta.
 *
 * ### `?sort=` — clamp silencioso, §0-Q punto 6
 * `const sort = q.sort ?? 'value_desc'` y un `else` que se tragaba todo: `?sort=zzz` devolvía el
 * orden por valor **sin decirlo**. El dominio NO se inventa: lo declara la línea del endpoint en
 * `API_CONTRACT.md` §3 (*«`sort` default `value_desc`; también `count_desc | name_asc`»*), y su
 * paridad contrato↔literal la vigila `C-EQ-1` (bloque de clase L).
 *
 * ### ⚠️ Lo que se midió ANTES de cambiar conducta publicada (y por qué no es `D-EQ-3` otra vez)
 * Pasar de «ignora en silencio» a `400` cambia lo que un cliente podría estar viviendo hoy. Medido
 * sobre el frontend (solo lectura, 2026-09-13): `getVaultSealed()` es
 * `apiRequest('/vault/sealed')` **sin querystring** y `getAdminVaultSealed(userId)` es
 * `apiRequest('/admin/vaults/<id>/sealed')` **sin querystring** (`frontend/src/lib/api.ts:612-620`);
 * su ÚNICO consumidor es `SealedVaultPanel.tsx:35`, que **no tiene control de filtro ni de orden** y
 * **no lee la URL**. Luego ninguna pantalla puede emitir hoy un valor fuera de dominio por estos tres
 * ejes: el `400` es inalcanzable desde el producto. **No es la situación de `D-EQ-3`** (allí el front
 * SÍ mandaba `productType=sealed` y por eso iba primero).
 */
import { SealedCondition, SealedSubtype } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { VAULT_SEALED_SORT_VALUES } from '../../src/modules/vault/vault.service';

type ErrorBody = { error: { code: string; message: string; details: Record<string, unknown> } };
type Res = { status: number; body: ErrorBody & { data?: unknown[] }; text: string };

/**
 * ⭐ **El fixture, y por qué son TRES piezas y no dos.**
 *
 * QA midió el defecto con dos (`box/mint` y `etb/minor_box_damage`) y eso basta para los filtros.
 * Para el **ORDEN** no basta: con un grupo de 1 y otro de 1, y sin mercado (las dos valen `null`),
 * `value_desc`, `count_desc` y `name_asc` **coinciden** y ninguna prueba podría distinguir «ordena»
 * de «no hace nada» — el `QA-M3` del punto 6. Con **dos** piezas `box` el conteo desempata, y con
 * `sealedProductName` invertido respecto del conteo (`ZZZ` la caja, `AAA` el ETB) `count_desc` y
 * `name_asc` dan órdenes **opuestos**.
 */
const FOLIOS = ['EQD0-BOX-MINT-1', 'EQD0-BOX-MINT-2', 'EQD0-ETB-DANO'];
const NOMBRE_BOX = 'ZZZ Caja EQ-D0';
const NOMBRE_ETB = 'AAA ETB EQ-D0';

describe('⭐⭐ `EQ-D0` / `P-93` — la bóveda del CLIENTE no puede ignorar sus filtros en silencio', () => {
  let h: E2EHarness;
  let clienteToken: string;
  let adminToken: string;
  let clienteId: string;

  beforeAll(async () => {
    h = await E2EHarness.create();
    clienteToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const cliente = await h.prisma.user.findFirstOrThrow({
      where: { email: E2E_USERS.customer.email },
      select: { id: true },
    });
    clienteId = cliente.id;
    const card = await h.prisma.card.findFirstOrThrow({ select: { id: true } });
    // Las DOS piezas de la medición de QA: `box/mint` y `etb/minor_box_damage`. Sin ellas, «filtra»
    // no sería observable y el `200` de este endpoint sería un verde por omisión (`QA-M3`).
    await h.prisma.inventoryItem.deleteMany({ where: { folio: { in: FOLIOS } } });
    await h.prisma.inventoryItem.createMany({
      data: [
        { folio: FOLIOS[0], cardId: card.id, productType: 'sealed', sealedSubtype: 'box', sealedCondition: 'mint', sealedProductName: NOMBRE_BOX, tcgplayerProductId: 970001, status: 'in_custody', ownerType: 'customer', ownerUserId: clienteId, ownershipStatus: 'settled', acquisitionType: 'aportacion_en_especie' },
        { folio: FOLIOS[1], cardId: card.id, productType: 'sealed', sealedSubtype: 'box', sealedCondition: 'mint', sealedProductName: NOMBRE_BOX, tcgplayerProductId: 970001, status: 'in_custody', ownerType: 'customer', ownerUserId: clienteId, ownershipStatus: 'settled', acquisitionType: 'aportacion_en_especie' },
        { folio: FOLIOS[2], cardId: card.id, productType: 'sealed', sealedSubtype: 'etb', sealedCondition: 'minor_box_damage', sealedProductName: NOMBRE_ETB, tcgplayerProductId: 970002, status: 'in_custody', ownerType: 'customer', ownerUserId: clienteId, ownershipStatus: 'settled', acquisitionType: 'aportacion_en_especie' },
      ],
    });
  }, 180000);

  afterAll(async () => {
    if (h) await h.prisma.inventoryItem.deleteMany({ where: { folio: { in: FOLIOS } } });
    await h?.close();
  });

  /**
   * Las DOS rutas hermanas: el defecto vive en el servicio compartido (`VaultService.sealedTab`), así
   * que se miden las dos — la del cliente y la del operador.
   *
   * ⚠️ `it.each` evalúa su tabla **al recolectar**, antes de `beforeAll`: una tabla con los tokens
   * dentro los captura `undefined` y las 24 pruebas salen `401`. Medido al escribir esto. Por eso la
   * tabla lleva solo el NOMBRE y la ruta/el token se resuelven **dentro** de cada prueba.
   */
  const VISTAS = [['cliente'], ['admin']] as const;
  const vistaDe = (v: string): { ruta: string; token: string } =>
    v === 'cliente'
      ? { ruta: '/vault/sealed', token: clienteToken }
      : { ruta: `/admin/vaults/${clienteId}/sealed`, token: adminToken };

  const get = (v: string, qs: string): Promise<Res> => {
    const { ruta, token } = vistaDe(v);
    return h.api<ErrorBody>('GET', `${ruta}${qs}`, { token }) as Promise<Res>;
  };

  const grupos = (r: Res): number => (r.body.data as unknown[]).length;

  describe('la siembra hace la medición POSIBLE (sin esto, el `200` no demuestra nada)', () => {
    it.each(VISTAS)('%s — sin filtrar: 2 grupos', async (v) => {
      const r = await get(v, '');
      expect(r.status).toBe(200);
      expect(grupos(r)).toBe(2);
    });
  });

  describe('§0-Q punto 1 fila 2 — un token del dominio FILTRA', () => {
    it.each(VISTAS)('%s — `?sealedSubtype=box` ⇒ 1 grupo de 2', async (v) => {
      const r = await get(v, '?sealedSubtype=box');
      expect(r.status).toBe(200);
      expect(grupos(r)).toBe(1);
    });

    it.each(VISTAS)('%s — `?condition=mint` ⇒ 1 grupo de 2', async (v) => {
      const r = await get(v, '?condition=mint');
      expect(r.status).toBe(200);
      expect(grupos(r)).toBe(1);
    });
  });

  describe('⭐ §0-Q punto 1 fila 3 — ⛔ PROHIBIDO ignorar el filtro: basura ⇒ `400`, JAMÁS la bóveda entera', () => {
    it.each(VISTAS)('%s — `?sealedSubtype=zzz` ⇒ 400 (hoy: 200 con los 2 grupos)', async (v) => {
      const r = await get(v, '?sealedSubtype=zzz');
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
      expect(r.body.error.details.field).toBe('sealedSubtype');
      // El dominio DECLARADO se DERIVA del enum de Prisma (§0-Q punto 3), no se transcribe.
      expect([...(r.body.error.details.allowed as string[])].sort()).toEqual(
        Object.values(SealedSubtype).sort(),
      );
      // ⛔ `details.value` PROHIBIDO fuera de los seis ejes públicos de los dos catálogos (§0-Q p.2).
      expect(r.body.error.details.value).toBeUndefined();
    });

    it.each(VISTAS)('%s — `?condition=zzz` ⇒ 400 (hoy: 200 con los 2 grupos)', async (v) => {
      const r = await get(v, '?condition=zzz');
      expect(r.status).toBe(400);
      expect(r.body.error.details.field).toBe('condition');
      expect([...(r.body.error.details.allowed as string[])].sort()).toEqual(
        Object.values(SealedCondition).sort(),
      );
      expect(r.body.error.details.value).toBeUndefined();
    });
  });

  describe('⭐ §0-Q punto 6 — ⛔ PROHIBIDO el clamp silencioso del ORDEN', () => {
    it.each(VISTAS)('%s — `?sort=zzz` ⇒ 400 (hoy: 200 ordenado por valor, sin decirlo)', async (v) => {
      const r = await get(v, '?sort=zzz');
      expect(r.status).toBe(400);
      expect(r.body.error.details.field).toBe('sort');
      expect([...(r.body.error.details.allowed as string[])].sort()).toEqual(
        [...VAULT_SEALED_SORT_VALUES].sort(),
      );
    });

    /**
     * ⭐ El equivalente de `QA-M3` para el punto 6: un `200` no demuestra que ORDENE. Se exige que
     * **el token mande** (`count_desc` ≠ `name_asc`, órdenes opuestos por construcción del fixture)
     * y que **el default sea el declarado** (`value_desc` ≡ `?sort=` ausente, §3 del contrato).
     */
    it.each(VISTAS)('%s — el token ORDENA de verdad, y el default es el declarado', async (v) => {
      const nombres = async (qs: string): Promise<string[]> => {
        const r = await get(v, qs);
        expect(r.status).toBe(200);
        return (r.body.data as { productName: string }[]).map((g) => g.productName);
      };
      expect(await nombres('?sort=count_desc')).toEqual([NOMBRE_BOX, NOMBRE_ETB]);
      expect(await nombres('?sort=name_asc')).toEqual([NOMBRE_ETB, NOMBRE_BOX]);
      // El default declarado: `?sort=` ausente ≡ `?sort=value_desc` (⛔ NO `count_desc`).
      expect(await nombres('')).toEqual(await nombres('?sort=value_desc'));
      expect(await nombres('')).not.toEqual(await nombres('?sort=count_desc'));
    });
  });

  describe('§0-Q punto 1 fila 1 — vacío y solo-espacios NO filtran (⛔ nunca `400`)', () => {
    // ⚠️ `if (x)` deja pasar `' '` (un espacio es truthy) y `raw === ''` no lo atrapa: las DOS
    // mitades, no una. El `trim()` decide si viene VACÍO; ⛔ NO «arregla» el token.
    const VACIOS = ['', '%20'];
    for (const vacio of VACIOS) {
      it.each(VISTAS)(`%s — \`?sealedSubtype=${vacio || '(vacío)'}\` ⇒ 200 con los 2 grupos`, async (v) => {
        const r = await get(v, `?sealedSubtype=${vacio}`);
        expect(r.status).toBe(200);
        expect(grupos(r)).toBe(2);
      });
      it.each(VISTAS)(`%s — \`?sort=${vacio || '(vacío)'}\` ⇒ 200 (el DEFAULT, no un 400)`, async (v) => {
        const r = await get(v, `?sort=${vacio}`);
        expect(r.status).toBe(200);
        expect(grupos(r)).toBe(2);
      });
    }

    // ⛔ El `trim()` decide si viene VACÍO, NO «arregla» el token: `' box'` es entrada mal formada.
    // (Fuera del bucle a propósito: con la cadena vacía no hay adorno que medir, y una prueba que se
    // salta a sí misma es un verde que no demuestra nada.)
    it.each(VISTAS)('%s — ⛔ `?sealedSubtype=%%20box` (token CON adorno) ⇒ 400', async (v) => {
      expect((await get(v, '?sealedSubtype=%20box')).status).toBe(400);
    });
  });

  describe('⭐ el contraste: la hermana PÚBLICA ya lo hacía bien — no es que la plataforma no valide', () => {
    it('`/catalog/sealed?sealedSubtype=zzz` ⇒ 400 (el MISMO eje sobre el MISMO enum)', async () => {
      const r = (await h.api<ErrorBody>('GET', '/catalog/sealed?sealedSubtype=zzz', {})) as Res;
      expect(r.status).toBe(400);
      expect(r.body.error.details.field).toBe('sealedSubtype');
    });
  });

  describe('⭐ la cota del eco (§0-Q punto 2) — el tamaño de la respuesta NO lo decide quien la pide', () => {
    const LARGO = 'A'.repeat(5000);
    it.each(VISTAS)('%s — 5 KB de basura NO vuelven íntegros', async (v) => {
      const r = await get(v, `?sealedSubtype=${LARGO}`);
      expect(r.status).toBe(400);
      expect(r.text.includes(LARGO)).toBe(false);
      expect(r.text.length).toBeLessThan(2000);
    });
  });
});
