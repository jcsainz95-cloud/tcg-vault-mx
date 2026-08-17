import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Genera el siguiente folio legible `INV-000123` usando la secuencia Postgres. */
  async nextFolio(): Promise<string> {
    const rows = await this.$queryRawUnsafe<{ nextval: bigint }[]>(
      "SELECT nextval('inventory_folio_seq') AS nextval",
    );
    const n = Number(rows[0].nextval);
    return `INV-${String(n).padStart(6, '0')}`;
  }

  /**
   * v1.16-master-set (§4.17b) — reserva `n` folios CONSECUTIVOS en UNA sola llamada
   * (`SELECT nextval(...) FROM generate_series(1,n)`), en vez de N round-trips a `nextFolio()`.
   * Lo usa el alta por LOTE (`POST /admin/inventory/items/batch`) y el atajo `qty`. `n<=0` → [].
   */
  async nextFolios(n: number): Promise<string[]> {
    if (n <= 0) return [];
    const rows = await this.$queryRawUnsafe<{ nextval: bigint }[]>(
      "SELECT nextval('inventory_folio_seq') AS nextval FROM generate_series(1, $1)",
      n,
    );
    return rows.map((r) => `INV-${String(Number(r.nextval)).padStart(6, '0')}`);
  }
}
