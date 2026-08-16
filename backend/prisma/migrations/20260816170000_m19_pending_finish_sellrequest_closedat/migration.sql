-- M-19 (v1.8-ronda-c): dos columnas aditivas con default seguro. Sin enums nuevos, sin backfill.
-- API_CONTRACT changelog v1.8-ronda-c / ARCHITECTURE §11 (M-19). SEC-A1 intacto.

-- PendingPriceEntry.finish: la cola de precio pendiente pasa a ser POR ACABADO. `normal` y
-- `holofoil` de la misma carta sin precio son entradas SEPARADAS; resolver el override de un
-- acabado ya NO cierra las de los demás. Default seguro `normal` para filas legacy.
ALTER TABLE "PendingPriceEntry" ADD COLUMN "finish" "Finish" NOT NULL DEFAULT 'normal';

-- SellRequest.closedAt (SEC-D2): fecha del cierre REAL (terminal: pagada/rechazada/abandonada).
-- Ancla la retención de INE al cierre efectivo. Nullable: las filas legacy caen al fallback por
-- timestamps de estado en ine-retention.service. Campo interno de cumplimiento (no en DTOs de cliente).
ALTER TABLE "SellRequest" ADD COLUMN "closedAt" TIMESTAMP(3);
