/**
 * # Reparo único de §RETIRO-SALIDA (DECISIONES §RETIRO-SALIDA punto 4)
 *
 * ```bash
 * cd backend && npx ts-node scripts/backfill-retiro-salida.ts --dry-run   # 0 ESCRITURAS: lista envíos, folios y piezas
 * cd backend && npx ts-node scripts/backfill-retiro-salida.ts --apply     # mueve las piezas (in_custody → withdrawn)
 * ```
 *
 * **Por qué existe.** Con la regla vieja las piezas de un retiro salían de la bóveda al ENTREGARSE. Con la nueva salen al
 * ENVIARSE (`enviado`). Los retiros que ya estaban `enviado` al desplegar conservan sus piezas `in_custody`: este script las
 * pasa a `withdrawn` con su movimiento `withdrawal` (`note='backfill RETIRO-SALIDA shipment <id>'`).
 *
 * **Selección:** envíos de RETIRO (`orderId` nulo, `kind='outbound'`) con `status='enviado'` y sin `returnedAt`; piezas con
 * `prepStatus<>'missing'`, `status='in_custody'` y del dueño del retiro (la guarda va en el `WHERE` del UPDATE).
 * Los retiros en `guia` NO se tocan (su salida llegará con la regla nueva). Los `entregado` viejos ya son `withdrawn`.
 *
 * **Idempotente:** lo movido sale de la selección (`withdrawn`); re-correr `--apply` da 0 movimientos. Una tx por envío
 * con el candado de la fila (serializa con `PATCH status`/sondeo).
 *
 * **Quién lo corre:** devops, contra producción, SOLO tras aprobar el dueño el `--dry-run` y fusionar la PR. No corre en el
 * despliegue. La URL de la base NUNCA se imprime. Salida: una línea JSON. Código: 0 bien · 1 error · 64 uso.
 */
import { PrismaClient, MovementReason } from '@prisma/client';

export interface BackfillShipmentReport {
  shipmentId: string;
  folio: string | null;
  pieces: number;
}
export interface BackfillResult {
  mode: 'dry-run' | 'apply';
  shipments: BackfillShipmentReport[];
  piecesSelected: number;
  piecesMoved: number;
}

type Db = PrismaClient;

async function eligiblePieceIds(db: Pick<Db, 'shipmentItem'>, shipmentId: string, userId: string | null): Promise<string[]> {
  if (userId === null) return [];
  const rows = await db.shipmentItem.findMany({
    where: {
      shipmentRequestId: shipmentId,
      prepStatus: { not: 'missing' },
      inventoryItem: { status: 'in_custody', ownerType: 'customer', ownerUserId: userId },
    },
    select: { inventoryItemId: true },
  });
  return rows.map((r) => r.inventoryItemId);
}

export async function runBackfill(prisma: Db, mode: 'dry-run' | 'apply'): Promise<BackfillResult> {
  const shipments = await prisma.shipmentRequest.findMany({
    where: { status: 'enviado', orderId: null, kind: 'outbound', returnedAt: null },
    select: { id: true, folio: true, userId: true },
    orderBy: { requestedAt: 'asc' },
  });
  const result: BackfillResult = { mode, shipments: [], piecesSelected: 0, piecesMoved: 0 };
  for (const s of shipments) {
    if (mode === 'dry-run') {
      const ids = await eligiblePieceIds(prisma, s.id, s.userId);
      if (ids.length === 0) continue;
      result.shipments.push({ shipmentId: s.id, folio: s.folio ?? null, pieces: ids.length });
      result.piecesSelected += ids.length;
      continue;
    }
    const moved = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ${s.id} FOR UPDATE`;
        const still = await tx.shipmentRequest.findFirst({ where: { id: s.id, status: 'enviado', orderId: null, returnedAt: null }, select: { id: true } });
        if (!still) return { selected: 0, moved: 0 };
        const ids = await eligiblePieceIds(tx, s.id, s.userId);
        let n = 0;
        for (const itemId of ids) {
          const r = await tx.inventoryItem.updateMany({
            where: { id: itemId, status: 'in_custody', ownerType: 'customer', ownerUserId: s.userId },
            data: { status: 'withdrawn' },
          });
          if (r.count !== 1) continue;
          n += 1;
          await tx.inventoryMovement.create({
            data: {
              itemId,
              fromStatus: 'in_custody',
              toStatus: 'withdrawn',
              reason: MovementReason.withdrawal,
              note: `backfill RETIRO-SALIDA shipment ${s.id}`,
            },
          });
        }
        return { selected: ids.length, moved: n };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
    if (moved.selected > 0) {
      result.shipments.push({ shipmentId: s.id, folio: s.folio ?? null, pieces: moved.moved });
      result.piecesSelected += moved.selected;
      result.piecesMoved += moved.moved;
    }
  }
  return result;
}

export function parseMode(argv: string[]): 'dry-run' | 'apply' | null {
  const dry = argv.includes('--dry-run');
  const apply = argv.includes('--apply');
  if (dry === apply) return null; // ninguno o ambos ⇒ uso
  return apply ? 'apply' : 'dry-run';
}

async function main(): Promise<number> {
  const mode = parseMode(process.argv.slice(2));
  if (!mode) {
    console.error('uso: backfill-retiro-salida.ts (--dry-run | --apply)');
    return 64;
  }
  if (!process.env.DATABASE_URL) {
    console.error('falta DATABASE_URL');
    return 1;
  }
  const prisma = new PrismaClient();
  try {
    console.log(JSON.stringify(await runBackfill(prisma, mode)));
    return 0;
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().then((c) => process.exit(c));
}
