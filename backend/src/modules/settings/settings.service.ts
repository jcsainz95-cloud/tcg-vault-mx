import { Injectable } from '@nestjs/common';
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

/**
 * SettingsService — Lectura/escritura de los diales M10 (ConfigSetting).
 * Editables sin redeploy. Provee helpers tipados para el resto de módulos.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

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
