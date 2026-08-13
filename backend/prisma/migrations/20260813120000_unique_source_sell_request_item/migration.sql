-- SEC-A3: cierra la doble conversión (convert-to-inventory) por carrera.
-- Antes: `InventoryItem.sourceSellRequestItemId` no era único, por lo que dos
-- conversiones concurrentes del mismo SellRequestItem podían crear dos InventoryItem
-- (inventario fantasma + doble costo → corrompe P&L). Con el índice único, la segunda
-- conversión colisiona (P2002) y la app la trata como "ya convertido".
--
-- Nota: si existieran duplicados previos, este índice fallaría al crearse; en tal caso
-- deben deduplicarse antes. En una base limpia (greenfield) no aplica.
CREATE UNIQUE INDEX "InventoryItem_sourceSellRequestItemId_key" ON "InventoryItem"("sourceSellRequestItemId");
