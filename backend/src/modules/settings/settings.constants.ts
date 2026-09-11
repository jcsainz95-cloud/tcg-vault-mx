/**
 * settings.constants.ts — Diales M10 (ConfigSetting). ARCHITECTURE §3.2, §5.1.
 * Los valores viven en DB (editables sin redeploy). Aquí solo las KEYS y los DEFAULTS.
 */
// MERGE v1.50.2: se BORRA `import { TIER_IDS, isTierId } from '../../common/pricing-tiers'` — P-48
// (§4.36.2) retiró `pricing_tier_map` y con él `common/pricing-tiers.ts`. Sus únicos usos en este
// archivo eran el validador de esa clave retirada.
// v1.50-graded-estimate (M-42, §4.38): seeds + validadores del «gancho de grading» viven en la zona
// compartida `common/graded-estimate.ts` (pura, sin infra), igual que `pricing-curve.ts`. Aquí solo se
// cablean como diales.
import {
  DEFAULT_GRADED_ESTIMATE_FRESHNESS_DAYS,
  DEFAULT_GRADED_ESTIMATE_GRADES,
  DEFAULT_GRADED_ESTIMATE_HIGHLIGHT_GRADES,
  DEFAULT_GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN,
  DEFAULT_GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS,
  DEFAULT_GRADED_ESTIMATE_MAX_RAW_MULTIPLE,
  DEFAULT_GRADED_ESTIMATE_MIN_SAMPLE_COUNT,
  DEFAULT_GRADED_ESTIMATE_SOURCE_STAT,
  DEFAULT_GRADING_COST_TIERS,
  DEFAULT_GRADING_MIN_UPSIDE_PCT,
  GRADED_ESTIMATE_FRESHNESS_DAYS_MAX,
  GRADED_ESTIMATE_FRESHNESS_DAYS_MIN,
  GRADED_ESTIMATE_GRADE_VALUES,
  GRADING_MIN_UPSIDE_PCT_MAX,
  validateGradedEstimateIngestMaxCards,
  validateGradedEstimateManualFreshnessDays,
  validateGradedEstimateMaxRawMultiple,
  validateGradedEstimateMinSampleCount,
  validateGradedEstimateSourceStat,
  validateGradingCostTiers,
} from '../../common/graded-estimate';
// v2.0 (P-48, §4.36.2): la CURVA vive en `common/` (zona compartida, sin infra) para que el seed, las
// migraciones y los tests la compartan con el runtime. Aquí solo se declara su KEY, su DEFAULT y su
// validador de puerta; la matemática y los invariantes V1–V8 NO se duplican.
import { DEFAULT_PRICING_CURVE, validatePricingCurve } from '../../common/pricing-curve';
// v1.63 (§M2-F.1, §4.43c): la regla de resolución del MODO de la FX vive en `common/` (mismo motivo
// que la curva: la comparten `FxService` y este módulo, y `FxService` ya depende de éste). Aquí solo
// se declaran su KEY, su DEFAULT (el sentinel) y su validador de puerta.
// v1.63.4 (§M2-F.8, `FX-24`): y la BANDA de la tasa viene del mismo sitio, por la misma razón
// elevada al cuadrado — la comparten las DOS puertas de escritura (esta y el parser de la SIE), así
// que aquí ⛔ NO se escribe ningún literal `1` ni `1000`.
import {
  FX_RATE_BAND_TEXT,
  FX_RATE_MAX,
  FX_RATE_MIN,
  FX_RATE_MODE_LEGACY,
  FX_RATE_MODE_STORED_VALUES,
  isFxRateInBand,
} from '../../common/fx-mode';
import { SEALED_SUBTYPE_VALUES } from '../../common/enum-values';
export const SettingKey = {
  SHIPPING_FEE_CENTS: 'shipping_fee_cents',
  APORTACION_PCT: 'aportacion_pct',
  IVA_PCT: 'iva_pct',
  // ⭐⭐ v1.64-iva-inclusive (M-50, `ARCHITECTURE §4.44.g` / `API_CONTRACT §M10-IVA.1`) — EL DIAL DE
  // TRASLACIÓN. Es una **FRACCIÓN DE TRASLACIÓN** en puntos porcentuales enteros `[0,100]`,
  // ⛔ **NO son puntos de IVA** y ⛔ **NO es la tasa**: `iva_pct` sigue siendo la TASA y la fuente
  // ÚNICA del IVA de la comisión de Stripe. **Son dos filas independientes y ninguna deriva de la
  // otra** — `getStripeFee()` ⛔ NUNCA lee esta clave (candado `IVA-7`): si el dial de traslación
  // entrara ahí, **mover un precio movería una comisión**.
  //
  // ⚠️ **DEPLOY 1: la fila existe (la siembra M-50) pero NADIE la lee.** No está en
  // `SETTING_DTO_MAP` a propósito ⇒ ni sale en `GET /admin/settings` ni se puede escribir por
  // `PUT /admin/settings` (que valida contra ese mapa con `hasOwnProperty` ⇒ `422` clave desconocida;
  // mismo precedente exacto que `stripeFeeIvaPct` desde v1.40 y que `fxRateMode`). Su única puerta
  // será `PUT /admin/settings/iva-transfer` **con acuse del costo en pesos**, y esa puerta abre en el
  // **DEPLOY 2** (§M10-IVA.2, candado `IVA-8(b)/(c)`). *Un dial que gobierna dinero y cuyo único
  // guardián es una pantalla no tiene guardián.*
  IVA_TRANSFER_PCT: 'iva_transfer_pct',
  SALES_MARKUP_PCT: 'sales_markup_pct',
  STRIPE_FEE_PCT: 'stripe_fee_pct',
  STRIPE_FEE_FIXED_CENTS: 'stripe_fee_fixed_cents',
  // v1.40 (Enmienda A, P-37): el dial `STRIPE_FEE_IVA_PCT` se RETIRA. El IVA que Stripe MX cobra
  // sobre su comisión se deriva ahora de `IVA_PCT` (fuente única; ver settings.service.getStripeFee).
  // La clave de BD `stripe_fee_iva_pct` queda deprecada e inerte (nadie la lee); sin migración.
  BUYLIST_CAP_PER_REQUEST_CENTS: 'buylist_cap_per_request_cents',
  BUYLIST_CAP_PER_MONTH_CENTS: 'buylist_cap_per_month_cents',
  INE_THRESHOLD_CENTS: 'ine_threshold_cents',
  REPO_CAP_PER_CARD_CENTS: 'repo_cap_per_card_cents',
  FX_BUFFER_PCT: 'fx_buffer_pct',
  FX_MANUAL_OVERRIDE_RATE: 'fx_manual_override_rate',
  // ⭐ v1.63 (§M2-F.1 / §4.43) — EL MODO del tipo de cambio, **separado del VALOR**. Hasta v1.62.2 el
  // modo se INFERÍA de si `fx_manual_override_rate` estaba o no estaba, así que «apagar el manual»
  // significaba BORRAR el número. Esa inferencia ERA el defecto.
  // ⛔ NO está en `SETTING_DTO_MAP`: no se lee ni se edita por `PUT /admin/settings` (enviarlo cae en
  // 422 «unknown setting key», igual que `pricing_curve` o `sealed_spread_*`). Su ÚNICA puerta es
  // `PUT /admin/fx/mode`, que es la que impone las precondiciones y la bitácora dedicada.
  FX_RATE_MODE: 'fx_rate_mode',
  PRICING_PROVIDER_RAW: 'pricing_provider_raw',
  PRICING_PROVIDER_GRADED: 'pricing_provider_graded',
  PRICING_PROVIDER_SEALED: 'pricing_provider_sealed',
  // Proveedor de la INGESTA MASIVA de precios (`BulkPriceProvider`), distinto de los
  // `pricing_provider_*` per-carta de arriba. ⚠️ v1.65 (D-PP-1): enum, semántica, seed y rollback los
  // fija `API_CONTRACT §M10-PP` (`I-PP1`…`I-PP5`); aquí se CITA y no se transcribe (§0-B.3 regla 8).
  // *El texto anterior describía el seed y el flip previsto, y fue una de las cinco copias del
  // literal que produjeron la contradicción de `ARCHITECTURE §4.35a(a)`.*
  PRICE_PROVIDER: 'price_provider',
  // v1.19-sealed-tcgcsv (§4.19e): dial FAIL-CLOSED de la ingesta de la referencia de mercado
  // del SELLADO vía TCGCSV (job `sealed-price-ingest`). Valores `tcgcsv | off`, seed `off`:
  // al desplegar NO se ingiere nada hasta que devops valide el esquema real en staging y
  // flipee el dial (mismo patrón de rollout money-safe que `price_provider`). Rollback = `off`
  // (los PriceReference ya escritos permanecen, informativos e inertes).
  SEALED_PRICE_SOURCE: 'sealed_price_source',
  // v2.0 (P-48, §4.36.2/§4.36.9b) — RETIRADAS: `buylist_price_rules`, `buylist_price_fallback_pct`,
  // `sales_price_rules`, `sales_price_fallback_pct` y `pricing_tier_map`. Las cinco las reemplaza UNA
  // sola clave, `pricing_curve` (abajo). Ya no se leen, ni se escriben, ni se siembran; sus filas
  // quedan huérfanas e inertes en `ConfigSetting` A PROPÓSITO (no se borran en la migración: borrar
  // config en el mismo paso que cambia la matemática elimina la vía de diagnóstico y el rollback
  // barato). Mismo precedente que `rarity_map` (v1.32).
  // v2.0 (P-48, §4.36.2, M-41.7): LA CURVA — UNA sola clave que reemplaza a las CINCO de arriba
  // (`sales_price_rules`, `sales_price_fallback_pct`, `buylist_price_rules`,
  // `buylist_price_fallback_pct`, `pricing_tier_map`). Es UNA y no dos (venta/compra) a propósito: el
  // invariante «la compra queda por debajo de la venta en todo el dominio» es CRUZADO (depende de las
  // dos curvas + piso + bin a la vez); con dos claves, dos PUT sucesivos abren una ventana en la que se
  // compra por encima de lo que se vende. Con una, la validación es ATÓMICA por construcción.
  // Editable SOLO por `GET/PUT /admin/pricing/curve` (como los spreads del sellado): NO se expone en
  // `SETTING_DTO_MAP`, así que `PUT /admin/settings` no la toca.
  PRICING_CURVE: 'pricing_curve',
  // v1.23-sealed-sales (§4.23c): spreads de VENTA del SELLADO por presentación + fallback global.
  // Mecanismo INDEPENDIENTE de la curva de precios (v2.0, §4.36): el sellado no interpola, usa
  // `pct` = markup ARRIBA de mercado por SealedSubtype (NO % de la referencia como en buylist).
  // Editables por endpoints M2 dedicados (GET/PUT /admin/pricing/sealed-spreads), NO por
  // PUT /admin/settings. money.computeSealedSalePrice.
  SEALED_SPREAD_PCT_BY_SUBTYPE: 'sealed_spread_pct_by_subtype',
  SEALED_SPREAD_FALLBACK_PCT: 'sealed_spread_fallback_pct',
  // v1.23-sealed-sales (§4.23h): feature flags (seed off) de los endpoints §2-S. Con off el
  // endpoint responde 404 FEATURE_DISABLED. Expuestos en el DTO de M10 (sealedValueTrend/
  // sealedRestockAlerts) y editables por PUT /admin/settings (a diferencia de los spreads).
  SEALED_VALUE_TREND: 'sealed_value_trend',
  SEALED_RESTOCK_ALERTS: 'sealed_restock_alerts',
  // Retención de INE (días desde el cierre/pago de la solicitud) antes de purgar imágenes.
  // Dial interno (LFPDPPP): NO se expone en el DTO de M10 hasta que el arquitecto lo
  // formalice en el contrato (ver docs/BACKEND_NOTES.md).
  INE_RETENTION_DAYS: 'ine_retention_days',
  // v1.44-graded-estimate (M-41, §4.38d) + v1.51 (M-46, §4.38r): «gancho de grading» — ONCE claves,
  // DATA/seed (sin DDL): **10 de M2** + **1 de M10** (el dial único, abajo).
  // Las de M2 se editan en M2 (GET/PUT /admin/pricing/graded-estimates), NO por
  // PUT /admin/settings (mismo criterio que los spreads del sellado). `grading_cost_tiers` y
  // `grading_min_upside_pct` gobiernan EXCLUSIVAMENTE la CURADURÍA (teja/vitrina): subir el umbral vacía
  // la vitrina pero la FICHA sigue mostrando sus estimados (partición §4.38-0).
  GRADED_ESTIMATE_GRADES: 'graded_estimate_grades',
  GRADED_ESTIMATE_HIGHLIGHT_GRADES: 'graded_estimate_highlight_grades',
  GRADED_ESTIMATE_FRESHNESS_DAYS: 'graded_estimate_freshness_days',
  GRADING_COST_TIERS: 'grading_cost_tiers',
  GRADING_MIN_UPSIDE_PCT: 'grading_min_upside_pct',
  // ⛔ v1.51 (M-46, §4.38r): `graded_estimates_enabled` RETIRADA — la sustituye `grading_hook_enabled`.
  // ===== v1.50.2 (§4.38k/h) — las 5 claves de M2 del gate de confianza y del ingest =====
  // Se editan en `PUT /admin/pricing/graded-estimates` (NO aquí, igual que las otras cinco de arriba):
  // el recurso dedicado es el único que puede validar invariantes ENTRE filas.
  GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS: 'graded_estimate_manual_freshness_days',
  GRADED_ESTIMATE_MAX_RAW_MULTIPLE: 'graded_estimate_max_raw_multiple',
  GRADED_ESTIMATE_MIN_SAMPLE_COUNT: 'graded_estimate_min_sample_count',
  GRADED_ESTIMATE_SOURCE_STAT: 'graded_estimate_source_stat',
  GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN: 'graded_estimate_ingest_max_cards_per_run',
  // ⛔ v1.51 (M-46, §4.38r): `graded_estimate_ingest_enabled` RETIRADA — absorbida por el dial único.
  //
  // ===== v1.51 (M-46, §4.38r) — EL DIAL DEL GANCHO, uno solo. DATA/seed, SIN DDL =====
  // Gobierna las DOS cosas: la EXHIBICIÓN (ficha/teja/vitrina) y la OBTENCIÓN (créditos + escrituras
  // del ingest de fase 2). Seed `off` FAIL-CLOSED; expuesto en el DTO de M10 y editable por
  // PUT /admin/settings (patrón `sealedValueTrend`), auditado y sin redeploy.
  //
  // ⚠️ Encenderlo es un ACTO DE DINERO, no un ajuste de vitrina (§4.38r.3): publica una afirmación
  // comercial **y** arranca el consumo de créditos de un proveedor de paga **y** empieza a escribir
  // precios. Precondiciones del primer `off → on` de un entorno en §4.38(r.3.1).
  //
  // ⚠️ Por qué la clave es NUEVA y no se reusó `graded_estimates_enabled` (§4.38r.1 — es LA decisión
  // de seguridad de M-46): producción tiene esa fila en `"on"`. Reusarla habría ENSANCHADO el
  // significado de un valor ya almacenado («publica» → «publica y gasta y escribe precios») y el
  // siguiente tick del cron (2×/día, ≤12 h, sin humano) habría sido la primera factura del dueño. Con
  // clave nueva, NINGÚN valor guardado en NINGÚN entorno puede armar el dial: todos aterrizan en `off`
  // y existe exactamente UNA forma de encenderlo — un `PUT` humano desde el back-office.
  GRADING_HOOK_ENABLED: 'grading_hook_enabled',
  // v1.1 (M-9): frontera por defecto del sync de catálogo (POST /admin/catalog/sync sin setId).
  // Formato pokemontcg.io `yyyy/MM/dd`. ConfigSetting de primera clase: expuesto en el DTO de
  // M10 (`catalogSyncFromDate`), legible y editable por GET/PUT /admin/settings.
  CATALOG_SYNC_FROM_DATE: 'catalog_sync_from_date',
  // ===== v1.51 (M-46, §4.39l / API_CONTRACT §M10) — LOS DIEZ DIALES DEL CICLO DE ADQUISICIÓN =====
  // `PROJECT.md` §P.10 es el ORIGEN ÚNICO de estos números. Todos viven en `ConfigSetting`, se editan
  // SIN REDEPLOY, quedan AUDITADOS y aplican a solicitudes NUEVAS. Los DIEZ se exponen en el DTO de
  // M10 y se editan por `PUT /admin/settings` (a diferencia de los spreads y del gancho de grading,
  // que tienen recursos M2 propios).
  //
  // ⚠️ CONTEO, para que nadie recuente mal: nueve (3ª ronda) → OCHO (D30 retira el «recorte
  // material») → OCHO (D31 saca el umbral de guía, D33 mete el plazo de emisión) → NUEVE (D34 añade
  // el piso de neto) → DIEZ (v1.51.4 añade la alerta de re-emisión).
  //
  // ⚠️ DOS DIALES RETIRADOS QUE **NO EXISTEN** — verificable POR LO NEGATIVO (criterio 127):
  //   · `buylist_material_haircut_pct` («recorte material», 20%, D28): D30 lo dejó SIN OBJETO.
  //   · `buylist_shipping_threshold_cents` («umbral de guía», D31): con UNA sola banda no hay umbral.
  //   Ninguno se siembra, ninguno se apaga y ninguno queda en 0: **dejan de existir**. Buscarlos en
  //   M10 debe dar NADA, y ninguna conducta del sistema debe depender de ellos. *Un dial que se queda
  //   «por si acaso» es una banda que alguien va a reactivar sin querer, y esa banda mueve dinero.*
  //
  // ⚠️ DOS CLASES DE DIAL (criterio 157), y confundirlas produce columnas que nadie lee:
  //   · Se CONGELAN por solicitud (se COMUNICAN al vendedor y se releerían después): **1, 2 y 7**.
  //   · Son GATES o política interna (se evalúan UNA vez, no se releen, NADA que congelar y NINGUNA
  //     columna): **3, 4, 5, 6, 8, 9 y 10**.
  //     El **10** no es excepción aunque su alerta se lea contra una columna: lo que se persiste es el
  //     CONTEO (`offerReissueCount`, un HECHO), no el UMBRAL (el dial, una POLÍTICA). *El hecho se
  //     guarda; la política se relee* ⇒ mover el dial reevalúa la alerta de todas las filas vivas.
  //
  // Dial 1 — plazo del VENDEDOR para aceptar. Sin respuesta ⇒ `rechazada` (§P.3). Se CONGELA.
  BUYLIST_OFFER_ACCEPT_DEADLINE_BUSINESS_DAYS: 'buylist_offer_accept_deadline_business_days',
  // Dial 2 — plazo del VENDEDOR para enviar tras recibir la guía. Sin envío ⇒ `expirada` (§P.4).
  // Se CONGELA (al entregar la guía, no al aceptar — D31).
  BUYLIST_SHIP_DEADLINE_BUSINESS_DAYS: 'buylist_ship_deadline_business_days',
  // Dial 3 — mínimo de COMPRA sobre el BRUTO cotizado, al CREAR la solicitud (§P.12). Borde
  // INCLUSIVO a favor del VENDEDOR (criterio 158(a)): `quotedTotalCents >= mínimo` CREA. Entra a la
  // validación CRUZADA de abajo. ⚠️ Es el ÚNICO de los diez con superficie PÚBLICA
  // (`GET /buylist/quote-policy`, D43): lo exige el criterio 132(a) («cuánto falta, con el número
  // correcto»), que el 422 server-side NO cubre porque si el botón no procede no se manda nada.
  BUYLIST_MINIMUM_REQUEST_CENTS: 'buylist_minimum_request_cents',
  // Dial 4 — plazo NUESTRO para emitir la oferta (D33). Al vencer, la solicitud CADUCA
  // (`expirada`/`no_offer`) CON CORREO. ⚠️ D38: se cuenta desde `offerIssueClockStartedAt ??
  // createdAt` — cancelar una oferta ENVIADA lo repone ENTERO. De los tres plazos, SOLO el nuestro se
  // repone: los del vendedor ya están por escrito y moverlos sería moverle una fecha prometida.
  BUYLIST_OFFER_ISSUE_DEADLINE_BUSINESS_DAYS: 'buylist_offer_issue_deadline_business_days',
  // Dial 5 — tope del OPERADOR sobre el BRUTO (§P.2, criterio 147). Borde INCLUSIVO a favor del
  // OPERADOR: `offerGrossCents <= tope` sale SOLA. Por encima, la autoriza el súper-admin.
  BUYLIST_OPERATOR_OFFER_CAP_CENTS: 'buylist_operator_offer_cap_cents',
  // Dial 6 — posición por variante que dispara «no comprar» en cartas SIN bounty (§P.2).
  // ⚠️ NUNCA BLOQUEA: es una sugerencia de la mesa de decisión, no una guarda.
  BUYLIST_VARIANT_POSITION_CAP: 'buylist_variant_position_cap',
  // Dial 7 — el ENVÍO que se descuenta y que el correo anuncia; se CONGELA al ofertar (D25).
  // ⚠️ DISTINTO de `shipping_fee_cents` (MX$175, RETIRO al comprador). Se parecen y NO son el mismo
  // número: uno es lo que le COBRAMOS al comprador por mandarle su carta; éste es lo que NOS
  // DESCONTAMOS por traer la del vendedor. Mover uno NO mueve el otro (criterio 127, última línea);
  // unificarlos «porque se parecen» rompería dos flujos a la vez. Entra a la validación CRUZADA.
  BUYLIST_SHIPPING_FEE_CENTS: 'buylist_shipping_fee_cents',
  // Dial 8 — alerta de «ya lo mandé» sin confirmar (§P.13). NO expira nada.
  BUYLIST_SHIPMENT_CONFIRM_ALERT_BUSINESS_DAYS: 'buylist_shipment_confirm_alert_business_days',
  // Dial 9 — NETO mínimo para poder EMITIR una oferta (D34). Estrictamente por debajo ⇒
  // `422 OFFER_NET_BELOW_MINIMUM`; el neto IGUAL al piso SE EMITE (D40). NO gatea el pago ni la
  // aceptación. Entra a la validación CRUZADA. ⚠️ El `0` NO es legal — ver `validateBuylistMinimumOfferNetCents`.
  BUYLIST_MINIMUM_OFFER_NET_CENTS: 'buylist_minimum_offer_net_cents',
  // Dial 10 — a partir de cuántas cancelaciones de oferta ENVIADA la cola de M5 marca ALERTA
  // (v1.51.4, §4.39u). Es la alerta que (o.19) prometió EN VEZ de un tope: NO bloquea, NO expira, NO
  // mueve ningún estado y NO aparece en ningún correo.
  // ⚠️ NO entra en la validación cruzada, y no es un descuido: cuenta ACTOS, no centavos, así que no
  // hay identidad aritmética que preservar. *Meterlo «por simetría» sería inventar una relación entre
  // un número de veces y un monto.*
  BUYLIST_OFFER_REISSUE_ALERT_COUNT: 'buylist_offer_reissue_alert_count',

  // ===========================================================================================
  // ⚠️⚠️ NO ES EL DIAL 11. Es el INTERRUPTOR DEL PASO 6 DE M-46 (B-4).
  // ===========================================================================================
  // La migración de M-46 declara **en mayúsculas** que el CENSO Y TRIAGE HUMANO de las `cotizada`
  // vivas va ANTES de habilitar la regla 7 del barrido, que **NO ES OPCIONAL**, y que sin él «la
  // primera corrida del barrido manda correos reales a vendedores con solicitudes viejas».
  //
  // Hasta v1.51.22 **lo único que separaba el deploy de esos correos era ese comentario en un
  // `.sql`**: `expireUnofferedRequests` no tenía flag, ni gate, ni kill switch, y corre con el cron
  // `'0 8 * * *'` **la primera mañana después del deploy**. Un paso operativo obligatorio cuyo
  // incumplimiento manda correo vinculante a terceros **no puede vivir en prosa**: necesita un
  // mecanismo, y el mecanismo barato ya existía en este archivo (los feature flags `on|off`).
  //
  // **Semántica FAIL-CLOSED, y por eso el default es `off`:** la regla 7 CIERRA solicitudes en
  // TERMINAL y manda correo. Un dial ausente, `null`, `true`, `'ON'` o basura ⇒ **APAGADO**. Solo el
  // string `'on'` enciende. El orden correcto de despliegue es: deploy → censo/triage (paso 6) →
  // `UPDATE "ConfigSetting" SET "valueJson" = '"on"' WHERE key = 'buylist_no_offer_expiry_enabled'`.
  //
  // ⚠️ **NO SE EXPONE EN `SETTING_DTO_MAP`, Y ES DELIBERADO.** §M10 del contrato fija DIEZ diales del
  // ciclo y hay un test-ancla que rompe con el onceavo «para que haya que decidirlo a propósito».
  // Éste **no es un dial de política de negocio**: es un gate de despliegue de una sola vez, del
  // mismo género que `sealed_spread_*` (que tampoco está en el mapa). Exponerlo en M10 sería un
  // cambio de contrato ⇒ **lo decide el arquitecto, no el backend** (regla 9). Se opera por fila de
  // `ConfigSetting`, igual que el paso 6 se opera a mano.
  BUYLIST_NO_OFFER_EXPIRY_ENABLED: 'buylist_no_offer_expiry_enabled',
} as const;

