import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeFeeConfig } from '../../common/money';
import { BusinessException } from '../../common/business.exception';
import {
  SETTING_DEFAULTS,
  SETTING_DTO_MAP,
  SETTING_VALIDATORS,
  SettingKey,
  SettingKeyType,
} from './settings.constants';

/** Cuánto de un valor se imprime en el inventario de arranque (un dial puede ser una tabla). */
const INVENTORY_VALUE_TRUNCATE = 160;

/**
 * SettingsService — Lectura/escritura de los diales M10 (ConfigSetting).
 * Editables sin redeploy. Provee helpers tipados para el resto de módulos.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * §11.0 (v1.50.3-a; **endurecido en v1.50.3-b**) — **INVENTARIO DE CONFIGURACIÓN al arrancar.** Una
   * línea con las claves cuyo valor vigente **difiere de su default de código**.
   *
   * ### ⚠️ Esto NO es observabilidad opcional: es un REQUISITO load-bearing
   * v1.50.3-b lo subió de «extra barato» a **requisito**. Devops verificó que la suite E2E **no puede**
   * usarse como detector de configuración: **escribe** (flip del dial global, un `POST
   * /admin/pricing/override` y un `updateMany` que envejece `capturedDate`) y exige fixtures
   * sintéticos, así que **nunca se apunta a producción**. Descartado el E2E, esta línea y el `GET` del
   * recurso son **los DOS ÚNICOS detectores del seed rancio** — ambos de **solo lectura**, y por eso
   * los únicos que corren contra prod.
   *
   * La regla general de la que sale, y que vale más allá de este caso: *un test que **fija** su propia
   * configuración para ser determinista deja, **por construcción**, de ser un detector de
   * configuración*. Eso es **correcto en el test** (una prueba de lógica debe correr con el dial en su
   * valor nominal); la conclusión no es debilitarlo, es **no confiarle una garantía que no da**.
   * **Configuración y lógica son dos aserciones distintas y exigen dos mecanismos distintos.**
   *
   * ### Por qué existe
   * `prisma/seed.ts` hace `upsert` con **`update: {}`**, y eso es **correcto**: impide que un deploy
   * pise el ajuste deliberado de un operador. El corolario —que nadie había escrito— es que **cambiar
   * un seed NO cambia ningún entorno ya sembrado**: ni prod, ni staging, ni la base de quien ya corrió
   * el seed una vez. Un entorno puede quedarse con el dial viejo **con el código nuevo desplegado y
   * todos los tests en verde**, que es la peor forma de no entregar un cambio.
   *
   * Esta línea convierte *«¿qué diales tiene REALMENTE este entorno?»* en un **grep**, en vez de una
   * consulta a la BD de producción. Es el artefacto barato que hace **verificable** el paso de
   * despliegue de §4.38(p) —y el DoD de release, que exige comprobar los diales del entorno destino en
   * vez de asumirlos.
   *
   * ### Por qué se emite SIEMPRE, incluso sin divergencias
   * Porque **una línea que solo aparece cuando hay problema es indistinguible de una línea que no se
   * emitió porque el código no corrió** — y entonces «no vi la alerta» pasaría por «está todo bien»,
   * que es **fallar abierto**. Con el «sin divergencias» explícito, la ausencia de la línea significa
   * una única cosa: **esto no se ejecutó**, y eso también es información. Por la misma razón, si la
   * lectura falla se emite un `warn` que dice que el inventario **no se pudo emitir**, en vez de
   * quedarse callado (que se leería como «sin divergencias»).
   *
   * ### Por qué es `log`/`info` y NO `warn`
   * Deliberado: **un dial ajustado a propósito es normal**, y alertar por cada uno es ruido que se
   * aprende a ignorar — con lo que el día que haya un `warn` de verdad, nadie lo va a leer. Esto es un
   * **inventario**, no una alarma. La **única** excepción sigue siendo `manualFreshnessDays === null`
   * (I8-bis, §4.38m), que sí es `warn` porque **desactiva un criterio de `PROJECT.md`** — y lo emite
   * `PricingService` al izar SU config, no aquí.
   *
   * ### Lo que este inventario NO hace
   * **No sobrescribe nada.** §11.0 punto 3: `ConfigSetting` guarda un **valor**, no su **procedencia**,
   * así que «sigue en el seed viejo» y «el operador lo eligió así» son **el mismo dato** — y los
   * valores viejos (3, 50, `null`) son elecciones de operador perfectamente plausibles. Adivinar sería
   * destruir en silencio justo lo que `update: {}` protege. La decisión de sobrescribir es del
   * operador, informada y clave por clave, por la vía normal de operación (el `PUT` de admin, que deja
   * `AuditLog` y valida). Esto solo **informa**.
   */
  async onModuleInit(): Promise<void> {
    await this.logConfigInventory();
  }

  /**
   * Emite el inventario de §11.0. **Nunca revienta el arranque**: un fallo aquí es de observabilidad,
   * no de negocio, y tumbar la app por no poder listar diales sería peor que el problema que resuelve.
   */
  async logConfigInventory(): Promise<void> {
    try {
      const rows = await this.prisma.configSetting.findMany();
      const diffs: string[] = [];
      for (const row of rows) {
        const key = row.key as SettingKeyType;
        // Claves sin default de código (retiradas o escritas fuera de banda) no se comparan: no hay
        // contra qué, y listarlas cada arranque sería el ruido que este formato evita.
        // (`hasOwnProperty.call` y no `Object.hasOwn` porque el target del build es anterior a ES2022;
        // mismo motivo que en `update()`. Propiedad PROPIA, nunca heredada del prototipo.)
        if (!Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, key)) continue;
        const seed = SETTING_DEFAULTS[key];
        // ⚠️ Comparación CANÓNICA, no `JSON.stringify` directo. Postgres almacena `jsonb` y **reordena
        // las claves de los objetos**, así que `grading_cost_tiers` vuelve de la BD con el mismo
        // contenido y otro orden de claves: un `stringify` crudo lo declara «DIFERENTE» en CADA
        // arranque. Un inventario que grita cuando no pasa nada es ruido que se aprende a ignorar —
        // exactamente el modo de fallo que esta línea existe para no tener. (El orden de los ARRAYS sí
        // se respeta: en los escalones y en la curva es significativo.)
        if (canonicalJson(row.valueJson) === canonicalJson(seed)) continue;
        diffs.push(
          `${row.key}=${truncateJson(row.valueJson)} (default ${truncateJson(seed as unknown)})`,
        );
      }
      // Una clave AUSENTE en la tabla no se lista: resuelve al default, así que NO difiere.
      //
      // ⚠️ Se emite SIEMPRE, con «sin divergencias» EXPLÍCITO (§11.0 punto 5). Callar cuando todo está
      // bien convertiría la ausencia de la línea en ambigua —«no hay nada que reportar» vs. «esto no
      // corrió»— y eso falla ABIERTO.
      if (diffs.length === 0) {
        this.logger.log(
          `config inventory: SIN DIVERGENCIAS — las ${rows.length} clave(s) sembradas están en su ` +
            'default de código. (§11.0: un seed es una condición inicial y los cambios de seed NO ' +
            'llegan solos a un entorno ya sembrado; esta línea es —junto al GET del recurso— uno de ' +
            'los dos detectores del seed rancio, así que se emite siempre, también cuando no hay nada.)',
        );
        return;
      }
      this.logger.log(
        `config inventory: ${diffs.length} de ${rows.length} clave(s) DIFIEREN de su default de ` +
          `código → ${diffs.sort().join('; ')}. (§11.0: es un INVENTARIO, no una alarma — un dial ` +
          'ajustado a propósito es normal. Si alguno debía haberse actualizado con el deploy, se ' +
          'aplica por PUT de admin —auditado y validado—, NUNCA por UPDATE directo a la BD.)',
      );
    } catch (e) {
      // Se dice EN VOZ ALTA que el inventario NO se pudo emitir. El silencio aquí se leería como «sin
      // divergencias», que es exactamente la confusión que §11.0 punto 5 prohíbe.
      this.logger.warn(
        `config inventory: NO SE PUDO EMITIR el inventario de arranque (§11.0): ` +
          `${(e as Error).message}. Este entorno queda SIN uno de sus dos detectores del seed rancio ` +
          '(el otro es GET /admin/pricing/graded-estimates). El arranque CONTINÚA.',
      );
    }
  }

  /** Lee un dial; si no existe fila, devuelve el default. */
  async get<T = unknown>(key: SettingKeyType): Promise<T> {
    const row = await this.prisma.configSetting.findUnique({ where: { key } });
    if (row) return row.valueJson as T;
    return SETTING_DEFAULTS[key] as T;
  }

  async getNumber(key: SettingKeyType): Promise<number> {
    return Number(await this.get<number>(key));
  }

  async getString(key: SettingKeyType): Promise<string> {
    return String(await this.get<string>(key));
  }

  /**
   * v1.44 (R1, §4.35d) — Lee VARIOS diales en **UNA** query y devuelve un `Map` que contiene
   * **SOLO las filas EXISTENTES**: una clave AUSENTE simplemente no aparece en el `Map`.
   *
   * Es lo que `get()`/`getRaw()` **no** pueden dar: ambos hacen fallback a `SETTING_DEFAULTS`, así que
   * un lector no distingue «la fila no existe» de «la fila existe con el valor del seed». Esa distinción
   * es obligatoria para cualquier dial FAIL-CLOSED que, por doctrina money-safe, **no puede tener default
   * de código** (hoy: `grading_cost_tiers`, ARCHITECTURE §4.35d).
   *
   * Efecto secundario deseado: N claves ⇒ 1 query (en vez de N `findUnique`), que es como se ha izado
   * la config del gancho por request.
   */
  async getRawMany(keys: readonly SettingKeyType[]): Promise<Map<SettingKeyType, unknown>> {
    if (keys.length === 0) return new Map();
    const rows = await this.prisma.configSetting.findMany({
      where: { key: { in: [...new Set(keys)] } },
    });
    return new Map(rows.map((r) => [r.key as SettingKeyType, r.valueJson as unknown]));
  }

  /** Config de comisión Stripe para el gross-up (ARCHITECTURE §5.1). */
  async getStripeFee(): Promise<StripeFeeConfig> {
    return {
      stripePct: await this.getNumber(SettingKey.STRIPE_FEE_PCT),
      stripeFixedCents: await this.getNumber(SettingKey.STRIPE_FEE_FIXED_CENTS),
      // v1.40 (Enmienda A, P-37): el IVA que Stripe MX cobra SOBRE su comisión deja de tener dial
      // propio (`stripe_fee_iva_pct`, retirado) y se DERIVA de la fuente única `IVA_PCT` (porcentaje
      // [0,100] → fracción). Matemáticamente idéntico al centavo (16/100 = 0.16); el neteo NO cambia.
      // La clave de BD `stripe_fee_iva_pct` queda inerte: NUNCA se lee (jamás cae a la fila vieja ni a 0).
      stripeFeeIvaPct: (await this.getNumber(SettingKey.IVA_PCT)) / 100,
    };
  }

  /** Devuelve todos los diales como el DTO camelCase del contrato (API_CONTRACT §M10). */
  async getAllDto(): Promise<Record<string, unknown>> {
    const dto: Record<string, unknown> = {};
    for (const [dtoKey, settingKey] of Object.entries(SETTING_DTO_MAP)) {
      dto[dtoKey] = await this.get(settingKey);
    }
    return dto;
  }

  /**
   * Actualiza uno o varios diales (upsert). Devuelve los cambios aplicados.
   * Fix correctness #2: valida CADA dial por tipo+rango antes de persistir y RECHAZA
   * keys desconocidas con 422 (antes se ignoraban en silencio). La validación es
   * "todo o nada": si algún valor es inválido, no se escribe ninguno.
   *
   * ### v2.1.6 (P48-B1, fase de seguridad) — tres agujeros en un endpoint que gobierna dinero
   *
   * Este endpoint gobierna **IVA, comisiones, topes AML y el umbral de INE**. Tenía:
   *
   * 1. **Lista blanca esquivable por la CADENA DE PROTOTIPOS.** `SETTING_DTO_MAP[dtoKey]` con
   *    `dtoKey = '__proto__'` / `'constructor'` / `'toString'` devuelve algo **truthy** heredado de
   *    `Object.prototype`, así que pasaba el `if (!settingKey)` y llegaba al `upsert` con una clave
   *    **no-string** ⇒ 500. Se cierra con `Object.hasOwn` (propiedad PROPIA, no heredada).
   * 2. **El «todo o nada» que promete este comentario era FALSO en la escritura.** La validación sí
   *    era atómica, pero los `upsert` corrían **sin transacción**: cualquier fallo a mitad —no solo
   *    el de `__proto__`— dejaba unos diales escritos y otros no. Ahora van en `$transaction`.
   * 3. **La bitácora se perdía justo donde más importa.** El controller auditaba **después** de que
   *    `update()` retornara, así que una excepción **saltaba el `audit.log`**: el dial que sí se
   *    persistió no dejaba entrada. Ahora la fila de auditoría se escribe **DENTRO de la misma
   *    transacción** que los cambios, así que efecto y bitácora **commitean o revierten juntos** —
   *    es imposible que exista uno sin el otro, en cualquier orden de fallo.
   */
  async update(
    dtoPartial: Record<string, unknown>,
    actorUserId?: string,
    // v2.1.6 (P48-B1): la auditoría entra a la MISMA transacción. Se pasa como callback para no
    // acoplar `SettingsService` a `AuditService` (el módulo de settings no lo importa hoy).
    auditWithin?: (tx: Prisma.TransactionClient, applied: Record<string, unknown>) => Promise<void>,
  ): Promise<Record<string, unknown>> {
    // ⚠️ `Object.create(null)` y NO `{}`. El acumulador de errores se indexa con claves CONTROLADAS
    // POR EL ATACANTE, y sobre un objeto normal `errors['__proto__'] = 'unknown setting key'` **no
    // crea propiedad**: es el setter de `[[Prototype]]`, que con un string es un no-op silencioso.
    // Resultado: el error se PERDÍA, `Object.keys(errors).length` seguía en 0 y la petición
    // continuaba como si fuera válida. Es la MISMA clase de agujero que la lista blanca, un nivel más
    // abajo — y por eso las dos puntas se cierran juntas.
    const errors: Record<string, string> = Object.create(null) as Record<string, string>;
    const validated: { dtoKey: string; settingKey: SettingKeyType; value: unknown }[] = [];

    for (const [dtoKey, value] of Object.entries(dtoPartial)) {
      // ⚠️ Propiedad PROPIA y NO `SETTING_DTO_MAP[dtoKey]`: con `__proto__`, `constructor` o
      // `toString` el acceso indexado devuelve un heredado TRUTHY y la clave desconocida se colaba
      // hasta el `upsert`. (`hasOwnProperty.call` y no `Object.hasOwn` porque el target del build es
      // ES2021; son equivalentes y esto no obliga a mover la configuración de compilación.)
      if (!Object.prototype.hasOwnProperty.call(SETTING_DTO_MAP, dtoKey)) {
        errors[dtoKey] = 'unknown setting key';
        continue;
      }
      const settingKey = SETTING_DTO_MAP[dtoKey];
      // Defensa en profundidad: aunque `hasOwn` ya lo garantiza, el valor tiene que ser una clave
      // string real antes de tocar la BD (un `upsert` con clave no-string es un 500, no un 422).
      if (typeof settingKey !== 'string') {
        errors[dtoKey] = 'unknown setting key';
        continue;
      }
      const validate = SETTING_VALIDATORS[settingKey];
      const msg = validate ? validate(value) : null;
      if (msg) {
        errors[dtoKey] = msg;
        continue;
      }
      validated.push({ dtoKey, settingKey, value });
    }

    if (Object.keys(errors).length > 0) {
      // `{ ...errors }` para que el serializador reciba un objeto normal (el de prototipo nulo es
      // para ACUMULAR con claves hostiles, no necesariamente para viajar).
      throw BusinessException.validation('VALIDATION_ERROR', 'Invalid settings payload', {
        errors: { ...errors },
      });
    }

    // TODO O NADA DE VERDAD: los upserts y la bitácora, en una sola transacción.
    return this.prisma.$transaction(async (tx) => {
      const applied: Record<string, unknown> = {};
      for (const { dtoKey, settingKey, value } of validated) {
        await tx.configSetting.upsert({
          where: { key: settingKey },
          create: { key: settingKey, valueJson: value as object, updatedBy: actorUserId },
          update: { valueJson: value as object, updatedBy: actorUserId },
        });
        applied[dtoKey] = value;
      }
      // Dentro del alcance del fallo: si esto revienta, los diales revierten; si un dial revienta,
      // no queda bitácora de un cambio que no ocurrió.
      if (auditWithin) await auditWithin(tx, applied);
      return applied;
    });
  }

  async getRaw(key: SettingKeyType): Promise<unknown> {
    return this.get(key);
  }
}

/** Serializa un valor de dial para el log, acotado: un dial puede ser una tabla de 6 escalones. */
function truncateJson(v: unknown): string {
  const raw = JSON.stringify(v) ?? String(v);
  return raw.length <= INVENTORY_VALUE_TRUNCATE ? raw : `${raw.slice(0, INVENTORY_VALUE_TRUNCATE)}…`;
}

/**
 * JSON **canónico**: mismas claves y mismos valores ⇒ misma cadena, sin importar el orden en que el
 * motor las devuelva. Solo se ordenan las claves de los OBJETOS; el orden de los ARRAYS se conserva
 * porque en los diales que son listas (escalones de grading, puntos de la curva) **es significativo**.
 */
function canonicalJson(v: unknown): string {
  const canon = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(canon);
    if (x !== null && typeof x === 'object') {
      const src = x as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(src).sort()) out[k] = canon(src[k]);
      return out;
    }
    return x;
  };
  return JSON.stringify(canon(v)) ?? String(v);
}
