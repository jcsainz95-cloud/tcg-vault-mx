/**
 * 💰 P-DB-LIMPIEZA · E — comando de un solo uso `limpieza:republicar` (docs/specs/LIMPIEZA_DB.md §4.5). Propiedad: backend.
 *
 *   node dist/cli/limpieza-republicar.js            ⇒ SIMULACRO (no escribe; dice qué haría con cada pieza)
 *   node dist/cli/limpieza-republicar.js --apply    ⇒ publica con el pipeline de la app
 *   (en una copia del repo con dependencias: `npm run limpieza:republicar [-- --apply]`)
 *
 * Usa la base de `DATABASE_URL`. Se corre DESPUÉS de los ficheros 2 (COMMIT), 3 y 4. Código de salida: 0 bien;
 * 2 hay piezas «SIN RESOLVER» (ni a la venta ni en una cola); 1 error (p. ej. no hay rastro de limpieza).
 *
 * Arranca un contexto Nest MÍNIMO (sin HTTP y sin `JobsModule`): ni el planificador de BullMQ ni ningún job corren
 * mientras dura el comando. La lógica vive en `modules/inventory/limpieza-republicar.ts`.
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

export async function main(argv: string[]): Promise<number> {
  const unknown = argv.filter((a) => a !== '--apply');
  if (unknown.length > 0) {
    console.error(`Argumento desconocido: ${unknown.join(' ')}. Uso: limpieza-republicar [--apply]`);
    return 1;
  }
  const apply = argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(LimpiezaRepublicarModule, { logger: ['error', 'warn'] });
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