export type SettingKeyType = (typeof SettingKey)[keyof typeof SettingKey];

/** Defaults iniciales (ARCHITECTURE §3.2). Montos en centavos MXN. */
export const SETTING_DEFAULTS: Record<SettingKeyType, unknown> = {
  [SettingKey.SHIPPING_FEE_CENTS]: 17500, // MX$175
  [SettingKey.APORTACION_PCT]: 70,
  [SettingKey.IVA_PCT]: 16,
  // ⭐ v1.64 (M-50, §4.44.g) — seed **100**: EL NEUTRO. Con el dial ahí, la fórmula del deploy 2
  // reproduce el cobro de hoy AL CENTAVO (§4.44.a). ⛔ Sin lógica y sin sentinel: a diferencia del
  // FX (`FX-6`), aquí «ausente» y «100» significan **lo mismo** —en instalación limpia porque es el
  // valor que el dueño eligió, y en producción antes del backfill porque es el neutro—, así que no
  // hay ninguna decisión que perder por caer al default. Candado `IVA-8(e)`.
  [SettingKey.IVA_TRANSFER_PCT]: 100,
  [SettingKey.SALES_MARKUP_PCT]: 15, // markup de venta configurable
  [SettingKey.STRIPE_FEE_PCT]: 0.036, // 3.6% tarifa MX Stripe (fracción)
  [SettingKey.STRIPE_FEE_FIXED_CENTS]: 300, // MX$3.00 fija
  // v1.40 (P-37): STRIPE_FEE_IVA_PCT retirado — el IVA de la comisión Stripe deriva de IVA_PCT (16 ⇒ 0.16).
  [SettingKey.BUYLIST_CAP_PER_REQUEST_CENTS]: 300000, // MX$3,000
  [SettingKey.BUYLIST_CAP_PER_MONTH_CENTS]: 1000000, // MX$10,000
  [SettingKey.INE_THRESHOLD_CENTS]: 300000, // = tope por solicitud
  [SettingKey.REPO_CAP_PER_CARD_CENTS]: 5000000, // tope de reposición por carta (editable)
  [SettingKey.FX_BUFFER_PCT]: 3, // colchón FX (%)
  [SettingKey.FX_MANUAL_OVERRIDE_RATE]: null, // sin override por defecto
  // ⭐⭐ v1.63.1 (§4.43g, candado FX-6(c)) — el default es el SENTINEL `"legacy"`, y ⛔ JAMÁS `"auto"`
  // ni `"manual"`. Un default de código se aplica en la PRIMERA LECTURA, antes de que corra ningún
  // seed (hecho F4): sembrar `"auto"` sería, literalmente, el mecanismo por el que producción —que
  // hoy tiene un override de 19.0000 vivo— se pasaría sola a Banxico al desplegar. Con `"legacy"`
  // NO EXISTE NINGÚN VALOR DE ESTE MAPA QUE PUEDA CAMBIAR LA CONDUCTA DE PRODUCCIÓN: significa
  // «resuelve como lo hacía v1.62.2». Y por tener default, la clave ENTRA en el inventario de
  // arranque (§11.0) ⇒ un valor corrupto SÍ se grita (sin default, `logConfigInventory` la saltaría).
  [SettingKey.FX_RATE_MODE]: FX_RATE_MODE_LEGACY,
  [SettingKey.PRICING_PROVIDER_RAW]: 'pokemontcg_io',
  [SettingKey.PRICING_PROVIDER_GRADED]: 'pokemonpricetracker',
  [SettingKey.PRICING_PROVIDER_SEALED]: 'pokemonpricetracker',
  // ⚠️⚠️ v1.65 (D-PP-1) — **SEED DEL PROVEEDOR DE PRECIO. NORMA: `API_CONTRACT §M10-PP`, invariante
  // `I-PP1` («el seed ES el primario»); razón entera en `ARCHITECTURE §4.35a`.**
  //
  // ⛔ Este comentario **CITA y no transcribe** (§0-B.3 regla 8): no repite el enum, ni la semántica de
  // cada valor, ni afirma qué valor corre en ningún entorno (eso es `I-PP2`: el VIGENTE se LEE de
  // `GET /admin/settings`, no de un comentario). La línea de abajo **es** el literal del seed — el
  // único sitio del proyecto donde ese literal vive (§M10-PP, hecho 2).
  //
  // Lo que este comentario SÍ debe dejar dicho, porque es la corrección que motivó el cambio: la
  // versión anterior sembraba el proveedor LEGACY y lo llamaba *«money-safe»*, y eso **era falso**. Un
  // seed money-safe tiene que ser **INERTE** (no escribe dinero — como `SEALED_PRICE_SOURCE: 'off'`,
  // unas líneas más abajo) **o el PRIMARIO validado**. El legacy no es ninguno de los dos: **corre el
  // barrido y ESCRIBE `PriceReference` con un `market` aplanado** (un precio por carta, invariante al
  // printing) ⇒ `reverse_holo` y `holofoil` quedaban al precio de la `normal`. Es la regresión exacta
  // que cerró P-47, y por `PROJECT §N.0` cae del lado irrecuperable del sesgo de error.
  // ⇒ El seed legacy no era el candado money-safe: era el riesgo con el nombre del candado.
  //
  // ⚠️ Cambiar esta línea NO es un rollback y un rollback NO cambia esta línea (`I-PP3`): la palanca de
  // rollback es `PUT /admin/settings { "priceProvider": … }` (super_admin, auditado, sin redeploy), y
  // mueve el VIGENTE de UN entorno. Este `DEFAULT` sólo se consulta cuando **no existe la fila**
  // `ConfigSetting.price_provider` ⇒ no puede alterar un entorno ya sembrado.
  [SettingKey.PRICE_PROVIDER]: 'tcgcsv_singles',
  // v1.19-sealed-tcgcsv (§4.19e / §4.23e / API_CONTRACT §M10): SEED `off` (FAIL-CLOSED, por contrato).
  // Un seed FRESCO (BD nueva: CI/dev/prod) arranca con el autoprecio del sellado APAGADO — la ingesta
  // TCGCSV no corre hasta que devops valide el esquema real en staging (§4.23f) y flipee el dial. El
  // AUTOPRECIO que pidió el PO se enciende EN RUNTIME (no por seed): PUT /admin/settings
  // { "sealedPriceSource": "tcgcsv" } (super_admin, auditado) tras la validación-en-staging. Ese PUT es
  // el mecanismo money-safe; rollback = mismo PUT con "off". NO cambiar este seed a `tcgcsv` (violaría el
  // contrato y removería el candado money-safe del que depende la deuda §BE-44(c) de TECH_DEBT.md).
  [SettingKey.SEALED_PRICE_SOURCE]: 'off',
  [SettingKey.INE_RETENTION_DAYS]: 180, // 6 meses por defecto (ajustable por el negocio/legal)
  [SettingKey.CATALOG_SYNC_FROM_DATE]: '2024/01/01', // v1.1: sets de 2024 en adelante
  // v2.0 (P-48, §4.36.2 / M-41.7): SEED = los diales de PROJECT §N.2 VERBATIM. NO se DERIVA de las
  // reglas viejas: la forma vieja (modos excluyentes por rareza/tier/acabado) y la nueva (una función
  // del mercado) son INCONMENSURABLES — cualquier «conversión» sería una interpretación inventada, y el
  // negocio NO está en vivo, así que no hay comportamiento que preservar. Son DIALES: el súper-admin los
  // mueve desde M2 sin redeploy (el upsert del seed no pisa un valor ya editado).
  [SettingKey.PRICING_CURVE]: DEFAULT_PRICING_CURVE,
  // v1.23-sealed-sales (§4.23c, SUP-6): seed confirmado por el PO — markup % arriba de mercado por
  // presentación (ítems chicos → % mayor) y fallback global 25 para piezas sin subtype o subtype
  // sin regla. Editables en M2 (GET/PUT /admin/pricing/sealed-spreads).
  //
  // v2.1.9 — `upc: 18` y `collection: 22`, **elegidos por el dueño** (2026-08-24). El criterio es el
  // que la tabla ya venía usando: **ítem más chico ⇒ % mayor** (box 18 · etb 22 · bundle 25 · tin 30 ·
  // blister 35). Un **UPC** (Ultra Premium Collection) es la pieza **más grande y cara** del catálogo,
  // así que va con **box**; una **collection** es comparable a un **ETB**. Hasta ahora las dos caían al
  // `SEALED_SPREAD_FALLBACK_PCT: 25` — un número que **nadie eligió** para la pieza más cara que
  // vendemos, y que era el síntoma exacto del que salió todo el hilo del enum en v2.1.8.
  //
  // ⚠️ **Es SEMILLA, no migración.** `prisma/seed.ts` upserta con `update: {}` (no pisa lo que el admin
  // ya editó), así que esta fila **sólo aplica a instalaciones LIMPIAS**. Una BD ya sembrada —la local
  // viva y producción cuando exista— conserva su fila de cinco llaves. Llevarlo a un entorno existente
  // es un **paso de runbook operativo**, no un despliegue: `PUT /admin/pricing/sealed-spreads`
  // (`super_admin`, auditado, sin redeploy). Ver `docs/BACKEND_NOTES.md` › «semilla ≠ migración».
  [SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE]: {
    box: 18,
    etb: 22,
    bundle: 25,
    tin: 30,
    blister: 35,
    upc: 18, // pieza más grande y cara del catálogo ⇒ mismo % que box
    collection: 22, // comparable a un ETB
  },
  [SettingKey.SEALED_SPREAD_FALLBACK_PCT]: 25,
  // v1.23-sealed-sales (§4.23h): feature flags cableados pero APAGADOS (seed off). El front llega
  // después; el súper-admin los enciende sin redeploy (PUT /admin/settings).
  [SettingKey.SEALED_VALUE_TREND]: 'off',
  [SettingKey.SEALED_RESTOCK_ALERTS]: 'off',
  // v1.44-graded-estimate (M-41, §4.38d): seed del «gancho de grading». La tabla de escalones y los
  // umbrales viven en `common/graded-estimate.ts` (pura, sin infra) para que seed, validadores y gate
  // compartan UNA sola fuente. El DIAL (`grading_hook_enabled`, v1.51) arranca en **off**
  // (fail-closed): el código se despliega INVISIBLE hasta que el humano dé el visto bueno al
  // disclaimer (§N.5) — y desde v1.51 encenderlo además GASTA, así que menos que nunca es decisión de
  // devops (§4.38r.3).
  [SettingKey.GRADED_ESTIMATE_GRADES]: DEFAULT_GRADED_ESTIMATE_GRADES,
  [SettingKey.GRADED_ESTIMATE_HIGHLIGHT_GRADES]: DEFAULT_GRADED_ESTIMATE_HIGHLIGHT_GRADES,
  [SettingKey.GRADED_ESTIMATE_FRESHNESS_DAYS]: DEFAULT_GRADED_ESTIMATE_FRESHNESS_DAYS,
  [SettingKey.GRADING_COST_TIERS]: DEFAULT_GRADING_COST_TIERS,
  [SettingKey.GRADING_MIN_UPSIDE_PCT]: DEFAULT_GRADING_MIN_UPSIDE_PCT,
  // v1.50.3 (§4.38m, GU-A16) — `manualFreshnessDays` arranca en **30**, NO en `null`. El seed de
  // v1.50.2 (`null` = «el override manual NUNCA caduca») desactivaba el criterio 109 para la vía
  // manual. `null` sigue siendo EXPRESABLE (es una decisión legítima del dueño) pero ya no es el
  // default, y elegirlo emite `warn` al izar la config (I8-bis).
  //
  // ⚠️ §11.0 — cambiar este seed **NO cambia ninguna base ya sembrada** (`prisma/seed.ts` hace
  // `upsert` con `update: {}`, que es correcto y no se toca: impide que un deploy pise el ajuste
  // deliberado de un operador). Un seed es una CONDICIÓN INICIAL, no un estado deseado, así que
  // esto sirve **solo a entornos nuevos**; los existentes se propagan por el paso de despliegue
  // explícito de §4.38(p) (`PUT /admin/pricing/graded-estimates`, auditado y validado). Lo mismo
  // vale para `minSampleCount` (3 → 5) y `maxRawMultiple` (50 → 100), abajo.
  [SettingKey.GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS]: DEFAULT_GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS,
  [SettingKey.GRADED_ESTIMATE_MAX_RAW_MULTIPLE]: DEFAULT_GRADED_ESTIMATE_MAX_RAW_MULTIPLE,
  [SettingKey.GRADED_ESTIMATE_MIN_SAMPLE_COUNT]: DEFAULT_GRADED_ESTIMATE_MIN_SAMPLE_COUNT,
  [SettingKey.GRADED_ESTIMATE_SOURCE_STAT]: DEFAULT_GRADED_ESTIMATE_SOURCE_STAT,
  [SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN]:
    DEFAULT_GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN,
  // v1.51 (M-46, §4.38r) — EL dial del gancho, seed `off` FAIL-CLOSED. Clave NUEVA: no existe en
  // ningún entorno, así que el deploy del colapso deja el gancho OSCURO por construcción y **no puede
  // empezar a gastar solo**. Encenderlo es un `PUT` humano, auditado, desde M10.
  //
  // ⚠️ FUSIÓN (rama del ciclo de adquisición ← main): en esta rama aquí se sembraba
  // `graded_estimate_ingest_enabled: 'off'`. NO sobrevive, y no es una pérdida: M-46 RETIRÓ esa
  // clave de `SettingKey` (la absorbe el dial único de arriba), así que sembrarla no compilaría. Su
  // fila histórica en entornos ya sembrados sigue inventariada en `RETIRED_SETTING_KEYS`, abajo.
  [SettingKey.GRADING_HOOK_ENABLED]: 'off',
  // ===== v1.51 (M-46, §4.39l) — seeds de los DIEZ diales del ciclo de adquisición =====
  // ⚠️ §11.0 NO APLICA y se dice para que devops no monte un paso de despliegue que no hace falta:
  // la disciplina de dos artefactos rige el cambio de un seed EXISTENTE. Estas diez son claves
  // NUEVAS, así que el `upsert` con `update:{}` de `seed.ts` SÍ las crea en entornos ya sembrados.
  //
  // ⚠️ LA SECUENCIA DE PLAZOS SE LEE SOLA, y por eso el dial 4 se llama así:
  //     emitir (7)  →  aceptar (2)  →  enviar (3),   todos en DÍAS HÁBILES.
  //   Se nombran por QUIÉN DEBE ACTUAR: el primero es NUESTRO, los otros dos del vendedor.
  //
  // ⚠️ Y LA SECUENCIA DE MONTOS TAMBIÉN:
  //     MX$500  mínimo de COTIZAR   (dial 3, sobre el BRUTO cotizado, al CREAR la solicitud)
  //     MX$180  lo que se DESCUENTA (dial 7, siempre, congelado al ofertar)
  //     MX$200  mínimo de COBRAR    (dial 9, sobre el NETO, al EMITIR la oferta)
  //     ─────
  //     MX$380  bruto mínimo OFERTABLE = dial 9 + dial 7   ⚠️ DERIVADO, NO ES UN DÉCIMO DIAL.
  //   `requiredGrossCents` SE CALCULA, no se configura: dos fuentes para el mismo número es la
  //   primera versión del bug (el día que alguien mueva la tarifa sin moverlo, el sistema bloquearía
  //   ofertas por una aritmética que ya no cuadra — el mismo error que costó cerrar `stripe_fee_iva_pct`).
  [SettingKey.BUYLIST_OFFER_ACCEPT_DEADLINE_BUSINESS_DAYS]: 2,
  [SettingKey.BUYLIST_SHIP_DEADLINE_BUSINESS_DAYS]: 3,
  [SettingKey.BUYLIST_MINIMUM_REQUEST_CENTS]: 50000, // MX$500, borde INCLUSIVO (criterio 158(a))
  [SettingKey.BUYLIST_OFFER_ISSUE_DEADLINE_BUSINESS_DAYS]: 7,
  [SettingKey.BUYLIST_OPERATOR_OFFER_CAP_CENTS]: 150000, // MX$1,500, borde INCLUSIVO (criterio 147)
  [SettingKey.BUYLIST_VARIANT_POSITION_CAP]: 10,
  [SettingKey.BUYLIST_SHIPPING_FEE_CENTS]: 18000, // MX$180 — ⚠️ NO es `shipping_fee_cents` (MX$175)
  [SettingKey.BUYLIST_SHIPMENT_CONFIRM_ALERT_BUSINESS_DAYS]: 5,
  [SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS]: 20000, // MX$200, borde INCLUSIVO (D34/D40)
  // Por qué el default es 2: *reponer el reloj UNA vez es corregir un error —justo lo que D38 vino a
  // permitir sin castigar al vendedor—; hacerlo DOS veces sobre la misma persona ya es una CONDUCTA,
  // y una conducta se mira.* Es dial y no constante porque (o.19) dejó que N lo fije el humano, y un
  // número que el humano mueve no puede exigir un redeploy. *Una alerta de más cuesta un vistazo;
  // una de menos cuesta un vendedor.*
  [SettingKey.BUYLIST_OFFER_REISSUE_ALERT_COUNT]: 2,
  // ⚠️ B-4 — el interruptor del PASO 6 de M-46 nace **APAGADO**, y ése ES el mecanismo. Un entorno
  // recién desplegado NO caduca ninguna `cotizada` ni manda un solo correo de «no procederemos»
  // hasta que un humano haya hecho el censo/triage y encienda esta fila a mano.
  [SettingKey.BUYLIST_NO_OFFER_EXPIRY_ENABLED]: 'off',
};

