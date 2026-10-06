/**
 * 💰 P-DB-LIMPIEZA · E — comando de un solo uso `limpieza:republicar` (docs/specs/LIMPIEZA_DB.md §4.5). Propiedad: backend.
 *
 *   node dist/cli/limpieza-republicar.js            ⇒ SIMULACRO (no escribe; dice qué haría con cada pieza)
 *   node dist/cli/limpieza-republicar.js --apply    ⇒ publica con el pipeline de la app
 *   (en una copia del repo con dependencias: `npm run limpieza:republicar [-- --apply]`)
 *
 * Usa la base de `DATABASE_URL`; si es `*.railway.internal` y existe `DATABASE_PUBLIC_URL`, usa la pública (mismo salto
 * que `scripts/geo/import-sepomex.ts` `resolveDatabaseUrl`), para que `railway run … node dist/cli/limpieza-republicar.js`
 * funcione desde fuera de Railway. Se corre DESPUÉS de los ficheros 2 (COMMIT), 3 y 4. Código de salida: 0 bien;
 * 2 hay piezas «SIN RESOLVER» (ni a la venta ni en una cola); 1 error (p. ej. no hay rastro de limpieza).
 *
 * Arranca un contexto Nest MÍNIMO (sin HTTP y sin `JobsModule`): ni el planificador de BullMQ ni ningún job corren
 * mientras dura el comando. Con el logger de Nest APAGADO: los avisos de arranque de otros módulos (p. ej.
 * `NO_OWNER_ACCOUNT` de `SpendWatchService`) no son de este comando y el dueño los leería como fallo; lo único que
 * imprime es el reporte, y los errores propios por `console.error`. La lógica vive en `modules/inventory/limpieza-republicar.ts`.
 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../modules/audit/audit.module';
import { SettingsModule } from '../modules/settings/settings.module';
import { InventoryModule } from '../modules/inventory/inventory.module';
import { InventoryService } from '../modules/inventory/inventory.service';
import { formatRepublicar, republicarPiezasRestauradas } from '../modules/inventory/limpieza-republicar';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuditModule, SettingsModule, InventoryModule],
})
export class LimpiezaRepublicarModule {}

/**
 * Qué base usar. Fuera de Railway la red interna no se alcanza: con `DATABASE_URL` interna y `DATABASE_PUBLIC_URL`
 * presente, la pública. Lanza si no hay URL utilizable. Pura (probada sin red en `test/limpieza-republicar.cli.spec.ts`).
 */
export function resolveRepublicarDatabaseUrl(env: NodeJS.ProcessEnv): { url: string; viaPublica: boolean } {
  const url = env.DATABASE_URL ?? '';
  if (!url) throw new Error('Falta DATABASE_URL (la base en la que se corrió la limpieza). No se escribió nada.');
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('DATABASE_URL no es una URL válida. No se escribió nada.');
  }
  if (host.endsWith('.railway.internal')) {
    if (!env.DATABASE_PUBLIC_URL) {
      throw new Error(
        'DATABASE_URL es la red INTERNA de Railway (*.railway.internal), que no se alcanza desde fuera, y no hay DATABASE_PUBLIC_URL. ' +
          'Pon en DATABASE_URL la URL PÚBLICA de Postgres (Railway → Postgres → Connect). No se escribió nada.',
      );
    }
    return { url: env.DATABASE_PUBLIC_URL, viaPublica: true };
  }
  return { url, viaPublica: false };
}

export async function main(argv: string[]): Promise<number> {
  const unknown = argv.filter((a) => a !== '--apply');
  if (unknown.length > 0) {
    console.error(`Argumento desconocido: ${unknown.join(' ')}. Uso: limpieza-republicar [--apply]`);
    return 1;
  }
  const apply = argv.includes('--apply');
  let db: { url: string; viaPublica: boolean };
  try {
    db = resolveRepublicarDatabaseUrl(process.env);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  // PrismaService lee DATABASE_URL al construirse: se fija ANTES de crear el contexto.
  process.env.DATABASE_URL = db.url;
  if (db.viaPublica) console.log('(DATABASE_URL era la red interna de Railway: uso DATABASE_PUBLIC_URL)');
  const app = await NestFactory.createApplicationContext(LimpiezaRepublicarModule, { logger: false });
  try {
    const r = await republicarPiezasRestauradas({ prisma: app.get(PrismaService), inventory: app.get(InventoryService) }, { apply });
    console.log(formatRepublicar(r));
    return r.resumen.sinResolver > 0 ? 2 : 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    },
  );
}
