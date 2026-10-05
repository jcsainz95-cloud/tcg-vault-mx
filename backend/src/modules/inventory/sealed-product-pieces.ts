import { Prisma } from '@prisma/client';

/**
 * 💰 v1.83 (`API_CONTRACT §M11-SP.5` `pieces` + `§M11-SP.12.7` A-1 `sealedProductPieces`) — **cuántas piezas de
 * PLATAFORMA ligadas a cada producto hay en `in_stock | listed | reserved`.**
 *
 * UNA definición y UNA consulta (`groupBy (sealedProductId, status)`) para las dos superficies: la hoja de precios
 * (`SealedPriceSheetRowDTO.pieces`) y las filas del listado / cola (`sealedProductPieces`). ⛔ Contar las filas de la
 * página sería otra definición (SP-17 lo muerde). Las vendidas, las de cliente y las terminales no cuentan: son las
 * piezas cuyo precio cambia si el dueño re-precia el producto.
 */
export interface SealedProductPieces {
  inStock: number;
  listed: number;
  reserved: number;
}

export const SEALED_PIECE_STATUSES = ['in_stock', 'listed', 'reserved'] as const;

type GroupByClient = Pick<Prisma.TransactionClient, 'inventoryItem'>;

export async function sealedProductPiecesOf(
  db: GroupByClient,
  sealedProductIds: string[],
): Promise<Map<string, SealedProductPieces>> {
  const out = new Map<string, SealedProductPieces>();
  const ids = [...new Set(sealedProductIds)];
  if (ids.length === 0) return out;
  for (const id of ids) out.set(id, { inStock: 0, listed: 0, reserved: 0 });
  const rows = await db.inventoryItem.groupBy({
    by: ['sealedProductId', 'status'],
    where: {
      sealedProductId: { in: ids },
      ownerType: 'platform',
      status: { in: [...SEALED_PIECE_STATUSES] },
    },
    _count: { _all: true },
  });
  for (const r of rows) {
    const acc = out.get(r.sealedProductId as string);
    if (!acc) continue;
    const n = r._count._all;
    if (r.status === 'in_stock') acc.inStock += n;
    else if (r.status === 'listed') acc.listed += n;
    else if (r.status === 'reserved') acc.reserved += n;
  }
  return out;
}