/**
 * v1.51 (M-46, §4.38r.1) — **claves RETIRADAS que SIGUEN EN LA TABLA de entornos ya sembrados.**
 *
 * No se borran, y es deliberado: (1) borrar filas de `ConfigSetting` en producción sería *escribir en
 * la configuración* para conseguir **cero** efecto de comportamiento —el código nuevo ya no las lee— y
 * §11.0 punto 4 lo prohíbe; (2) si el deploy se revierte, **la fila es lo que mantiene fail-closed al
 * código viejo** (encuentra `off` y no gasta), así que el rollback es seguro y completo.
 *
 * El coste de dejarlas es que **mienten a quien lea la tabla a pelo**, y por eso existe esta lista: el
 * inventario de arranque (§11.0, `SettingsService.logConfigInventory`) las imprime bajo el rótulo
 * «claves RETIRADAS presentes». Sin ese rótulo son una **trampa de diagnóstico**: el día del incidente
 * alguien lee `graded_estimate_ingest_enabled = off` y concluye que el ingest está apagado **mientras
 * gasta**.
 *
 * Solo lleva las dos de M-46 a propósito: son las únicas cuyo nombre AFIRMA algo sobre el gasto vivo.
 * Otras retiradas históricas (`stripe_fee_iva_pct`, `rarity_map`, las cinco de `pricing_curve`) son
 * inertes y mudas — listarlas cada arranque sería el ruido que este inventario existe para no tener.
 */
