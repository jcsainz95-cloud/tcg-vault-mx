/**
 * e2e-fixtures.ts — Constantes DETERMINISTAS del dataset sintético de integración/E2E.
 * Propiedad: backend. Compartido por `prisma/seed-e2e.ts` (el seed) y por las suites
 * de `test/integration/*.e2e-spec.ts` (los asserts). NADA de datos reales de clientes.
 *
 * Todos los montos son enteros en centavos MXN (*Cents), como el resto del sistema.
 */

export const E2E_USERS = {
  customer: { email: 'customer@e2e.local', password: 'Customer123!', name: 'E2E Customer', role: 'customer' as const },
  customer2: { email: 'customer2@e2e.local', password: 'Customer123!', name: 'E2E Customer Two', role: 'customer' as const },
  operator: { email: 'operator@e2e.local', password: 'Operator123!', name: 'E2E Operator', role: 'vault_operator' as const },
  admin: { email: 'admin@e2e.local', password: 'Admin123!', name: 'E2E Admin', role: 'super_admin' as const },
} as const;

export const E2E_SET = { externalId: 'e2e-base', name: 'E2E Base Set', series: 'E2E', releaseDate: '1999/01/09' } as const;

/**
 * v1.22-variantes-orden (§4.22e) — SEGUNDO set sintético, dedicado al ORDEN NATURAL del número.
 * Vive aparte de `E2E_SET` a propósito: `E2E Base Set` es la base de los flujos de dinero
 * (cotizador/checkout/bóveda) y sus 6 cartas están cableadas en asserts de varias suites; meterle
 * cartas nuevas cambiaría totales y páginas de esas pruebas. Aquí se prueba SOLO el orden:
 * `"2"` antes que `"10"` (nunca lexicográfico) y `"TG01"` AL FINAL (promo/subset con prefijo).
 */
export const E2E_ORDER_SET = {
  externalId: 'e2e-order',
  name: 'E2E Order Set',
  series: 'E2E',
  releaseDate: '2022/11/11',
  printedTotal: 20,
} as const;

/**
 * Cartas del catálogo sintético. `rarity` (crudo) se colapsa a su rareza canónica vía
 * `normalizeRarity` (catálogo canónico de rarezas) y esa canónica es la key con la que el
 * buylist elige regla en `BUYLIST_PRICE_RULES` (o cae al fallback por %). Aquí: Common→comun,
 * Reverse Holo→reverse_holo, Rare Holo/Rare Secret→ex_plus. `refNmCents` es la referencia
 * (valor de mercado) para raw:NM.
 *
 * v1.22-variantes-orden (§4.22e) — `availableFinishes` se siembra SIEMPRE de forma EXPLÍCITA:
 * depender del `@default([normal])` del schema es justo lo que hacía que el bug del PO (una sola
 * casilla por carta) no pudiera fallar en ningún E2E (defecto VAR-3, ARCHITECTURE §9). El conjunto
 * cumple el mínimo normativo: `reverse` tiene DOS variantes (['normal','reverse_holo'] → dos
 * casillas: normal a la izquierda, reverse holo a la derecha) y el resto UNA (['normal'] → una
 * casilla, jamás relleno). El orden del array es el canónico `FINISH_ORDER`.
 *
 * v1.27.1 (P-13-fix, §4.25e) — se siembran también las columnas de ENTRADA de forma COHERENTE con la
 * fórmula VIGENTE del reconciliador: `availableFinishes == composeAvailableFinishes(structuralFinishes,
 * pricedFinishesSnapshot, rarity)` (la unión VUELVE — recupera el reverse del común — y se filtra
 * `normal` solo si la rareza es premium). Cuando no se declaran, el seed usa `structuralFinishes =
 * catalogFinishes = availableFinishes` y snapshot vacío. `reverse` es el caso de DOS casillas:
 * rareza Reverse Holo (NO premium) ⇒ la unión no se filtra; TCGCSV resolvió AMBAS impresiones
 * (`structuralFinishes=['normal','reverse_holo']`) y PPT confirma el reverse con precio
 * (`pricedFinishesSnapshot=['reverse_holo']`). Su `catalogFinishes` queda en `['normal']` a propósito:
 * es la señal débil write-only que nadie lee en producción — la estructura manda. Un reconcile sobre
 * estos fixtures es un NO-OP (dato consistente); ningún total/página de las suites de dinero cambia.
 */
export const E2E_CARDS = {
  charizard: { externalId: 'e2e-charizard', name: 'E2E Charizard', number: '4', rarity: 'Rare Holo', refNmCents: 100000, availableFinishes: ['normal'] }, // ex_plus, ref 1000.00
  common: { externalId: 'e2e-common', name: 'E2E Pidgey', number: '16', rarity: 'Common', refNmCents: 5000, availableFinishes: ['normal'] }, // comun
  // DOS casillas ESTRUCTURALES (§4.25a): TCGCSV resolvió ambas; PPT confirma el reverse con precio (snapshot = observabilidad).
  reverse: { externalId: 'e2e-reverse', name: 'E2E Reverse Bird', number: '17', rarity: 'Reverse Holo', refNmCents: 3000, availableFinishes: ['normal', 'reverse_holo'], catalogFinishes: ['normal'], structuralFinishes: ['normal', 'reverse_holo'], pricedFinishesSnapshot: ['reverse_holo'] }, // reverse_holo — DOS casillas (§4.22c), sostenidas por la ESTRUCTURA
  graded: { externalId: 'e2e-graded', name: 'E2E Graded Star', number: '20', rarity: 'Rare Holo', refPsa10Cents: 500000, availableFinishes: ['normal'] }, // graded PSA10
  highvalue: { externalId: 'e2e-highvalue', name: 'E2E High Value', number: '25', rarity: 'Rare Holo', refNmCents: 1200000, availableFinishes: ['normal'] }, // Rare Holo → T2 25%; quote 0.25×1200000=300000 = umbral INE (P-34)
  nopref: { externalId: 'e2e-nopref', name: 'E2E No Price', number: '99', rarity: 'Rare Secret', availableFinishes: ['normal'] }, // ex_plus SIN referencia → precio pendiente
} as const;

