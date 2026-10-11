/**
 * # Re-evaluación del REZAGO sin cajón — Errata SU-1 (API_CONTRACT §M1-SU, SU.3; ARCHITECTURE §4.65)
 *
 * ```bash
 * cd backend && npx ts-node scripts/reevaluate-unlocated.ts            # NO escribe: solo cuenta
 * cd backend && npx ts-node scripts/reevaluate-unlocated.ts --apply    # publica lo publicable
 * ```
 *
 * **Por qué existe.** Con la regla vieja («ubicación + precio ⇒ publicada») una pieza de plataforma `in_stock` SIN
 * cajón y CON precio se quedaba en la cola por falta de ubicación. SU-1 quita ese requisito, pero **ningún
 * disparador corre sobre esas piezas al desplegar**: pasarían a `missing = []` ⇒ fuera de la cola y fuera de la venta
 * — inventario pagado e invisible (fase 8, criterio 125). Este script es el barrido único que las recoge.
 *
 * **Selección:** `ownerType='platform' ∧ status='in_stock' ∧ locationId IS NULL`.
 * **Cuerpo:** `InventoryService.reevaluateForPublication(ids)` — el MISMO de los disparadores (⛔ sin copia del
 * pipeline). Con precio ⇒ `published`; sin precio ⇒ escala a M2 y se queda en la cola con `["price"]`; guardas ⇒
 * `not_publishable`.
 *
 * - **Sin `--apply` (por defecto) NO ESCRIBE NADA.** Cuenta `selected`, `wouldPublish`, `pricePending`,
 *   `notPublishable` con `previewPublication` (lectura pura: ni `claimListed` ni la cola de M2).
 * - **Con `--apply`** corre el cuerpo y cuenta por `outcome`. **Idempotente:** lo publicado sale de la selección
 *   (`listed`), así que una segunda corrida da `published: 0`.
 *
 * **Base:** `DATABASE_URL`, o `DATABASE_PUBLIC_URL` si `DATABASE_URL` es `*.railway.internal` (se lanza desde fuera
 * de Railway, `railway run`) — el mismo salto que `scripts/geo/import-sepomex.ts`. ⛔ La URL NUNCA se imprime.
 * **Contexto Nest SIN HTTP** y con un módulo MÍNIMO (no `AppModule`): ni el planificador de jobs ni los workers de
 * BullMQ arrancan dentro de un script que corre contra producción.
 *
 * Salida: una línea JSON con las cuentas. Código: 0 bien · 1 error · 64 uso.
 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditModule } from '../src/modules/audit/audit.module';
import { CryptoModule } from '../src/common/crypto/crypto.module';
import { SettingsModule } from '../src/modules/settings/settings.module';
import { InventoryModule } from '../src/modules/inventory/inventory.module';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import type { PublishReevaluationOutcome } from '../src/modules/inventory/inventory-publish.port';

export class ReevaluateUnlocatedAbort extends Error {}

/** Mismo salto que `scripts/geo/import-sepomex.ts` `resolveDatabaseUrl`. ⛔ El llamador no imprime `url`. */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv): { url: string; label: string } {
  let url = env.DATABASE_URL ?? '';
  if (!url) throw new ReevaluateUnlocatedAbort('falta DATABASE_URL');
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    throw new ReevaluateUnlocatedAbort('DATABASE_URL no parsea');
  }
  if (host.endsWith('.railway.internal')) {
    if (!env.DATABASE_PUBLIC_URL) {
      throw new ReevaluateUnlocatedAbort(
        'DATABASE_URL es *.railway.internal y no hay DATABASE_PUBLIC_URL (desde fuera de Railway).',
      );
    }
    url = env.DATABASE_PUBLIC_URL;
  }
  return { url, label: describeUrl(url) };
}

/** Etiqueta imprimible: local tal cual (sin credenciales); fuera de local, ni host ni puerto. */
export function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || !u.hostname.includes('.')) {
      return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
    }
    return `***.${u.hostname.split('.').slice(-2).join('.')}:***${u.pathname}`;
  } catch {
    return '«URL ilegible»';
  }
}

export interface DryRunReport {
  mode: 'dry-run';
  selected: number;
  wouldPublish: number;
  pricePending: number;
  notPublishable: number;
}