export const RETIRED_SETTING_KEYS = [
  'graded_estimates_enabled',
  'graded_estimate_ingest_enabled',
] as const;

const PROVIDER_VALUES = ['pokemontcg_io', 'pokemonpricetracker', 'poketrace', 'manual'];

/**
 * Valores válidos del dial `price_provider` (`BulkPriceProvider` del ingest MASIVO; NO `poketrace`/
 * `manual`, que son del pricing per-carta).
 *
 * ⚠️⚠️ **v1.65 — el ENUM y la SEMÁNTICA de cada valor los fija `API_CONTRACT §M10-PP`**
 * (`<!-- CANON: proveedor-de-precio -->`). Este bloque lo **CITA y no lo transcribe** (§0-B.3 regla 8):
 * ni describe qué hace cada proveedor, ni cuál es el seed (eso es `I-PP1` y su literal vive en
 * `SETTING_DEFAULTS`, arriba — §M10-PP lo nombra `DEFAULT_SETTINGS`, mismo mapa), ni qué valor corre
 * en ningún entorno (`I-PP2`: el VIGENTE se LEE).
 * La versión anterior de este comentario afirmaba un seed, y ésa fue una de las cinco copias que
 * produjeron la contradicción medida en `ARCHITECTURE §4.35a(a)`.
 *
 * ⛔ **Nada se retira de esta lista sin pasar por el arquitecto** (regla 9): `pokemontcg_io` sigue aquí
 * porque es la palanca de rollback operativo (`I-PP3`), y el contenido EXACTO está pineado contra el
 * contrato en `test/settings.validation.spec.ts`.
 */
export const PRICE_PROVIDER_VALUES = ['pokemontcg_io', 'pokemonpricetracker', 'tcgcsv_singles'];

/**
 * v1.19-sealed-tcgcsv (§4.19e): valores válidos del dial `sealed_price_source` (enum de
 * contrato `SealedPriceSource`; NO es enum de BD). `off` = fail-closed (no se ingiere nada).
 */