/**
 * Cartas del `E2E_ORDER_SET`, declaradas a propósito en orden NO natural para que el seed no pueda
 * "acertar" por accidente. El orden ESPERADO de `GET /buylist/cards?setId=<e2e-order>` es:
 * `2` → `10` → `SV107` → `TG01`. Antes de v1.22 salía `10, 2, SV107, TG01` (Card.number es String,
 * orden lexicográfico — defecto ORD-1).
 * - `orderTwo` lleva reverse holo para que el binder de este set también pruebe las dos casillas.
 * - Hay DOS prefijos de promo (`SV` y `TG`): `SV107` y `TG01` colisionarían si el orden dependiera
 *   solo de `numberSort` con un único prefijo — los dos prefijos ejercitan la agrupación por
 *   `numberPrefix` (la razón de ser de la columna, §4.22b: `TG12` y `GG12` empatan en 1000012).
 *   `SV` < `TG` alfabéticamente, por eso `SV107` sale ANTES que `TG01` pese a su parte numérica mayor.
 */
export const E2E_ORDER_CARDS = {
  orderTen: { externalId: 'e2e-order-10', name: 'E2E Order Ten', number: '10', rarity: 'Common', availableFinishes: ['normal'] },
  orderTwo: { externalId: 'e2e-order-2', name: 'E2E Order Two', number: '2', rarity: 'Common', availableFinishes: ['normal', 'reverse_holo'] },
  orderShiny: { externalId: 'e2e-order-sv107', name: 'E2E Order Shiny Vault', number: 'SV107', rarity: 'Rare Shiny', availableFinishes: ['normal'] },
  orderPromo: { externalId: 'e2e-order-tg01', name: 'E2E Order Trainer Gallery', number: 'TG01', rarity: 'Trainer Gallery Rare Holo', availableFinishes: ['normal'] },
} as const;

/**
 * Orden natural ESPERADO de `E2E_ORDER_SET` — oráculo del test de integración
 * `test/integration/buylist-cards-order.e2e-spec.ts` (§4.22 «Tests obligatorios»): numéricos puros
 * por entero, promos AL FINAL agrupados por prefijo alfabético (`SV` antes que `TG`).
 */
export const E2E_ORDER_EXPECTED_NUMBERS = ['2', '10', 'SV107', 'TG01'] as const;

/**
 * Orden natural ESPERADO de `E2E_SET` (`GET /buylist/cards?setId=<e2e-base>`) — oráculo del test
 * de integración `buylist-cards-order.e2e-spec.ts` (orden + paginación sin huecos ni duplicados).
 */
export const E2E_SET_EXPECTED_NUMBERS = ['4', '16', '17', '20', '25', '99'] as const;

/**
 * Piezas físicas (InventoryItem) deterministas por folio. Los `E2E-LST-*` son de la
 * PLATAFORMA y vendibles; `E2E-CUS-*` están en la bóveda del `customer` para probar
 * portafolio/retiro sin depender del webhook.
 */
export const E2E_FOLIOS = {
  listedCharizard: 'E2E-LST-0001', // platform listed, sin listPrice → salePrice = ref×(1+markup)
  listedCommonOverride: 'E2E-LST-0002', // platform listed, listPrice override 60000
  listedGraded: 'E2E-LST-0003', // platform listed graded PSA10
  listedPending: 'E2E-LST-0004', // nopref → precio pendiente, sellable=false
  custSettled: 'E2E-CUS-0001', // customer, settled, in_custody (charizard) → retirable
  custPending: 'E2E-CUS-0002', // customer, pending, in_custody (common) → NO retirable
} as const;

export const E2E_LOCATIONS = {
  platform: { zone: 'platform_stock' as const, box: 'E2E', row: 'F01', slot: 'S01', label: 'E2E-F01-S01' },
  custody: { zone: 'customer_custody' as const, box: 'E2E', row: 'F01', slot: 'S01', label: 'E2E-F01-S01' },
} as const;

export const E2E_LIST_OVERRIDE_CENTS = 60000; // listPriceCents del common override

/**
 * Diales M10 que el seed FIJA (update) para que la matemática del checkout sea
 * determinista en la suite, aunque staging tenga overrides previos.
 */
export const E2E_SETTINGS = {
  iva_pct: 16,
  sales_markup_pct: 15,
  stripe_fee_pct: 0.036,
  stripe_fee_fixed_cents: 300,
  shipping_fee_cents: 17500,
  buylist_cap_per_request_cents: 300000,
  buylist_cap_per_month_cents: 1000000,
  ine_threshold_cents: 300000,
} as const;
