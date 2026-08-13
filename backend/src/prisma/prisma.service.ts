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
}