export const SEALED_PRICE_SOURCE_VALUES = ['tcgcsv', 'off'];

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && Number.isFinite(v);
}
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}








/**
 * v2.0 (P-48, §4.36.3) — validador de PUERTA del dial `pricing_curve`. Delega en el ÚNICO validador
 * (`common/pricing-curve.validatePricingCurve`, invariantes V1–V8) y aplana su resultado estructurado al
 * `string | null` que espera `SETTING_VALIDATORS`. El endpoint dedicado `PUT /admin/pricing/curve` usa la
 * forma ESTRUCTURADA para emitir el `422` con su código propio y el `details` que señala QUÉ PUNTO lo
 * rompe (criterio 87); aquí se conserva el mensaje para que ninguna puerta quede más permisiva que la
 * otra (misma doctrina que `validateFxManualOverrideRate`, FX-B2).
 */
export function validatePricingCurveSetting(v: unknown): string | null {
  const problem = validatePricingCurve(v);
  if (problem == null) return null;
  const where =
    problem.details.axis != null && problem.details.index != null
      ? ` [${problem.details.axis}.points[${problem.details.index}]]`
      : problem.details.axis != null
        ? ` [${problem.details.axis}]`
        : '';
  return `${problem.code}: ${problem.message}${where}`;
}






/**
 * v1.23-sealed-sales (§4.23c): tope del spread de venta del sellado. Mismo criterio que el pct de
 * venta (markup arriba de mercado): puede superar 100% (una promo/pieza rara), tope 1000% evita typos.
 * SUP-8: el validador PERMITE `>= 0` (un spread 0 vende a mercado sin margen; el editor M2 lo advierte);
 * no se fuerza `> 0` para no bloquear una promo deliberada.
 */
export const SEALED_SPREAD_PCT_MAX = 1000;

/** Subtipos válidos del sellado (llaves de `sealed_spread_pct_by_subtype`). */
// v2.1.8: DERIVADO del schema. Con la lista de cinco a mano, `PUT /admin/pricing/sealed-spreads`
// devolvía 422 para `upc`/`collection`, así que el dueño NO podía calibrarles spread y salían al
// fallback del 25 % — un UPC es pieza grande, comparable a una box (18 %) o un ETB (22 %).
export const SEALED_SUBTYPE_KEYS: string[] = [...SEALED_SUBTYPE_VALUES];

/**
 * Valida el mapa `sealed_spread_pct_by_subtype`: objeto, cada clave ∈ `SEALED_SUBTYPE_KEYS`, cada
 * value número en `[0, SEALED_SPREAD_PCT_MAX]`. API_CONTRACT §M2 (GET/PUT /admin/pricing/sealed-spreads).
 *
 * ### v2.1.9 (D3-b) — `null` es el SENTINEL DE RETIRO, y NO es `0`
 * Un valor `null` significa **«quita la regla propia de esta presentación; usa `fallbackPct`»** y por
 * eso se ACEPTA aquí (el `PUT` lo traduce a borrar la llave del mapa persistido). Es el mismo sentinel
 * que este §M2 ya usa para el mismo gesto: `tcgplayerProductId: null` **desmapea** un item sellado.
 *
 * ⚠️ **`null` ≠ `0`, y confundirlos es un bug de DINERO.** `0` es un spread **legítimo** (§SUP-8) y
 * significa **vender AL mercado, sin markup**; `null` significa «no tengo regla, usa el global» (hoy
 * 25 %). Un campo VACIADO en la pantalla viaja como `null`, **jamás** como `0` — que pondría esa
 * presentación a precio de mercado sin margen sin que nadie lo pidiera.
 *
 * Se usa para VALIDAR el REQUEST (`SealedSpreadsUpdateRequest`), donde `null` es legal, y también
 * como validador del setting persistido — donde no habrá `null` nunca, porque el `PUT` los consume
 * borrando la llave. Aceptarlo en los dos lados es inocuo y evita un segundo cuerpo de la misma regla.
 */
export function validateSealedSpreads(v: unknown): string | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return 'must be an object map { [subtype]: number }';
  }
  for (const [subtype, value] of Object.entries(v as Record<string, unknown>)) {
    if (!SEALED_SUBTYPE_KEYS.includes(subtype)) {
      return `invalid subtype "${subtype}": must be one of ${SEALED_SUBTYPE_KEYS.join('|')}`;
    }
    // D3-b: `null` = RETIRO de la regla (el PUT borra la llave). Legal y distinto de `0`.
    if (value === null) continue;
    if (!(isNum(value) && value >= 0 && value <= SEALED_SPREAD_PCT_MAX)) {
      return `invalid spread for "${subtype}": must be a number in [0, ${SEALED_SPREAD_PCT_MAX}], or null to remove the rule`;
    }
  }
  return null;
}

/**
 * Valida el fallback `sealed_spread_fallback_pct` (número en `[0, SEALED_SPREAD_PCT_MAX]`).
 *
 * v2.1.9 (D3-b) — **`null` NO se acepta aquí, a diferencia del mapa por presentación.** El global es
 * el respaldo del que dependen TODAS las presentaciones sin regla propia: retirarlo las dejaría sin
 * dónde derivar precio ⇒ `PRICE_PENDING` ⇒ **fuera de la vitrina**. Es una consecuencia de dinero
 * para un gesto que parece de limpieza, así que se corta con un mensaje que dice qué hacer en su
 * lugar: para «no aplicar markup global» el valor correcto es **`0`**, no la ausencia.
 */
export function validateSealedSpreadFallback(v: unknown): string | null {
  if (v === null) {
    return `fallbackPct cannot be removed: it is the fallback every presentation without its own rule depends on (removing it would leave them PRICE_PENDING, i.e. unpublished). Use 0 for "no global markup"`;
  }
  return isNum(v) && v >= 0 && v <= SEALED_SPREAD_PCT_MAX
    ? null
    : `must be a number in [0, ${SEALED_SPREAD_PCT_MAX}]`;
}

/**
 * FX-B1: cota SUPERIOR del override manual `fx_manual_override_rate`.
 *
 * ⚠️ **v1.63.4 (`FX-24`, §M2-F.8): ES UN ALIAS, no una segunda definición.** La banda de la tasa
 * —piso **y** techo— vive en **un solo sitio**, `common/fx-mode.ts` ({@link FX_RATE_MIN},
 * {@link FX_RATE_MAX}, {@link isFxRateInBand}), porque la comparten las **dos** puertas de escritura
 * y *dos literales en dos ficheros son dos bandas esperando a divergir*. Este nombre se conserva
 * porque hay citas vivas (specs, `pricing.controller`) y renombrarlo no aporta nada.
 */
export const MAX_FX_MANUAL_OVERRIDE_RATE = FX_RATE_MAX;

/**
 * FX-B2: validador ÚNICO del dial `fx_manual_override_rate`, compartido por las DOS puertas que lo
 * escriben (`PUT /admin/settings` vía SETTING_VALIDATORS y `PUT /admin/fx` vía FxController).
 *
 * ### ⭐⭐ v1.63.4 (`FX-24`, §M2-F.8) — LA BANDA GANA PISO: `(0, 1000]` → **`[1, 1000]`**
 * Regla: `null` (borra el override) **o** un número FINITO en la banda `[1, 1000]`, **extremos
 * incluidos**. Fraccional es válido porque `FxRate.rate` es `Decimal(12,6)`.
 *
 * **El veredicto lo da {@link isFxRateInBand}, que es el MISMO cuerpo que aplica el parser de la
 * SIE** ({@link parseBanxicoRate}): ninguna puerta queda más permisiva que la otra **en ninguno de
 * los dos extremos**, y la paridad se asierta como **identidad** (`FX-24(b)`), no como dos copias de
 * la misma lista. *El peso nunca ha valido más que el dólar: por debajo de `1` el número no es el
 * par, es su inversa, un error de escala o basura truncada.*
 *
 * ⚠️ El `message` **nombra los DOS extremos** (`FX-24(d)`): hasta v1.63.3 sólo nombraba el techo, así
 * que quien tecleaba `0.05` recibía un error que no explicaba nada de lo que acababa de pasar.
 */
export function validateFxManualOverrideRate(v: unknown): string | null {
  return v === null || (isNum(v) && isFxRateInBand(v))
    ? null
    : `must be null or a number in ${FX_RATE_BAND_TEXT} (USD→MXN is quoted in pesos per dollar: ` +
        `below ${FX_RATE_MIN} the number is not the pair — it is its inverse, a scale error or truncated garbage)`;
}

/** v1.23-sealed-sales (§4.23h): valores válidos de los feature flags del sellado (on|off). */
export const FEATURE_FLAG_VALUES = ['on', 'off'];

/**
 * v1.44-graded-estimate (I7, §4.38d) — valida una LISTA de grados (`grades` / `highlightGrades`):
 * array de strings ⊆ `{"10","9"}`, NO vacío y sin duplicados. Lista cerrada a propósito: otros grados
 * (PSA <= 8) y otras graduadoras quedan fuera de alcance (§O.1 — era §N.1 antes de que el merge de
 * pricing v2 desplazara el bloque del gancho), y una key desconocida sembraría un
 * grado que el resolver nunca podría leer.
 */
export function validateGradeList(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) {
    return `must be a non-empty array of grades (${GRADED_ESTIMATE_GRADE_VALUES.join('|')})`;
  }
  const seen = new Set<string>();
  for (const g of v) {
    if (typeof g !== 'string' || !GRADED_ESTIMATE_GRADE_VALUES.includes(g)) {
      return `invalid grade "${String(g)}": must be one of ${GRADED_ESTIMATE_GRADE_VALUES.join('|')}`;
    }
    if (seen.has(g)) return `duplicate grade "${g}"`;
    seen.add(g);
  }
  return null;
}

/** v1.44 (I6): `grading_min_upside_pct` = número en [0, 1000] (% de upside exigido por la curaduría). */
export function validateGradingMinUpsidePct(v: unknown): string | null {
  return isNum(v) && v >= 0 && v <= GRADING_MIN_UPSIDE_PCT_MAX
    ? null
    : `must be a number in [0, ${GRADING_MIN_UPSIDE_PCT_MAX}]`;
}

