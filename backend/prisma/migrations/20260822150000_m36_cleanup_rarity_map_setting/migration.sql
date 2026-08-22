-- M-36 (fix/variant-composition-regression) — LIMPIEZA de datos: borra las filas `ConfigSetting`
-- con key='rarity_map' que quedaron INERTES tras retirar el setting `RARITY_MAP`.
--
-- CONTEXTO: `rarity_map` era la tabla vieja de precio de buylist por rareza. Fue reemplazada por
-- `buylist_price_rules` (v1.3.1, §E.1) y su ruta de lectura ya NO existe en el código
-- (buylist.service.ts la marca deprecada; SettingKey ya no la declara). La(s) fila(s) en BD siguen
-- ahí como config MUERTA: nadie las lee, pero ensucian el `ConfigSetting` y confunden auditorías.
--
-- ADITIVA / SEGURA: SOLO borra datos muertos de configuración. NO toca el schema (ninguna tabla,
-- columna, índice ni enum), NO toca dinero, precios, órdenes ni inventario. Segura con la app
-- corriendo: el código vigente no lee esta key, así que su ausencia no cambia comportamiento.
--
-- IDEMPOTENTE: un DELETE por `key` no falla si no hay filas (afecta 0 renglones). Re-ejecutable sin
-- efecto. En una BD greenfield (donde nunca se sembró `rarity_map`) es un no-op.
--
-- ROLLBACK (documentado): NO se restaura. Era config MUERTA sin lectura viva; recrearla no tendría
-- consumidor. Si por algún motivo se necesitara reintroducir una tabla de rareza→precio, se usa el
-- setting vigente `buylist_price_rules` (GET/PUT /admin/pricing/buylist-rules), no esta key.

DELETE FROM "ConfigSetting" WHERE "key" = 'rarity_map';