export interface ApplyReport {
  mode: 'apply';
  selected: number;
  published: number;
  pricePending: number;
  notPublishable: number;
  /** Cuenta por `outcome` crudo (incluye `already_listed`, `not_found`, `missing_location` — este último siempre 0). */
  byOutcome: Record<PublishReevaluationOutcome, number>;
}

export interface Deps {
  prisma: Pick<PrismaService, 'inventoryItem'>;
  inventory: Pick<InventoryService, 'reevaluateForPublication' | 'previewPublication'>;
}

/** El rezago: piezas de plataforma `in_stock` sin cajón. Orden estable (lo más viejo primero). */
export async function selectUnlocated(prisma: Deps['prisma']): Promise<string[]> {
  const rows = await prisma.inventoryItem.findMany({
    where: { ownerType: 'platform', status: 'in_stock', locationId: null },
    select: { id: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map((r) => r.id);
}

export async function reevaluateUnlocated(deps: Deps, opts: { apply: false }): Promise<DryRunReport>;
export async function reevaluateUnlocated(deps: Deps, opts: { apply: true }): Promise<ApplyReport>;
export async function reevaluateUnlocated(
  deps: Deps,
  opts: { apply: boolean },
): Promise<DryRunReport | ApplyReport>;
export async function reevaluateUnlocated(
  deps: Deps,
  opts: { apply: boolean },
): Promise<DryRunReport | ApplyReport> {
  const ids = await selectUnlocated(deps.prisma);
  if (!opts.apply) {
    const preview = await deps.inventory.previewPublication(ids);
    const count = (o: string) => preview.filter((p) => p.outcome === o).length;
    return {
      mode: 'dry-run',
      selected: ids.length,
      wouldPublish: count('would_publish'),
      pricePending: count('price_pending'),
      notPublishable: count('not_publishable'),
    };
  }
  const results = await deps.inventory.reevaluateForPublication(ids);
  const byOutcome: Record<PublishReevaluationOutcome, number> = {
    published: 0,
    already_listed: 0,
    missing_location: 0,
    price_pending: 0,
    not_publishable: 0,
    not_found: 0,
  };
  for (const r of results) byOutcome[r.outcome] += 1;
  return {
    mode: 'apply',
    selected: ids.length,
    published: byOutcome.published,
    pricePending: byOutcome.price_pending,
    notPublishable: byOutcome.not_publishable,
    byOutcome,
  };
}

/**
 * Lo MÍNIMO que `InventoryService` necesita (Prisma, Settings, Auditoría, Pricing vía `InventoryModule`).
 * ⛔ Sin `JobsModule`/`AppModule`: un script no programa crons ni consume colas.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    PrismaModule,
    CryptoModule,
    AuditModule,
    SettingsModule,
    InventoryModule,
  ],
})
export class ReevaluateUnlocatedModule {}

export function parseArgs(argv: string[]): { apply: boolean } {
  let apply = false;
  for (const a of argv) {
    if (a === '--apply') apply = true;
    else throw new ReevaluateUnlocatedAbort(`argumento desconocido: ${a} (uso: [--apply])`);
  }
  return { apply };
}

async function main(argv: string[]): Promise<number> {
  let opts: { apply: boolean };
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`[reevaluate-unlocated] ${(e as Error).message}\n`);
    return 64;
  }
  const { url, label } = resolveDatabaseUrl(process.env);
  // Prisma lee `DATABASE_URL` al instanciar el cliente: se fija ANTES de levantar el contexto.
  process.env.DATABASE_URL = url;
  const { NestFactory } = await import('@nestjs/core');
  const app = await NestFactory.createApplicationContext(ReevaluateUnlocatedModule, {
    logger: ['error', 'warn'],
  });
  try {
    process.stdout.write(`[reevaluate-unlocated] base ${label} · ${opts.apply ? 'APPLY (escribe)' : 'dry-run (no escribe)'}\n`);
    const report = await reevaluateUnlocated(
      { prisma: app.get(PrismaService), inventory: app.get(InventoryService) },
      opts,
    );
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return 0;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      // ⛔ Solo el mensaje: un error de conexión de Prisma puede citar el host, nunca se vuelca la URL a propósito.
      process.stderr.write(`[reevaluate-unlocated] error: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    });
}