/**
 * ⭐⭐ **`iva_pct` — ENTERO en [0, 100], y el «entero» NO es gusto: es la COLUMNA.**
 *
 * **El defecto que cierra (medido, no supuesto).** El validador anterior era `isNum(v) && 0 <= v <= 100`
 * — `typeof v === 'number'`, o sea **decimales incluidos**. Pero la tasa que este dial fija se **congela
 * por orden** en `Order.ivaRatePct`, que es **`Int`** (`prisma/schema.prisma`). Medido contra Postgres 16
 * real con `prisma.order.create`: **`8.5` no revienta — se TRUNCA en silencio a `8`** (y `8.9`→`8`,
 * `15.999`→`15`, `0.5`→`0`: truncamiento hacia cero, no redondeo). No hay excepción, no hay aviso, no hay
 * fila de bitácora que lo diga.
 *
 * **Por qué eso es dinero y no cosmética.** El truncamiento ocurre **solo en la fila**, no en la
 * aritmética: `computeCartBreakdown` (`common/money.ts`) calcula `ivaCents` con el **float vivo**. Con el
 * dial en `8.5` y un subtotal de MX$100.00 se cobran **850 centavos** de IVA y se archiva `ivaRatePct = 8`
 * — una fila que dice *«cobré 8 %»* junto a un importe que es **8.5 %**. Esa fila es la que viaja al DTO
 * de la orden y la que sostiene el desglose fiscal: la orden **miente sobre la tasa con la que se cobró**,
 * y miente **hacia abajo**, que es el lado que le interesa a quien audite.
 *
 * **Por qué NO es un caso de laboratorio.** El **8 %** es una tasa de IVA **real** en México (zona
 * fronteriza norte). Un `8.5` no es un fat-finger exótico: es lo que teclea alguien que está en medio de
 * ese cambio y se equivoca por medio punto. Y el dial lo edita un `super_admin` **sin redeploy**.
 *
 * **Por qué se cierra AQUÍ y no en el esquema.** La cura barata sería volver la columna decimal; **no se
 * hace**: `Order.ivaRatePct` es zona compartida y su tipo es decisión del arquitecto.
 * ✅ **v1.64 (`D-IVA-4`) — esa decisión YA ESTÁ TOMADA y este comentario decía lo contrario.** D54 fue
 * **APROBADA el 2026-09-09** y `PROJECT §Q` es **alcance vigente**; llamarla *«borrador NO vigente»*
 * mandaba a quien leyera el fichero que gobierna dos diales de dinero a buscar una decisión pendiente
 * que ya no existe. **`ARCHITECTURE §4.44.g` la fija: la columna SIGUE siendo `Int` y el rango SIGUE
 * siendo entero**, también para el dial nuevo `iva_transfer_pct`. ⇒ **el razonamiento de abajo no
 * cambia ni una línea de lógica; lo que cambia es que ya no espera a nadie.**
 * El validador, en cambio, solo tiene que **dejar de aceptar lo que la columna no puede
 * representar**: un `422` explícito es estrictamente mejor que un truncamiento mudo en una tasa de
 * impuestos. **Nada legítimo se pierde**: las tres tasas mexicanas vigentes —`0`, `8` y `16`— son enteras.
 *
 * ⚠️ **Si algún día el negocio necesita una tasa fraccionaria, este validador NO es el sitio donde
 * relajarlo**: primero cambia la columna (decisión del arquitecto), después este rango. Relajarlo solo
 * aquí devuelve el truncamiento silencioso tal cual.
 */
export function validateIvaPct(v: unknown): string | null {
  return isInt(v) && v >= 0 && v <= 100
    ? null
    : 'must be an integer in [0, 100] (percent). Decimals are rejected because the rate is frozen ' +
        'per order in the integer column `Order.ivaRatePct`, where a value like 8.5 would be ' +
        'silently truncated to 8 while the charged IVA still used 8.5';
}

/**
 * ⭐⭐ **`iva_transfer_pct` — LA FRACCIÓN DE IVA QUE SE TRASLADA AL PRECIO EXHIBIDO. ENTERO en [0, 100].**
 * (v1.64-iva-inclusive, `ARCHITECTURE §4.44.g`, `API_CONTRACT §M10-IVA.1`, D54 aprobada 2026-09-09.)
 *
 * ⛔ **NO son puntos de IVA y NO es la tasa.** `t = 100` significa *«traslado el IVA entero»* (el
 * neutro: reproduce el cobro de hoy al centavo); `t = 0` significa *«lo absorbo entero»*. Bajar el
 * dial **⛔ no baja el impuesto: baja el precio exhibido**, y esa diferencia **sale del margen**. Es
 * un **dial de margen**, y por eso su puerta (deploy 2) exige que el servidor haya mostrado el costo
 * en pesos antes de guardar (criterio 188).
 *
 * **Por qué ENTERO, con la misma razón exacta que `iva_pct` y `aportacion_pct`: es la COLUMNA.**
 * `Order.ivaTransferPct` es `Int` (M-50). Un `37.5` **no revienta: se TRUNCA en silencio a `37`**
 * mientras el precio exhibido se calculó con `37.5` — una fila que dice *«trasladé 37 %»* junto a un
 * importe que es de 37.5 %. Es literalmente el defecto que `TD-IVA-1`/`TD-IVA-2` cerraron.
 * El criterio **187** exige poder guardar `0`, `37`, `50` y `100`: los cuatro son enteros.
 *
 * ⚠️ **Si algún día el negocio necesita medio punto de traslación, este validador NO es el sitio donde
 * relajarlo.** El orden es: (1) la COLUMNA —decisión del arquitecto—, (2) después este rango. Al revés
 * devuelve el truncamiento mudo tal cual.
 *
 * *(El `message` nombra LOS DOS EXTREMOS a propósito: lo exige `API_CONTRACT §M10-IVA.5`, candado
 * `IVA-8(d)`.)*
 */
export function validateIvaTransferPct(v: unknown): string | null {
  return isInt(v) && v >= 0 && v <= 100
    ? null
    : 'must be an integer in [0, 100] (percentage points of IVA TRANSFERRED to the displayed ' +
        'price; 0 = absorbed, 100 = fully passed through). Decimals are rejected because the value ' +
        'is frozen per order in the integer column `Order.ivaTransferPct`, where 37.5 would be ' +
        'silently truncated to 37 while the displayed price still used 37.5';
}

/**
 * ⭐⭐ **`aportacion_pct` — ENTERO en [0, 100]. Mismo defecto que `iva_pct`, otro dial, otra columna.**
 *
 * **El defecto que cierra (medido contra Postgres 16 real, no deducido del tipo).** El validador
 * anterior era `isNum(v) && 0 <= v <= 100` — `typeof v === 'number'`, o sea **decimales incluidos**.
 * Pero el porcentaje se **congela por pieza** en `InventoryItem.acquisitionPct`, que es **`Int`**
 * (`prisma/schema.prisma`). Medido con `prisma.inventoryItem.create`: **`70.5` no revienta — se
 * TRUNCA en silencio a `70`** (`70.9`→`70`, `99.999`→`99`, `0.5`→`0`: truncamiento hacia cero, no
 * redondeo). Sin excepción, sin aviso, sin bitácora.
 *
 * **El agravante, que es el que convierte esto en dinero.** El truncamiento ocurre **solo en la
 * fila**, no en la aritmética. En `inventory.service.ts` el costo se calcula con el **float vivo**
 * (`computeAportacionCostCents(referenceCents, pct)`) y la MISMA variable se escribe en la columna
 * `Int`. Con el dial en `70.5` y una referencia de MX$1,000.00 la pieza archiva
 * `acquisitionCostCents = 70500` junto a `acquisitionPct = 70`, y **el 70 % de MX$1,000.00 son
 * 70,000 centavos, no 70,500**: *el porcentaje guardado NO reproduce el costo guardado*, y falla
 * **500 centavos por cada MX$1,000 de referencia** (con `70.9`, 900; con `99.999`, 999).
 *
 * **Por qué duele más que en el IVA.** `acquisitionCostCents` es **lo que la pieza dice que costó**:
 * la base del P&L y del margen, y —en aportación en especie— lo que se le acredita a quien aportó.
 * Quien audite y recalcule el costo desde el porcentaje archivado obtiene **menos costo del real**
 * ⇒ **margen inflado**. La fila no se contradice con un reporte externo: se contradice **consigo
 * misma**, y las dos mitades de la contradicción viajan juntas en el mismo DTO de inventario.
 *
 * **No es un valor de laboratorio.** `70` es el default y `100` lo manda el alta rápida; un `70.5`
 * es el medio punto de quien afina la política de aportación. El dial lo edita un `super_admin`
 * **sin redeploy**, y el camino del DTO (`acquisitionPct` con `@IsInt()`) **ya está blindado**: este
 * era el ÚNICO hueco por el que entraba un decimal.
 *
 * **Por qué se cierra AQUÍ y no en el esquema.** `InventoryItem.acquisitionPct` vive en
 * `prisma/schema.prisma`, **zona compartida**; su tipo es decisión del arquitecto.
 * ✅ **v1.64 (`D-IVA-4`) — el «cambio de contrato en vuelo» que decía esta línea era D54, y ATERRIZÓ:
 * aprobada 2026-09-09, `PROJECT §Q` es alcance vigente y `ARCHITECTURE §4.44.g` ratifica el criterio
 * entero (columna `Int` ⇒ rango entero).** No queda nada en vuelo que justifique esperar aquí.
 * El validador, en cambio, solo tiene que **dejar de aceptar lo que la
 * columna no puede representar**: un `422` explícito es estrictamente mejor que un truncamiento mudo
 * en la base del costo. **Nada legítimo se pierde**: los porcentajes de aportación que el negocio usa
 * hoy —`70` (default del formulario) y `100` (alta rápida, §4.39 del contrato)— son enteros.
 *
 * ⚠️ **Si algún día el negocio necesita una aportación fraccionaria (p. ej. 72.5 %), este validador
 * NO es el sitio donde relajarlo. El orden es: (1) la COLUMNA —decisión del arquitecto: decimal o
 * escalada en enteros—, (2) DESPUÉS este rango.** Relajarlo solo aquí devuelve, tal cual, el
 * truncamiento silencioso y la fila que se contradice a sí misma.
 */
export function validateAportacionPct(v: unknown): string | null {
  return isInt(v) && v >= 0 && v <= 100
    ? null
    : 'must be an integer in [0, 100] (percent). Decimals are rejected because the percentage is ' +
        'frozen per piece in the integer column `InventoryItem.acquisitionPct`, where a value like ' +
        '70.5 would be silently truncated to 70 while the acquisition cost was still computed with ' +
        '70.5 — the stored percentage would no longer reproduce the stored cost';
}

/** v1.44 (I6): `graded_estimate_freshness_days` = entero en [1, 365]. */
export function validateGradedEstimateFreshnessDays(v: unknown): string | null {
  return isInt(v) && v >= GRADED_ESTIMATE_FRESHNESS_DAYS_MIN && v <= GRADED_ESTIMATE_FRESHNESS_DAYS_MAX
    ? null
    : `must be an integer in [${GRADED_ESTIMATE_FRESHNESS_DAYS_MIN}, ${GRADED_ESTIMATE_FRESHNESS_DAYS_MAX}] (days)`;
}

/**
 * ============================ v1.51 (M-46, §4.39l) — LOS DIEZ DIALES DEL CICLO ============================
 * Validadores de los diez, y la **validación CRUZADA BLOQUEANTE** entre tres de ellos.
 */

/** Plazos del ciclo (diales 1, 2, 4) y umbrales de alerta/posición (6, 8, 10): **entero ≥ 1**. */
export function validatePositiveIntDial(unit: string): (v: unknown) => string | null {
  return (v) => (isInt(v) && v >= 1 ? null : `must be an integer >= 1 (${unit})`);
}

/**
 * **Dial 9 — `buylist_minimum_offer_net_cents`: el `0` NO es un valor legal, y NO es pedantería.**
 *
 * Con el piso en `0` la guarda de emisión `net < 0` **nunca dispara** y vuelve a ser emitible **la
 * oferta que anuncia MX$0** — el agujero exacto que (o.12) cerró. Con el piso en su **valor mínimo
 * legal (1 centavo)** la regla degenera **EXACTAMENTE** en la de v1.51.1 (`net < 1` ⇔ `net <= 0`):
 * **la guarda vieja no se perdió, se convirtió en el suelo del dial**, y por eso el suelo no puede
 * bajar más. *Poner este dial en 0 sería el «apagar un dial en vez de retirarlo» que la arquitectura
 * prohíbe en tres sitios distintos.*
 */
export function validateBuylistMinimumOfferNetCents(v: unknown): string | null {
  return isInt(v) && v >= 1
    ? null
    : 'must be an integer >= 1 (cents). 0 is NOT legal: with the floor at 0 the `net < floor` guard ' +
        'never fires and an offer announcing MX$0 becomes issuable again';
}

