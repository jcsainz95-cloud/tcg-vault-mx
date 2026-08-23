/**
 * reset-db-keep-users.ts — Vacía la base "para que quede como nueva" PRESERVANDO la
 * identidad de usuario (cuentas, credenciales, KYC/CLABE/INE, direcciones, facturación,
 * tokens de verificación de correo). Diseñado como herramienta de operador, NO como parte
 * del flujo de la app.
 *
 * QUÉ BORRA
 *   - Balde OPERATIVO (siempre, con --execute): inventario + movimientos + ajustes + batches,
 *     órdenes + items + tokens de acceso, envíos + items, buylist (SellRequest + items),
 *     disputas, referencias/pendientes de precio, overrides/bounties de precio, snapshots de
 *     portafolio y de valor de set, suscripciones de restock, y el ledger de idempotencia Stripe.
 *   - Balde AUDIT (solo con --wipe-audit): AuditLog.
 *   - Balde CATÁLOGO (solo con --wipe-catalog): CardSet/Card/CardProduct/SealedProduct/
 *     SealedSetGroup/FxRate. Se repuebla con "Sincronizar", por eso por defecto se CONSERVA.
 *   - Balde UBICACIONES (solo con --wipe-locations): VaultLocation (mapa físico de la bóveda).
 *
 * QUÉ NO TOCA NUNCA
 *   - Identidad de usuario: User, KycProfile, BillingProfile, Address, AuthToken.
 *   - Config crítica: ConfigSetting (spreads/tiers/feature-flags/dinero). Borrarla romperría la
 *     plataforma y NO se repuebla por sync → jamás se incluye, ni con --wipe-catalog.
 *
 * POR QUÉ ES SEGURO PRESERVAR USUARIOS
 *   User es SIEMPRE el lado PADRE de sus relaciones. Todo lo que borramos son sus HIJOS/
 *   referrers (Order/SellRequest/Dispute/…), nunca el padre. Las FKs a User con onDelete:
 *   Restrict (Order.userId, ShipmentRequest.userId, SellRequest.userId, Dispute.userId) sólo
 *   se violarían al borrar un User; como jamás borramos User, no hay conflicto. Las FKs con
 *   Cascade a User (KycProfile/BillingProfile/Address/AuthToken/PortfolioSnapshot) tampoco se
 *   disparan porque no tocamos la fila padre.
 *
 * TRIPLE GUARDA (para no correr por accidente)
 *   (a) env CONFIRM_RESET=YES_I_HAVE_A_BACKUP  (declaras que tienes respaldo)
 *   (b) primer argumento = nombre EXACTO de la BD objetivo; se compara contra el dbname de
 *       DATABASE_URL. Si no coinciden, aborta (evita apuntar a la BD equivocada).
 *   (c) DRY-RUN por defecto: sin --execute sólo cuenta e imprime cuántas filas borraría por
 *       tabla. Sólo con --execute borra de verdad, dentro de una $transaction.
 *
 * IDEMPOTENTE: correrlo dos veces no rompe nada (deleteMany sobre tabla vacía = 0 filas).
 *
 * USO (dry-run, no borra nada):
 *   CONFIRM_RESET=YES_I_HAVE_A_BACKUP npx ts-node prisma/reset-db-keep-users.ts tcg_marketplace
 * USO (borrado real del balde operativo):
 *   CONFIRM_RESET=YES_I_HAVE_A_BACKUP npx ts-node prisma/reset-db-keep-users.ts tcg_marketplace --execute
 * Flags opcionales: --wipe-catalog  --wipe-audit  --wipe-locations
 */
import { PrismaClient } from '@prisma/client';

const CONFIRM_TOKEN = 'YES_I_HAVE_A_BACKUP';

// ============================= PLANIFICADOR PURO (testeable) =============================

// Modelos que representan la IDENTIDAD de usuario. NUNCA se borran (solo se listan para doc/aserto).
export const IDENTITY_PRESERVED = [
  'user', // cuenta, credenciales (passwordHash/googleId), rol, tokenVersion
  'kycProfile', // KYC/INE/CLABE cifrada + blind index; sin esto no se paga buylist
  'billingProfile', // RFC/datos fiscales para CFDI
  'address', // direcciones de envío
  'authToken', // verificación de correo / reset de contraseña (un solo uso)
] as const;

// Config crítica. NUNCA se borra, ni con --wipe-catalog (no se repuebla por sync).
export const CONFIG_PRESERVED = ['configSetting'] as const;

