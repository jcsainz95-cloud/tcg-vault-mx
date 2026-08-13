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
 * Cartas del catálogo sintético. `rarity` mapea a categoría de buylist vía el
 * RARITY_MAP por defecto (Common→comun, Reverse Holo→reverse_holo, Rare Holo/Rare
 * Secret→ex_plus). `refNmCents` es la referencia (valor de mercado) para raw:NM.
 */
export const E2E_CARDS = {
  charizard: { externalId: 'e2e-charizard', name: 'E2E Charizard', number: '4', rarity: 'Rare Holo', refNmCents: 100000 }, // ex_plus, ref 1000.00
  common: { externalId: 'e2e-common', name: 'E2E Pidgey', number: '16', rarity: 'Common', refNmCents: 5000 }, // comun
  reverse: { externalId: 'e2e-reverse', name: 'E2E Reverse Bird', number: '17', rarity: 'Reverse Holo', refNmCents: 3000 }, // reverse_holo
  graded: { externalId: 'e2e-graded', name: 'E2E Graded Star', number: '20', rarity: 'Rare Holo', refPsa10Cents: 500000 }, // graded PSA10
  highvalue: { externalId: 'e2e-highvalue', name: 'E2E High Value', number: '25', rarity: 'Rare Holo', refNmCents: 750000 }, // ex_plus, quote 0.4×=300000 = umbral INE
  nopref: { externalId: 'e2e-nopref', name: 'E2E No Price', number: '99', rarity: 'Rare Secret' }, // ex_plus SIN referencia → precio pendiente
} as const;

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
