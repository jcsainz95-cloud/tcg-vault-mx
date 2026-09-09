import {
  SETTING_DEFAULTS,
  SETTING_DTO_MAP,
  SETTING_VALIDATORS,
  SettingKey,
  validateIvaTransferPct,
} from '../src/modules/settings/settings.constants';

/**
 * ⭐ **`iva_transfer_pct` — EL DIAL DE TRASLACIÓN, EN EL DEPLOY 1: SEMBRADO, VALIDADO Y MUDO.**
 * (`ARCHITECTURE §4.44.g` + `§11 M-50.4`; `API_CONTRACT §M10-IVA.1` y `§M10-IVA.5` candado `IVA-8(e)`.)
 *
 * **Qué es y qué NO es.** Es la **FRACCIÓN DE IVA QUE SE TRASLADA** al precio exhibido, en puntos
 * porcentuales enteros `[0,100]`. ⛔ **No son puntos de IVA** y ⛔ **no es la tasa**. Bajar el dial
 * **no baja el impuesto: baja el precio exhibido**, y esa diferencia sale del **margen**.
 *
 * **Qué prueba este fichero, que es exactamente lo que el deploy 1 debe tener y nada más:**
 *  - el seed es **100** (el NEUTRO) y **sin lógica** — candado `IVA-8(e)`;
 *  - el validador es **ENTERO**, por la misma razón que `iva_pct` y `aportacion_pct`: **la COLUMNA**;
 *  - ⛔ y la clave **NO está en `SETTING_DTO_MAP`**, así que en el deploy 1 **ni sale por
 *    `GET /admin/settings` ni entra por `PUT /admin/settings`** — el contrato observable no cambia
 *    (`§4.44.k`) y la segunda puerta no existe (`IVA-8(b)`). Su única puerta será
 *    `PUT /admin/settings/iva-transfer` **con acuse**, y esa abre en el **DEPLOY 2**.
 *
 * ### Cómo se comprobó que esto es un candado
 * Mutación **M11**, sobre una COPIA del árbol: `validateIvaTransferPct` relajado de `isInt` a
 * `isNum` (mismo rango). Antes de escribir este fichero **sobrevivía: 0 rojos** — el dial se había
 * cableado sin una sola prueba propia. Con él: **10 rojos**. *Por eso se corre la batería de
 * mutación antes de decir que algo está probado.*
 */
describe('`iva_transfer_pct` — el dial en el DEPLOY 1 (§4.44.g)', () => {
  describe('⭐ el validador es ENTERO, y el «entero» es la COLUMNA (`Order.ivaTransferPct` es `Int`)', () => {
    it.each([0, 1, 37, 50, 99, 100])('acepta %s (el criterio 187 exige 0/37/50/100)', (v) => {
      expect(validateIvaTransferPct(v)).toBeNull();
    });

    // ⭐ RED CON LA MUTACIÓN `isInt` → `isNum`: son los valores que se truncarían EN SILENCIO en la
    // columna mientras el precio exhibido se calculó con el decimal (defecto TD-IVA-1/TD-IVA-2).
    it.each([37.5, 0.5, 99.9, 50.0001, 1e-9])('⛔ RECHAZA el decimal %s', (v) => {
      expect(validateIvaTransferPct(v)).not.toBeNull();
    });

    it.each([-1, 101, 1000, -0.5, NaN, Infinity])('⛔ RECHAZA fuera de banda: %s', (v) => {
      expect(validateIvaTransferPct(v)).not.toBeNull();
    });

    it.each([null, undefined, '50', true, {}, [], '37.5'])('⛔ RECHAZA el no-número %s', (v) => {
      expect(validateIvaTransferPct(v as unknown)).not.toBeNull();
    });

    it('⭐ el mensaje NOMBRA LOS DOS EXTREMOS (lo exige `IVA-8(d)`) y dice por qué es entero', () => {
      const msg = validateIvaTransferPct(37.5)!;
      expect(msg).toContain('0');
      expect(msg).toContain('100');
      expect(msg).toContain('Order.ivaTransferPct');
      // Que diga QUÉ se traslada: el error es la única superficie donde el operador lee la unidad.
      expect(msg).toMatch(/transferred|TRANSFERRED/);
    });

    it('está registrado en `SETTING_VALIDATORS` bajo su clave (si no, no lo aplica nadie)', () => {
      expect(SETTING_VALIDATORS[SettingKey.IVA_TRANSFER_PCT]).toBe(validateIvaTransferPct);
    });
  });

  describe('⭐ `IVA-8(e)` — el seed es 100 (el NEUTRO) y no hay lógica detrás', () => {
    it('`SETTING_DEFAULTS[\'iva_transfer_pct\'] === 100`', () => {
      expect(SettingKey.IVA_TRANSFER_PCT).toBe('iva_transfer_pct');
      expect(SETTING_DEFAULTS[SettingKey.IVA_TRANSFER_PCT]).toBe(100);
    });

    it('es un literal, no una derivación de `iva_pct` (⛔ los dos diales son independientes)', () => {
      // Media pieza de `IVA-7` ya afirmable en el deploy 1: si alguien derivara uno del otro, mover
      // la TASA movería el PRECIO EXHIBIDO de todo el catálogo. Son dos filas y ninguna cuelga de la otra.
      expect(SETTING_DEFAULTS[SettingKey.IVA_PCT]).toBe(16);
      expect(SETTING_DEFAULTS[SettingKey.IVA_TRANSFER_PCT]).toBe(100);
      expect(SETTING_DEFAULTS[SettingKey.IVA_TRANSFER_PCT]).not.toBe(
        SETTING_DEFAULTS[SettingKey.IVA_PCT],
      );
    });

    it('el default vale para el validador (un seed que su propio validador rechazaría es una bomba)', () => {
      expect(validateIvaTransferPct(SETTING_DEFAULTS[SettingKey.IVA_TRANSFER_PCT])).toBeNull();
    });
  });

  describe('⛔ DEPLOY 1: el dial NO tiene puerta y NO viaja (contrato observable sin cambios)', () => {
    it('⭐ NO está en `SETTING_DTO_MAP` ⇒ ni sale del `GET` ni entra por el `PUT` genérico', () => {
      // No hace falta código de rechazo: hace falta NO estar aquí. `update()` valida contra este mapa
      // con `hasOwnProperty` ⇒ `422 unknown setting key`. Mismo precedente exacto que `stripeFeeIvaPct`
      // (v1.40) y que `fxRateMode` (v1.63). Candado `IVA-8(b)`.
      expect(Object.prototype.hasOwnProperty.call(SETTING_DTO_MAP, 'ivaTransferPct')).toBe(false);
      expect(Object.values(SETTING_DTO_MAP)).not.toContain(SettingKey.IVA_TRANSFER_PCT);
    });

    it('⛔ tampoco se coló con otro nombre de DTO apuntando a la misma clave', () => {
      const apuntan = Object.entries(SETTING_DTO_MAP).filter(([, k]) => k === SettingKey.IVA_TRANSFER_PCT);
      expect(apuntan).toEqual([]);
    });

    it('⛔ y el hueco del SEGUNDO dial queda PREPARADO, NO CONSTRUIDO (§4.44.g)', () => {
      // «El día que el dueño decida meter la comisión al precio exhibido, el hueco es
      // `commission_transfer_pct`.» En ESTE pase no existe la clave, ni el validador, ni el DTO.
      expect(Object.values(SettingKey)).not.toContain('commission_transfer_pct');
      expect(SETTING_DEFAULTS as Record<string, unknown>).not.toHaveProperty('commission_transfer_pct');
    });
  });
});