// Balde OPERATIVO en orden FK-seguro (HIJOS antes que PADRES). Se borra siempre con --execute.
export const OPERATIONAL_ORDER = [
  // --- nivel hoja: referencian a InventoryItem / Order / ShipmentRequest / SellRequest / Card ---
  'inventoryMovement', // FK itemId → InventoryItem (Cascade)
  'inventoryAdjustment', // FK inventoryItemId → InventoryItem (Cascade)
  'orderItem', // FK orderId → Order (Cascade) · FK inventoryItemId → InventoryItem (Restrict)
  'orderAccessToken', // FK orderId → Order (Cascade)
  'shipmentItem', // FK shipmentRequestId → ShipmentRequest (Cascade) · FK inventoryItemId (Restrict)
  'sellRequestItem', // FK sellRequestId → SellRequest (Cascade) · FK cardId → Card (Restrict)
  'dispute', // FK inventoryItemId (Restrict) · FK userId → User (Restrict, no lo tocamos)
  'portfolioSnapshot', // FK userId → User (Cascade, no lo tocamos)
  'setValueSnapshot', // FK setId → CardSet (Cascade)
  'sealedRestockSubscription', // FK cardId → Card (Restrict) · FK userId → User (SetNull)
  'priceReference', // FK cardId → Card (Restrict) · FK cardProductId → CardProduct (SetNull)
  'pendingPriceEntry', // FK cardId → Card (Restrict) · FK sealedProductId → SealedProduct (SetNull)
  'variantPriceOverride', // FK cardId → Card (Restrict) — overrides/bounties manuales de precio
  // --- nivel intermedio: padres de lo anterior, hijos de User/Order ---
  'shipmentRequest', // FK orderId → Order (Restrict) · FK userId → User (Restrict)
  'order', // FK userId → User (Restrict) — tras orderItem/orderAccessToken/shipmentRequest
  'sellRequest', // FK userId → User (Restrict) — tras sellRequestItem
  'inventoryItem', // tras movements/adjustments/orderItem/shipmentItem/dispute
  // --- standalone (sin FK) ---
  'inventoryBatch', // auditoría/idempotencia de altas por lote (sin FK dura)
  'processedStripeEvent', // ledger de idempotencia de webhooks Stripe (sin FK)
] as const;

// Balde AUDIT (opt-in). Sin FK dura (actorUserId es soft).
export const AUDIT_ORDER = ['auditLog'] as const;

// Balde UBICACIONES (opt-in). Mapa físico de la bóveda; config-infra, no dato de usuario.
export const LOCATION_ORDER = ['vaultLocation'] as const;

// Balde CATÁLOGO (opt-in) en orden FK-seguro. Se repuebla por "Sincronizar".
export const CATALOG_ORDER = [
  'cardProduct', // FK cardId → Card (Restrict)
  'sealedProduct', // FK setId → CardSet (Cascade); referenciada por InventoryItem/PendingPrice (ya borrados)
  'sealedSetGroup', // FK setId → CardSet (Cascade)
  'card', // FK setId → CardSet (no-action); tras cardProduct/priceReference/… borrados
  'cardSet', // padre raíz del catálogo
  'fxRate', // tipo de cambio; standalone; se repuebla por sync banxico
] as const;

export interface PlanOptions {
  wipeCatalog: boolean;
  wipeAudit: boolean;
  wipeLocations: boolean;
}

/**
 * Devuelve la lista ORDENADA de delegates Prisma a borrar (hijos antes que padres) según los
 * flags. El balde operativo va SIEMPRE primero para que borrar catálogo/ubicaciones después no
 * viole ninguna FK (todos los referrers de catálogo viven en el balde operativo).
 */
export function buildDeletionPlan(opts: PlanOptions): string[] {
  const plan: string[] = [...OPERATIONAL_ORDER];
  if (opts.wipeAudit) plan.push(...AUDIT_ORDER);
  if (opts.wipeLocations) plan.push(...LOCATION_ORDER);
  if (opts.wipeCatalog) plan.push(...CATALOG_ORDER);
  return plan;
}

