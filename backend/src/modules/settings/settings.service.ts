import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeFeeConfig } from '../../common/money';
import { BusinessException } from '../../common/business.exception';
import {
  RETIRED_SETTING_KEYS,
  SETTING_DEFAULTS,
  SETTING_DTO_MAP,
  SETTING_VALIDATORS,
  SettingKey,
  SettingKeyType,
  validateBuylistCrossDials,
} from './settings.constants';

/** Cuánto de un valor se imprime en el inventario de arranque (un dial puede ser una tabla). */
const INVENTORY_VALUE_TRUNCATE = 160;
/** Contexto que se imprime ANTES de la primera diferencia, para que se lea con qué contrasta. */
const INVENTORY_DIFF_LEAD = 40;

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
      // v1.51 (M-46, §4.38r.1) — PRIMERO las RETIRADAS PRESENTES, y **antes** del `return` temprano de
      // «sin divergencias»: tras el colapso a un dial, producción queda justo en ese caso (ninguna
      // divergencia y las dos filas viejas ahí), que es exactamente el entorno donde callarlas sería
      // peor. Una clave retirada que aparece en la tabla sin rótulo es una TRAMPA DE DIAGNÓSTICO:
      // alguien lee `graded_estimate_ingest_enabled = off` y concluye que el ingest está apagado
      // MIENTRAS GASTA (lo que gobierna es `grading_hook_enabled`, y puede estar en `on`).
      this.logRetiredKeys(rows);
      const diffs: string[] = [];
      // v1.50.3-c (techlead): denominador = las claves COMPARABLES, no `rows.length`. La tabla puede
      // tener claves sin default de código (retiradas, o escritas fuera de banda) que el `continue` de
      // abajo salta; contarlas afirmaba «las N claves están en su default» sobre filas que ni siquiera
      // se miraron. En una línea cuyo único propósito es que se pueda confiar en ella, sobre-afirmar
      // es el peor defecto posible.
      let comparable = 0;
      for (const row of rows) {
        const key = row.key as SettingKeyType;
        // Claves sin default de código (retiradas o escritas fuera de banda) no se comparan: no hay
        // contra qué, y listarlas cada arranque sería el ruido que este formato evita.
        // (`hasOwnProperty.call` y no `Object.hasOwn` porque el target del build es anterior a ES2022;
        // mismo motivo que en `update()`. Propiedad PROPIA, nunca heredada del prototipo.)
        if (!Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, key)) continue;
        comparable += 1;
        const seed = SETTING_DEFAULTS[key];
        // ⚠️ Comparación CANÓNICA, no `JSON.stringify` directo. Postgres almacena `jsonb` y **reordena
        // las claves de los objetos**, así que `grading_cost_tiers` vuelve de la BD con el mismo
        // contenido y otro orden de claves: un `stringify` crudo lo declara «DIFERENTE» en CADA
        // arranque. Un inventario que grita cuando no pasa nada es ruido que se aprende a ignorar —
        // exactamente el modo de fallo que esta línea existe para no tener. (El orden de los ARRAYS sí
        // se respeta: en los escalones y en la curva es significativo.)
        const actualJson = canonicalJson(row.valueJson);
        const seedJson = canonicalJson(seed);
        if (actualJson === seedJson) continue;
        // Recorte ALREDEDOR de la primera diferencia (no por el principio): con `grading_cost_tiers`
        // —~420 chars contra un tope de 160— un recorte por el principio imprimía DOS PREFIJOS
        // IDÉNTICOS cuando la divergencia caía en un escalón tardío.
        const shown = truncatePairJson(actualJson, seedJson);
        diffs.push(`${row.key}=${shown.actual} (default ${shown.seed})${shown.note}`);
      }
      // Una clave AUSENTE en la tabla no se lista: resuelve al default, así que NO difiere.
      //
      // ⚠️ Se emite SIEMPRE, con «sin divergencias» EXPLÍCITO (§11.0 punto 5). Callar cuando todo está
      // bien convertiría la ausencia de la línea en ambigua —«no hay nada que reportar» vs. «esto no
      // corrió»— y eso falla ABIERTO.
      if (diffs.length === 0) {
        this.logger.log(
          `config inventory: SIN DIVERGENCIAS — las ${comparable} clave(s) COMPARABLES (de ` +
            `${rows.length} fila(s) en la tabla; el resto no tiene default de código contra el que ` +
            'contrastar) están en su ' +
            'default de código. (§11.0: un seed es una condición inicial y los cambios de seed NO ' +
            'llegan solos a un entorno ya sembrado; esta línea es —junto al GET del recurso— uno de ' +
            'los dos detectores del seed rancio, así que se emite siempre, también cuando no hay nada.)',
        );
        return;
      }
      this.logger.log(
        `config inventory: ${diffs.length} de ${comparable} clave(s) comparables DIFIEREN de su ` +
          `default de ` +
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

  /**
   * v1.51 (M-46, §4.38r.1) — lista las claves **RETIRADAS que siguen en la tabla**, con su valor, bajo
   * un rótulo que dice que **no se leen**.
   *
   * Las filas no se borran a propósito (§11.0 punto 4: borrar config para lograr cero efecto es
   * escribir en producción sin motivo; y son lo que mantiene fail-closed al código viejo si hay
   * rollback). El precio de dejarlas es que **mienten a quien lea la tabla a pelo**, y esta línea es
   * el pago de ese precio.
   *
   * `log` y no `warn`: que estén ahí es lo NORMAL después del pase, y una alarma que suena siempre se
   * aprende a ignorar. Si no hay ninguna —entorno nuevo, sembrado ya sin ellas— no se emite nada.
   */
  private logRetiredKeys(rows: { key: string; valueJson: unknown }[]): void {
    const present = rows
      .filter((r) => (RETIRED_SETTING_KEYS as readonly string[]).includes(r.key))
      .sort((a, b) => a.key.localeCompare(b.key));
    if (present.length === 0) return;
    const shown = present.map((r) => `${r.key}=${canonicalJson(r.valueJson)}`).join('; ');
    this.logger.log(
      `config inventory: ${present.length} clave(s) RETIRADAS presentes en la base (INERTES, NO SE ` +
        `LEEN) → ${shown}. (§4.38r.1: las retiró M-46 y NO se borran —mantienen fail-closed al ` +
        'código viejo si hay rollback—, pero su valor NO gobierna nada: el gancho de grading, ' +
        'exhibición Y obtención, lo gobierna `grading_hook_enabled`. NO concluyas de estas filas que ' +
        'el ingest está apagado.)',
    );
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

    // v1.51 (M-46, §4.39l / criterio 127) — VALIDACIÓN CRUZADA BLOQUEANTE ENTRE TRES DIALES.
    await this.assertBuylistCrossDials(validated);

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

  /**
   * v1.51 (M-46, §4.39l / API_CONTRACT §M10, criterio 127) — **la validación CRUZADA de TRES
   * términos, evaluada sobre el ESTADO RESULTANTE.**
   *
   * ```
   * buylistShippingFeeCents + buylistMinimumOfferNetCents  <=  buylistMinimumRequestCents
   * ```
   *
   * ### ⚠️ Por qué NO puede vivir en `SETTING_VALIDATORS`
   * Aquel mapa es **un validador por clave**, y un validador por clave **solo ve su propio valor**.
   * Esta regla relaciona **tres** claves, así que necesita el único punto del sistema que conoce el
   * resultado completo: este método.
   *
   * ### ⚠️ SE EVALÚA SOBRE `{...vigente, ...body}`, NO SOBRE EL BODY — y con TRES claves importa MÁS
   * `PUT /admin/settings` es **PARCIAL**. Validar solo lo que viene permitiría **romper el invariante
   * mandando UNA de las TRES** (subir la tarifa a secas, o bajar el mínimo a secas) — exactamente el
   * agujero que esta validación existe para tapar, ahora con una puerta más. Por eso se leen los
   * valores **vigentes** de las tres claves y se superponen las que trae el `body`.
   *
   * ### Es BLOQUEANTE y aplica en LOS TRES SENTIDOS
   * Subir la tarifa, **subir el piso** o **bajar el mínimo de compra** se rechazan **igual**. *Eran
   * dos sentidos; con tres términos son tres.*
   *
   * ### Corto circuito deliberado
   * Si el `body` no toca **ninguna** de las tres claves, no se lee nada: un `PUT` de `ivaPct` no
   * paga tres queries por una regla que no puede haber roto. (El estado vigente ya cumplía el
   * invariante: es la postcondición de todo `PUT` anterior.)
   */
  private async assertBuylistCrossDials(
    validated: { settingKey: SettingKeyType; value: unknown }[],
  ): Promise<void> {
    const CROSS_KEYS = [
      SettingKey.BUYLIST_SHIPPING_FEE_CENTS,
      SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS,
      SettingKey.BUYLIST_MINIMUM_REQUEST_CENTS,
    ] as const;
    const incoming = new Map<SettingKeyType, unknown>();
    for (const { settingKey, value } of validated) {
      if ((CROSS_KEYS as readonly SettingKeyType[]).includes(settingKey)) {
        incoming.set(settingKey, value);
      }
    }
    if (incoming.size === 0) return;

    // ESTADO RESULTANTE = lo VIGENTE (fila de BD, o el default si la fila no existe) pisado por lo
    // que trae este `PUT`. `getRawMany` devuelve SOLO las filas existentes, así que la ausencia se
    // resuelve al default — que es exactamente cómo lo leerá después cualquier consumidor.
    const rows = await this.getRawMany(CROSS_KEYS);
    const resolve = (key: SettingKeyType): number =>
      Number(incoming.has(key) ? incoming.get(key) : (rows.get(key) ?? SETTING_DEFAULTS[key]));

    const problem = validateBuylistCrossDials({
      shippingFeeCents: resolve(SettingKey.BUYLIST_SHIPPING_FEE_CENTS),
      minimumOfferNetCents: resolve(SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS),
      minimumRequestCents: resolve(SettingKey.BUYLIST_MINIMUM_REQUEST_CENTS),
    });
    if (!problem) return;

    // ⚠️ El `details.rule` es el NUEVO (`buylist_fee_plus_min_net_le_min_request`). Los dos nombres
    // anteriores describen relaciones de DOS términos que ya no son la regla, y un `details.rule`
    // que miente es peor que uno ausente. El mensaje dice POR QUÉ, no un «valor inválido» seco.
    throw BusinessException.validation('VALIDATION_ERROR', problem.message, {
      rule: problem.rule,
      shippingFeeCents: problem.shippingFeeCents,
      minimumOfferNetCents: problem.minimumOfferNetCents,
      minimumRequestCents: problem.minimumRequestCents,
    });
  }
}

/**
 * v1.50.3-c (techlead) — serializa el par (valor vigente, default) para el log **recortando ALREDEDOR
 * DE LA PRIMERA DIFERENCIA**, no por el principio.
 *
 * ### El defecto que cierra
 * `grading_cost_tiers` es el único dial que es una TABLA: su JSON ronda los **420 chars** contra un
 * recorte de 160. Si la divergencia está en el escalón 4, los dos prefijos de 160 chars son
 * **IDÉNTICOS** y la línea dice literalmente «X difiere de Y» mostrando X == Y. El operador no ve qué
 * cambió — exactamente el falso negativo de diagnóstico que este inventario existe para no tener, y
 * justo en el único dial donde el recorte muerde.
 *
 * ### Tres decisiones
 * 1. **Se imprime el JSON CANÓNICO**, no el crudo: Postgres reordena las claves de los objetos `jsonb`,
 *    así que sin canonizar los dos lados no son alineables y el «primer char que difiere» sería un
 *    artefacto del orden de claves, no una diferencia real. Es la MISMA función con la que se decide si
 *    hay divergencia ⇒ lo que se imprime es exactamente lo que se comparó.
 * 2. **La ventana es la misma para los dos lados** (mismo `start`), que es lo que permite leerlos en
 *    paralelo. Con ventanas independientes volveríamos a comparar cosas distintas.
 * 3. **Se imprime el índice del char divergente** cuando hubo recorte: es el ancla para localizar el
 *    elemento en la tabla completa (que sigue estando en la BD y en el `GET` del recurso).
 */
function truncatePairJson(actual: string, seed: string): { actual: string; seed: string; note: string } {
  const at = firstDiffIndex(actual, seed);
  const fits = actual.length <= INVENTORY_VALUE_TRUNCATE && seed.length <= INVENTORY_VALUE_TRUNCATE;
  if (fits || at < 0) {
    return { actual: truncateJson(actual), seed: truncateJson(seed), note: '' };
  }
  const start = Math.max(0, at - INVENTORY_DIFF_LEAD);
  return {
    actual: windowOf(actual, start),
    seed: windowOf(seed, start),
    note: ` [1ª diferencia en char ${at}]`,
  };
}

/** Ventana de `INVENTORY_VALUE_TRUNCATE` chars desde `start`, con elipsis en el lado que se recortó. */
function windowOf(raw: string, start: number): string {
  const from = Math.min(start, Math.max(0, raw.length - 1));
  const end = Math.min(raw.length, from + INVENTORY_VALUE_TRUNCATE);
  return `${from > 0 ? '…' : ''}${raw.slice(from, end)}${end < raw.length ? '…' : ''}`;
}

/** Índice del primer char en que difieren; `-1` si son iguales. Si una es prefijo de la otra, su fin. */
function firstDiffIndex(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

/** Recorte simple por el principio — para los valores que caben o que no tienen con qué contrastarse. */
function truncateJson(raw: string): string {
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