/**
 * **Nombre de la regla cruzada, en el `details` del 422.** ⚠️ **CAMBIA POR SEGUNDA VEZ**
 * (`…_lt_threshold` → `…_lt_minimum` → **`…_fee_plus_min_net_le_min_request`**): los nombres
 * anteriores describen relaciones de **dos** términos que **ya no son la regla**, y *un
 * `details.rule` que miente es peor que uno ausente*.
 */
export const BUYLIST_CROSS_DIAL_RULE = 'buylist_fee_plus_min_net_le_min_request';

/** Los tres diales que participan en la validación cruzada. El **10 NO está**, y es a propósito. */
export interface BuylistCrossDialValues {
  shippingFeeCents: number;
  minimumOfferNetCents: number;
  minimumRequestCents: number;
}

export interface BuylistCrossDialProblem {
  rule: typeof BUYLIST_CROSS_DIAL_RULE;
  message: string;
  shippingFeeCents: number;
  minimumOfferNetCents: number;
  minimumRequestCents: number;
}

/**
 * **VALIDACIÓN CRUZADA BLOQUEANTE ENTRE TRES DIALES (criterio 127) — tercera reformulación (D34).**
 *
 * ```
 * ⛔ v1.51   (SUPERSEDED):  buylistShippingFeeCents                               <  buylistShippingThresholdCents
 * ⛔ v1.51.1 (SUPERSEDED):  buylistShippingFeeCents                               <  buylistMinimumRequestCents
 * ✅ v1.51.2 (VIGENTE):     buylistShippingFeeCents + buylistMinimumOfferNetCents <= buylistMinimumRequestCents
 *                           //  18000 + 20000 = 38000  <=  50000   ⇒  guarda (defaults, $120 de holgura)
 * ```
 *
 * **En una frase: _el bruto mínimo OFERTABLE nunca puede superar el mínimo de COMPRA_.** O sea:
 * **nunca prometemos comprar desde una cifra que el sistema después no podría ofertar.**
 *
 * ### Por qué gana un término (y la propiedad sube un escalón en la misma dirección)
 * La versión de v1.51.1 impedía que «la solicitud más chica que el sistema acepta crear, aprobada
 * entera y al precio cotizado, depositara **MX$0**». Con el piso de D34 aparece un fallo **peor y
 * hasta ahora imposible**: que esa misma solicitud **no se pueda ni EMITIR**. Ocurre exactamente
 * cuando `tarifa + piso > mínimo`, y **los tres diales pueden ser legales por separado**: con
 * `tarifa=$200, piso=$350, mínimo=$500` la regla vieja pasa ($200 < $500) y sin embargo un vendedor
 * que cotiza **exactamente $500** —la cifra que le prometimos— crea su solicitud, espera **7 días
 * hábiles** y recibe un *«no procederemos»* **que no decidió ninguna persona**: lo decidió una
 * combinación de diales. *Un trato que no le paga nada a quien cumplió perfecto era una **oferta
 * rota**; un trato que ni siquiera se puede formular es una **promesa rota**.*
 *
 * ### SUSTITUYE a la de v1.51.1, no se apila
 * Con `piso >= 1`, `tarifa + piso <= mínimo` **implica** `tarifa < mínimo`. Conservar las dos dejaría
 * una regla **que no puede disparar nunca**, y una regla que no dispara es la que el primer refactor
 * borra *«porque no hace nada»*. **La vieja queda CONTENIDA en la nueva**, y el borde
 * `(49999, 1, 50000)` lo demuestra.
 *
 * ### Por qué `<=` y no `<`
 * Con `tarifa + piso = mínimo`, la solicitud mínima aprobada entera produce un neto **exactamente
 * igual al piso**, y la guarda de emisión es `net < piso` ⇒ **la oferta SALE**. Rechazar la igualdad
 * prohibiría una configuración que funciona.
 *
 * ### Lo que esta validación SIGUE SIN garantizar, dicho en voz alta
 * El mínimo se juzga **al crear la solicitud** sobre el **total cotizado** y **NO se re-aplica a la
 * oferta** (criterio 158(c)): el **bruto ofertado** puede quedar por debajo de `requiredGrossCents`
 * tras un cherry-pick. **Ese caso NO lo cubre ningún dial** —los diales no ven el recorte— y por eso
 * se cubre **donde sí se ve: en la emisión** (`422 OFFER_NET_BELOW_MINIMUM`). **Dos guardas, dos
 * bases, cero solapamiento:** M10 protege del **dial mal puesto**; la emisión, de la **oferta mal
 * armada**.
 *
 * ⚠️ **Es BLOQUEANTE, no una advertencia**, y aplica **en los TRES sentidos**: subir la tarifa,
 * subir el piso o bajar el mínimo de compra se rechazan **igual**.
 */
export function validateBuylistCrossDials(
  v: BuylistCrossDialValues,
): BuylistCrossDialProblem | null {
  const { shippingFeeCents, minimumOfferNetCents, minimumRequestCents } = v;
  if (shippingFeeCents + minimumOfferNetCents <= minimumRequestCents) return null;
  return {
    rule: BUYLIST_CROSS_DIAL_RULE,
    message:
      `buylistShippingFeeCents (${shippingFeeCents}) + buylistMinimumOfferNetCents ` +
      `(${minimumOfferNetCents}) = ${shippingFeeCents + minimumOfferNetCents} exceeds ` +
      `buylistMinimumRequestCents (${minimumRequestCents}). The minimum OFFERABLE gross must never ` +
      'be above the minimum PURCHASE amount: otherwise the smallest request the system accepts to ' +
      'create could not even be offered, and a seller who quoted exactly the amount we promised ' +
      'would wait the full issue deadline only to be told "we will not proceed" — a decision no ' +
      'person made. Lower the shipping fee or the net floor, or raise the purchase minimum.',
    shippingFeeCents,
    minimumOfferNetCents,
    minimumRequestCents,
  };
}

/**
 * Validadores por dial (fix correctness #2). Cada uno devuelve un mensaje de error o
 * `null` si es válido. Rangos coherentes con la matemática de `money.ts` para que un
 * dial mal escrito NO rompa el checkout (NaN / división por cero / negativos).
 */