/** Extrae el nombre de la BD de una URL postgres (`postgresql://…/<dbname>?params`). */
export function parseDbName(databaseUrl: string): string {
  try {
    const u = new URL(databaseUrl);
    const path = u.pathname.replace(/^\//, '').split('/')[0] ?? '';
    return decodeURIComponent(path);
  } catch {
    return '';
  }
}

export interface Cli {
  targetDb: string | null;
  execute: boolean;
  wipeCatalog: boolean;
  wipeAudit: boolean;
  wipeLocations: boolean;
}

export function parseArgs(argv: string[]): Cli {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const positionals = argv.filter((a) => !a.startsWith('--'));
  return {
    targetDb: positionals[0] ?? null,
    execute: flags.has('--execute'),
    wipeCatalog: flags.has('--wipe-catalog'),
    wipeAudit: flags.has('--wipe-audit'),
    wipeLocations: flags.has('--wipe-locations'),
  };
}

// ============================= EJECUCIÓN (efectos) =============================

interface ModelDelegate {
  count: () => Promise<number>;
  deleteMany: () => Promise<{ count: number }>;
}

function getDelegate(client: unknown, name: string): ModelDelegate {
  const delegate = (client as Record<string, ModelDelegate>)[name];
  if (!delegate || typeof delegate.count !== 'function' || typeof delegate.deleteMany !== 'function') {
    throw new Error(`Delegate Prisma desconocido: "${name}" (¿cambió el schema?).`);
  }
  return delegate;
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));

  // Guarda (a): confirmación explícita de respaldo.
  if (process.env.CONFIRM_RESET !== CONFIRM_TOKEN) {
    throw new Error(
      `Guarda (a) NO satisfecha: exporta CONFIRM_RESET=${CONFIRM_TOKEN} para confirmar que tienes respaldo.`,
    );
  }

  // Guarda (b): la BD objetivo (arg) debe coincidir con DATABASE_URL.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL no está definida en el entorno.');
  const actualDb = parseDbName(databaseUrl);
  if (!cli.targetDb) {
    throw new Error(
      'Guarda (b) NO satisfecha: pasa el nombre EXACTO de la BD objetivo como primer argumento ' +
        `(esperado: "${actualDb}").`,
    );
  }
  if (cli.targetDb !== actualDb) {
    throw new Error(
      `Guarda (b) NO satisfecha: el arg "${cli.targetDb}" no coincide con la BD de DATABASE_URL ("${actualDb}"). ` +
        'Aborto para no tocar la base equivocada.',
    );
  }

  const plan = buildDeletionPlan({
    wipeCatalog: cli.wipeCatalog,
    wipeAudit: cli.wipeAudit,
    wipeLocations: cli.wipeLocations,
  });

  log('==================================================================');
  log(`reset-db-keep-users — BD objetivo: "${actualDb}"`);
  log(`  PRESERVA identidad: ${IDENTITY_PRESERVED.join(', ')}`);
  log(`  PRESERVA config:    ${CONFIG_PRESERVED.join(', ')}`);
  log(`  Flags: execute=${cli.execute} catalog=${cli.wipeCatalog} audit=${cli.wipeAudit} locations=${cli.wipeLocations}`);
  log(`  Tablas en el plan de borrado (orden FK-seguro): ${plan.length}`);
  log('==================================================================');

  const prisma = new PrismaClient();
  try {
    // Guarda (c) — parte 1: DRY-RUN con conteos por tabla (siempre se imprime).
    log('\n[DRY-RUN] Filas que se borrarían por tabla:');
    let totalWouldDelete = 0;
    for (const name of plan) {
      const n = await getDelegate(prisma, name).count();
      totalWouldDelete += n;
      log(`  - ${name.padEnd(28)} ${n}`);
    }
    log(`  TOTAL a borrar: ${totalWouldDelete}`);

    if (!cli.execute) {
      log('\n[DRY-RUN] Nada borrado. Vuelve a correr con --execute para aplicar.');
      return;
    }

    // Guarda (c) — parte 2: borrado real dentro de una transacción (todo o nada).
    log('\n[EXECUTE] Borrando dentro de una $transaction…');
    await prisma.$transaction(
      async (tx) => {
        for (const name of plan) {
          const del = getDelegate(tx, name);
          const before = await del.count();
          const { count } = await del.deleteMany();
          const after = await del.count();
          log(`  - ${name.padEnd(28)} antes=${before} borradas=${count} después=${after}`);
        }
      },
      { timeout: 5 * 60_000, maxWait: 30_000 },
    );

    log('\n[EXECUTE] OK — balde operativo vaciado. Identidad de usuario intacta.');
  } finally {
    await prisma.$disconnect();
  }
}

// Sólo corre si se invoca directamente (importarlo en tests NO ejecuta main).
if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[reset-db-keep-users] ERROR — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