export const SETTING_VALIDATORS: Record<SettingKeyType, (v: unknown) => string | null> = {
  [SettingKey.SHIPPING_FEE_CENTS]: (v) => (isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (cents)'),
  // ⭐ ENTERO, no «número»: el pct se congela en la columna `Int` `InventoryItem.acquisitionPct` y un
  // `70.5` se truncaba a `70` EN SILENCIO mientras el COSTO se calculaba con 70.5 — la fila dejaba de
  // reproducir su propio costo. Ver el docblock de `validateAportacionPct`.
  [SettingKey.APORTACION_PCT]: validateAportacionPct,
  // ⭐ ENTERO, no «número»: la tasa se congela en la columna `Int` `Order.ivaRatePct` y un `8.5` se
  // truncaba a `8` EN SILENCIO mientras el cobro usaba 8.5. Ver el docblock de `validateIvaPct`.
  [SettingKey.IVA_PCT]: validateIvaPct,
  // ⭐ ENTERO en [0,100], y el «entero» NO es gusto: es la COLUMNA `Order.ivaTransferPct` (`Int`,
  // M-50). Un `37.5` se truncaría en silencio a `37` mientras el precio se calculó con `37.5` — el
  // MISMO defecto que cerraron `validateIvaPct` y `validateAportacionPct`. Ver `validateIvaTransferPct`.
  [SettingKey.IVA_TRANSFER_PCT]: validateIvaTransferPct,
  [SettingKey.SALES_MARKUP_PCT]: (v) => (isNum(v) && v >= 0 ? null : 'must be a number >= 0'),
  // stripe_fee_pct es una FRACCIÓN en [0,1); si fuera >= 1 el gross-up dividiría por <= 0.
  [SettingKey.STRIPE_FEE_PCT]: (v) => (isNum(v) && v >= 0 && v < 1 ? null : 'must be a fraction in [0, 1)'),
  [SettingKey.STRIPE_FEE_FIXED_CENTS]: (v) => (isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (cents)'),
  // v1.40 (P-37): STRIPE_FEE_IVA_PCT retirado (deriva de IVA_PCT); ya no hay validador para esa key.
  [SettingKey.BUYLIST_CAP_PER_REQUEST_CENTS]: (v) => (isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (cents)'),
  [SettingKey.BUYLIST_CAP_PER_MONTH_CENTS]: (v) => (isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (cents)'),
  [SettingKey.INE_THRESHOLD_CENTS]: (v) => (isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (cents)'),
  [SettingKey.REPO_CAP_PER_CARD_CENTS]: (v) => (isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (cents)'),
  [SettingKey.FX_BUFFER_PCT]: (v) => (isNum(v) && v >= 0 && v <= 100 ? null : 'must be a number in [0, 100]'),
  // override de FX: null (sin override) o un tipo de cambio en (0, MAX] (FX-B1/FX-B2, validador
  // compartido con PUT /admin/fx para que ambas puertas apliquen el mismo rango).
  [SettingKey.FX_MANUAL_OVERRIDE_RATE]: validateFxManualOverrideRate,
  // v1.63.1 (§4.43g punto 3): acepta los TRES valores ALMACENABLES y nada más. `"legacy"` es el
  // seed, NO un modo de API. Un `true` o un `"AUTO"` en esta fila no puede quedar guardado
  // pareciendo un modo — y si aparece por escritura directa a la BD, `resolveFxMode()` lo trata
  // como legacy (no cambia lo que está pasando) y el inventario de arranque lo grita.
  [SettingKey.FX_RATE_MODE]: (v) =>
    typeof v === 'string' && (FX_RATE_MODE_STORED_VALUES as readonly string[]).includes(v)
      ? null
      : `must be one of ${FX_RATE_MODE_STORED_VALUES.join('|')}`,
  [SettingKey.PRICING_PROVIDER_RAW]: (v) =>
    typeof v === 'string' && PROVIDER_VALUES.includes(v) ? null : `must be one of ${PROVIDER_VALUES.join('|')}`,
  [SettingKey.PRICING_PROVIDER_GRADED]: (v) =>
    typeof v === 'string' && PROVIDER_VALUES.includes(v) ? null : `must be one of ${PROVIDER_VALUES.join('|')}`,
  [SettingKey.PRICING_PROVIDER_SEALED]: (v) =>
    typeof v === 'string' && PROVIDER_VALUES.includes(v) ? null : `must be one of ${PROVIDER_VALUES.join('|')}`,
  // Fuera del enum de `API_CONTRACT §M10-PP` ⇒ `422 VALIDATION_ERROR`. La lista vive en
  // `PRICE_PROVIDER_VALUES` (arriba) y NO se re-escribe aquí: este comentario llegó a transcribir un
  // enum de DOS valores que ya no era el del contrato (§0-B.3 regla 8).
  [SettingKey.PRICE_PROVIDER]: (v) =>
    typeof v === 'string' && PRICE_PROVIDER_VALUES.includes(v)
      ? null
      : `must be one of ${PRICE_PROVIDER_VALUES.join('|')}`,
  // v1.19-sealed-tcgcsv (§4.19e): IsIn(['tcgcsv','off']) → 422 VALIDATION_ERROR si otro valor.
  [SettingKey.SEALED_PRICE_SOURCE]: (v) =>
    typeof v === 'string' && SEALED_PRICE_SOURCE_VALUES.includes(v)
      ? null
      : `must be one of ${SEALED_PRICE_SOURCE_VALUES.join('|')}`,
  // v2.0 (P-48, §4.36.3): la CURVA. Editable SOLO por PUT /admin/pricing/curve (no está en
  // SETTING_DTO_MAP), pero se valida igual en esta puerta: V1–V8 money-safe, sin excepción.
  [SettingKey.PRICING_CURVE]: validatePricingCurveSetting,
  // v1.23-sealed-sales (§4.23c/§4.23h): spreads del sellado (editados por M2, no por PUT settings,
  // pero se validan igual) + feature flags on|off.
  [SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE]: validateSealedSpreads,
  [SettingKey.SEALED_SPREAD_FALLBACK_PCT]: validateSealedSpreadFallback,
  [SettingKey.SEALED_VALUE_TREND]: (v) =>
    typeof v === 'string' && FEATURE_FLAG_VALUES.includes(v) ? null : `must be one of ${FEATURE_FLAG_VALUES.join('|')}`,
  [SettingKey.SEALED_RESTOCK_ALERTS]: (v) =>
    typeof v === 'string' && FEATURE_FLAG_VALUES.includes(v) ? null : `must be one of ${FEATURE_FLAG_VALUES.join('|')}`,
  // v1.44-graded-estimate (M-41, §4.38d): los cinco diales de M2 se editan por
  // GET/PUT /admin/pricing/graded-estimates (no por PUT /admin/settings), pero se validan igual —
  // misma doctrina que los spreads del sellado. `grading_cost_tiers` usa el validador COMPARTIDO
  // I1–I5 de `common/graded-estimate.ts` (el mismo que aplica el PUT y la lectura fail-closed).
  [SettingKey.GRADED_ESTIMATE_GRADES]: validateGradeList,
  [SettingKey.GRADED_ESTIMATE_HIGHLIGHT_GRADES]: validateGradeList,
  [SettingKey.GRADED_ESTIMATE_FRESHNESS_DAYS]: validateGradedEstimateFreshnessDays,
  [SettingKey.GRADING_COST_TIERS]: (v) => validateGradingCostTiers(v)?.message ?? null,
  [SettingKey.GRADING_MIN_UPSIDE_PCT]: validateGradingMinUpsidePct,
  // v1.50.2 (I8/I9) — MISMOS validadores compartidos que aplica el `PUT` de M2 y la lectura fail-closed
  // del resolver. Una sola verdad por invariante: si divergieran, el `422` y el apagado on-read dirían
  // cosas distintas sobre el mismo valor.
  [SettingKey.GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS]: validateGradedEstimateManualFreshnessDays,
  [SettingKey.GRADED_ESTIMATE_MAX_RAW_MULTIPLE]: validateGradedEstimateMaxRawMultiple,
  [SettingKey.GRADED_ESTIMATE_MIN_SAMPLE_COUNT]: validateGradedEstimateMinSampleCount,
  [SettingKey.GRADED_ESTIMATE_SOURCE_STAT]: validateGradedEstimateSourceStat,
  [SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN]: validateGradedEstimateIngestMaxCards,
  // v1.51 (M-46) — EL dial del gancho (M10, seed `off`): on|off, editable por PUT /admin/settings.
  // SOLO el string `'on'` enciende en la LECTURA (`gradingHookEnabledFrom`); aquí se rechaza todo lo
  // que no sea `on|off` para que un `true` o un `'ON'` no queden guardados pareciendo encendidos.
  [SettingKey.GRADING_HOOK_ENABLED]: (v) =>
    typeof v === 'string' && FEATURE_FLAG_VALUES.includes(v) ? null : `must be one of ${FEATURE_FLAG_VALUES.join('|')}`,
  [SettingKey.INE_RETENTION_DAYS]: (v) => (isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (days)'),
  // ===== v1.51 (M-46, §4.39l) — los DIEZ diales del ciclo de adquisición =====
  // ⚠️ Estos validadores son POR DIAL. La relación ENTRE tres de ellos (`tarifa + piso <= mínimo`) NO
  // se puede expresar aquí —un validador por clave solo ve su propio valor— y por eso vive en
  // `SettingsService.update`, que es el único punto que conoce el ESTADO RESULTANTE. Ver
  // `validateBuylistCrossDials`.
  [SettingKey.BUYLIST_OFFER_ACCEPT_DEADLINE_BUSINESS_DAYS]: validatePositiveIntDial('business days'),
  [SettingKey.BUYLIST_SHIP_DEADLINE_BUSINESS_DAYS]: validatePositiveIntDial('business days'),
  // Dial 3: `>= 0` (un mínimo de 0 significa «sin mínimo», que es una política legítima). Su cota
  // superior efectiva la impone la validación CRUZADA, no este validador.
  [SettingKey.BUYLIST_MINIMUM_REQUEST_CENTS]: (v) =>
    isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (cents)',
  [SettingKey.BUYLIST_OFFER_ISSUE_DEADLINE_BUSINESS_DAYS]: validatePositiveIntDial('business days'),
  [SettingKey.BUYLIST_OPERATOR_OFFER_CAP_CENTS]: (v) =>
    isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (cents)',
  [SettingKey.BUYLIST_VARIANT_POSITION_CAP]: validatePositiveIntDial('pieces'),
  [SettingKey.BUYLIST_SHIPPING_FEE_CENTS]: (v) =>
    isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (cents)',
  [SettingKey.BUYLIST_SHIPMENT_CONFIRM_ALERT_BUSINESS_DAYS]: validatePositiveIntDial('business days'),
  // ⚠️ Dial 9: `>= 1`. El `0` NO es legal — ver el docblock del validador.
  [SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS]: validateBuylistMinimumOfferNetCents,
  [SettingKey.BUYLIST_OFFER_REISSUE_ALERT_COUNT]: validatePositiveIntDial('cancellations'),
  // ⚠️ B-4 — interruptor del paso 6 (NO es el dial 11). `on|off` estricto, por el mismo motivo que
  // `grading_hook_enabled`: que un `true` o un `'ON'` no queden guardados **pareciendo encendidos**
  // en la fila que decide si se mandan correos terminales a vendedores reales.
  [SettingKey.BUYLIST_NO_OFFER_EXPIRY_ENABLED]: (v) =>
    typeof v === 'string' && FEATURE_FLAG_VALUES.includes(v) ? null : `must be one of ${FEATURE_FLAG_VALUES.join('|')}`,
  // Fecha `yyyy/MM/dd` (formato pokemontcg.io) para la frontera del sync de catálogo.
  [SettingKey.CATALOG_SYNC_FROM_DATE]: (v) =>
    typeof v === 'string' && /^\d{4}\/\d{2}\/\d{2}$/.test(v) ? null : 'must be a date string yyyy/MM/dd',
};

/** Mapea las keys de DB a los nombres camelCase del DTO de M10 (API_CONTRACT §M10). */
export const SETTING_DTO_MAP: Record<string, SettingKeyType> = {
  shippingFeeCents: SettingKey.SHIPPING_FEE_CENTS,
  aportacionPct: SettingKey.APORTACION_PCT,
  ivaPct: SettingKey.IVA_PCT,
  salesMarkupPct: SettingKey.SALES_MARKUP_PCT,
  stripeFeePct: SettingKey.STRIPE_FEE_PCT,
  stripeFeeFixedCents: SettingKey.STRIPE_FEE_FIXED_CENTS,
  // v1.40 (Enmienda A, P-37): `stripeFeeIvaPct` se RETIRA del DTO de §M10. Ya no se expone en GET ni
  // se acepta en PUT (una key `stripeFeeIvaPct` en el body cae en 422 como cualquier key desconocida).
  buylistCapPerRequestCents: SettingKey.BUYLIST_CAP_PER_REQUEST_CENTS,
  buylistCapPerMonthCents: SettingKey.BUYLIST_CAP_PER_MONTH_CENTS,
  ineThresholdCents: SettingKey.INE_THRESHOLD_CENTS,
  repoCapPerCardCents: SettingKey.REPO_CAP_PER_CARD_CENTS,
  fxBufferPct: SettingKey.FX_BUFFER_PCT,
  fxManualOverrideRate: SettingKey.FX_MANUAL_OVERRIDE_RATE,
  pricingProviderRaw: SettingKey.PRICING_PROVIDER_RAW,
  pricingProviderGraded: SettingKey.PRICING_PROVIDER_GRADED,
  pricingProviderSealed: SettingKey.PRICING_PROVIDER_SEALED,
  // v1.14-price-ingest (WS-A, §M10): dial del proveedor de la ingesta masiva de precios.
  priceProvider: SettingKey.PRICE_PROVIDER,
  // v1.19-sealed-tcgcsv (§M10): dial fail-closed de la referencia de mercado del SELLADO.
  sealedPriceSource: SettingKey.SEALED_PRICE_SOURCE,
  // v1.23-sealed-sales (§M10): feature flags del sellado. Los SPREADS (sealed_spread_*) NO se
  // exponen aquí ni se editan por PUT /admin/settings: solo por GET/PUT /admin/pricing/sealed-spreads.
  sealedValueTrend: SettingKey.SEALED_VALUE_TREND,
  sealedRestockAlerts: SettingKey.SEALED_RESTOCK_ALERTS,
  // v1.51 (M-46, §M10, §4.38r): EL dial del gancho de grading — uno solo, gobierna exhibición Y
  // obtención (seed `off`). El RESTO de la config del gancho (escalones, minUpsidePct, frescura,
  // grados) NO se expone aquí: vive en los endpoints M2 dedicados GET/PUT
  // /admin/pricing/graded-estimates (como los spreads del sellado).
  //
  // ⛔ `gradedEstimatesEnabled` y `gradedEstimateIngestEnabled` quedan RETIRADAS de este mapa, y con
  // eso del `GET` y del `PUT`: `update()` valida contra esta lista blanca con `hasOwnProperty`, así
  // que enviarlas cae en `422 VALIDATION_ERROR` («unknown setting key») — mismo precedente que
  // `stripeFeeIvaPct` desde v1.40. No hace falta código de rechazo: hace falta NO estar aquí.
  gradingHookEnabled: SettingKey.GRADING_HOOK_ENABLED,
  // v1.1: frontera por defecto del sync de catálogo M2 (API_CONTRACT §M10).
  // ConfigSetting de primera clase: legible por GET y editable por PUT (validador yyyy/MM/dd).
  catalogSyncFromDate: SettingKey.CATALOG_SYNC_FROM_DATE,
  // v1.51 (M-46, §M10): los DIEZ diales del ciclo de adquisición del buylist. Se exponen en el GET y
  // se editan por este PUT (mismo patrón que el resto de `ConfigSetting`): sin redeploy y auditados.
  // ⚠️ NO se expone ninguno de los DOS retirados (`buylistShippingThresholdCents` de D31 y el
  // «recorte material» de D28): no existen, y buscarlos en M10 debe dar NADA.
  buylistOfferAcceptDeadlineBusinessDays: SettingKey.BUYLIST_OFFER_ACCEPT_DEADLINE_BUSINESS_DAYS,
  buylistShipDeadlineBusinessDays: SettingKey.BUYLIST_SHIP_DEADLINE_BUSINESS_DAYS,
  buylistMinimumRequestCents: SettingKey.BUYLIST_MINIMUM_REQUEST_CENTS,
  buylistOfferIssueDeadlineBusinessDays: SettingKey.BUYLIST_OFFER_ISSUE_DEADLINE_BUSINESS_DAYS,
  buylistOperatorOfferCapCents: SettingKey.BUYLIST_OPERATOR_OFFER_CAP_CENTS,
  buylistVariantPositionCap: SettingKey.BUYLIST_VARIANT_POSITION_CAP,
  buylistShippingFeeCents: SettingKey.BUYLIST_SHIPPING_FEE_CENTS,
  buylistShipmentConfirmAlertBusinessDays: SettingKey.BUYLIST_SHIPMENT_CONFIRM_ALERT_BUSINESS_DAYS,
  buylistMinimumOfferNetCents: SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS,
  buylistOfferReissueAlertCount: SettingKey.BUYLIST_OFFER_REISSUE_ALERT_COUNT,
};
