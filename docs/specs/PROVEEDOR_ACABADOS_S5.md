# Proveedor de precio y acabados holo / reverse holo — medición en vivo (brazo-red, sesión 5)

**Medido:** 2026-10-04, 02:55–03:05 UTC, desde el entorno «Internet Access» (rama `claude/brazo-red-s5`,
árbol en `cea15ba`). Sin tocar código, base de datos ni producción. Ninguna clave usada (no hay ninguna en
el entorno: `env | grep -i 'POKEMON\|PPT\|TCG'` vacío).

**Pregunta:** el dueño afirma (HECHOS 2026-10-04 «Precios — decisiones») que *«el proveedor sí nos trae
precios de holo y reverse holo»*. Una nota previa decía lo contrario.

## Conclusión corta

1. **TCGCSV (`tcgcsv_singles`) SÍ trae el precio por acabado, reverse holo incluido**, para las cuatro
   cartas de la cola: una fila por `subTypeName` (`Normal` / `Holofoil` / `Reverse Holofoil`) con
   `marketPrice` propio. **El dueño tiene razón** respecto a este proveedor.
2. **El código lo lee y lo guarda.** El ingest `tcgcsv_singles` mapea `"Reverse Holofoil"` → `reverse_holo`
   y escribe una `PriceReference` por acabado. En el código no se pierde (ver §3).
3. **pokemontcg.io NO trae ningún precio** para estos sets (Chaos Rising `me4`, Perfect Order `me3`):
   `tcgplayer` llega **sin** `prices` y `cardmarket` es `null` en las 122 cartas de `me4`. Con el dial en
   `pokemontcg_io` no se escribiría nada para estas cartas, ni normal ni reverse.
4. **PokemonPriceTracker (PPT)** pide clave (`401 Authorization header missing`) → **NO MEDIDO en vivo**.
   El código documenta (pokemonpricetracker-bulk.provider.ts:50-56) que su API v2 da UN solo `market` (el de
   la impresión primaria). **De ahí viene la nota «solo se escribe la impresión primaria»**
   (`PENDIENTES.md:755`): habla de **PPT**, no de pokemontcg.io ni de TCGCSV. En el código actual
   (`pokemontcg-io-bulk.provider.ts:78-81`), pokemontcg.io sí recorre todas las llaves de
   `tcgplayer.prices`. Hoy simplemente no las tiene para estos sets.
5. El seed del dial `price_provider` es hoy **`tcgcsv_singles`** (`settings.constants.ts:345`). La nota de
   `PENDIENTES.md:752` (seed `pokemontcg_io` en `:307`) está **desactualizada**. **El valor vigente en
   producción NO SE MIDIÓ** (vive en `ConfigSetting`, que el seed no pisa).

## 1. Proveedores de precio de singles en el repo

| Dial `price_provider` | Clase | Endpoint | Forma del acabado |
|---|---|---|---|
| `tcgcsv_singles` (seed, `settings.constants.ts:345`) | `TcgcsvSinglesBulkProvider` | `https://tcgcsv.com/tcgplayer/3/{groupId}/products` y `/prices` (`tcgcsv-http.client.ts:26`) | una fila por `productId` + `subTypeName`, con `low/mid/high/market/directLowPrice` |
| `pokemontcg_io` (rollback) | `PokemonTcgIoBulkProvider` (+ `PokemonTcgIoProvider`, el fresco por carta) | `https://api.pokemontcg.io/v2/cards?q=set.id:X` / `/v2/cards/{id}` | `tcgplayer.prices.{normal,holofoil,reverseHolofoil,1stEditionHolofoil}.market` |
| `pokemonpricetracker` | `PokemonPriceTrackerBulkProvider` vía `PptApiClient` | `https://www.pokemonpricetracker.com/api/v2/cards` (Bearer) | `prices.{market, primaryPrinting}`: un market por carta |

Enum del dial: `PRICE_PROVIDER_VALUES` (`settings.constants.ts:511`). Selección: `providerFor()`
(`price-ingest.service.ts:394-412`).

## 2. Respuestas en vivo (recortadas)

### TCGCSV — `last-updated.txt` = `2026-10-03T20:05:38+0000`

Grupos: `24655 ME04: Chaos Rising` (modifiedOn 2026-10-02T22:59:52), `24587 ME03: Perfect Order`
(modifiedOn 2026-10-01T19:23:33). Sub-tipos presentes en ambos grupos: `Holofoil`, `Normal`, `Reverse Holofoil`.
Chaos Rising: 150 productos y 224 filas de precio. Perfect Order: 156 productos y 232 filas.

| Carta | productId | subTypeName | low | mid | market | (USD) |
|---|---|---|---|---|---|---|
| Great Haul Net 078/086 (Chaos Rising) | 693499 | Normal | 0.01 | 0.17 | **0.13** | |
| | | **Reverse Holofoil** | 0.01 | 0.25 | **0.21** | |
| Chesnaught 007/086 (Chaos Rising) | 693460 | Holofoil | 0.01 | 0.20 | **0.19** | |
| | | **Reverse Holofoil** | 0.01 | 0.25 | **0.27** | |
| Beedrill ex 003/086 (Chaos Rising) | 693453 | **Holofoil** | 0.10 | 0.75 | **0.52** | |
| Lapras ex 022/088 (Perfect Order) | 684329 | **Holofoil** | 0.18 | 0.73 | **0.56** | |

(La fila de precio de TCGCSV no trae fecha propia. La frescura es la de `last-updated.txt` y la del
`modifiedOn` del grupo.)

### pokemontcg.io (sin clave; varios 500/502 transitorios, resueltos al reintentar)

```
me4-78  Great Haul Net 78 Chaos Rising  tcgplayer={"url": ".../tcgplayer/me4-78"}   cardmarket=null
me4-7   Chesnaught 7     Chaos Rising  tcgplayer={"url": ".../tcgplayer/me4-7"}    cardmarket=null
me4-3   Beedrill ex 3    Chaos Rising  tcgplayer={"url": ".../tcgplayer/me4-3"}    cardmarket=null
me3-22  Lapras ex 22     Perfect Order tcgplayer={"url": ".../tcgplayer/me3-22"}   cardmarket=null
set.id:me4 → 122 cartas, 0 con tcgplayer.prices, 0 con cardmarket
```
Control (el API sí da precios de otros sets): `sv7-32 Lapras ex` →
`tcgplayer.updatedAt 2026/10/03, prices.holofoil {low 0.8, mid 1.85, market 1.8}`.

### PokemonPriceTracker

`GET /api/v2/cards?search=Chesnaught` sin clave → `HTTP 401 {"error":"Authorization header missing…"}`.

## 3. Cruce con el código: ¿se lee y se guarda el reverse holo?

Camino `tcgcsv_singles`, de punta a punta:

1. Mapeo de acabados: `pricing.types.ts:431-436` `TCGCSV_SUBTYPE_TO_FINISH`
   (`reverseholofoil → 'reverse_holo'`, `holofoil → 'holofoil'`, `normal → 'normal'`). La normalización
   `tcgcsvSubTypeToFinish` (`:442-446`) quita lo no alfanumérico, así que `"Reverse Holofoil"` →
   `reverseholofoil` → `reverse_holo`. ✅
2. `deriveCardProductsFromTcgcsv` (`tcgcsv-singles.provider.ts:173-186`): un `pricesByFinish` por producto,
   cada acabado con SU `marketPrice`. ✅
3. `TcgcsvSinglesBulkProvider.fetchPricesForSet` (`tcgcsv-singles-bulk.provider.ts:111-183`): por acabado
   emite un `BulkPriceRow` con `finish` y `marketCents`. **Omite** la fila si (a) el `productId` no tiene
   `CardProduct` local (`:131-136`, «estructura no resuelta»), (b) `market` es nulo o ≤0, (c) no es finito
   o supera la cota de cordura.
4. `PriceIngestService.ingestSinglesForSet` (`price-ingest.service.ts:629-631`, `:800-831`):
   `persistMarketReference(cardId, finish, {source:'tcgcsv_singles'}, fx, cardProductId)` para cada fila. ✅

**Dónde se puede perder (en código, no en el proveedor):**
- **Dial ≠ `tcgcsv_singles`.** Con `pokemontcg_io` no llega nada para estos sets (§2). Con
  `pokemonpricetracker` solo llega la impresión primaria (según el código; NO MEDIDO en vivo).
- **Falta el `CardProduct` local** de esa carta (`tcgcsv-singles-bulk.provider.ts:131-136`). La fila se
  omite hasta que alguien corra «Variantes + precios» / `--force` del set (ver `PENDIENTES.md`,
  diagnóstico del 2026-09-10).
- **Override manual** previo en esa clave, que gana en lectura (según `PENDIENTES.md` 2026-09-10; no
  re-medido aquí).

## 4. NO MEDIDO

- **Valor vigente del dial `price_provider` en producción.** Lo cierra: `GET /admin/settings` (super_admin)
  o `SELECT value FROM "ConfigSetting" WHERE key='price_provider'`.
- **Si existen en la base de producción los `CardProduct` de 693499 / 693460 / 693453 / 684329** y qué
  `PriceReference` (fuente y fecha) tienen hoy. Lo cierra: `GET /admin/pricing/card/:cardId` por cada carta,
  o una consulta de solo lectura a `CardProduct` por `tcgplayerProductId`.
- **PPT en vivo** (no hay clave en este entorno).
- **Si el resolver de grupo empareja** Chaos Rising → 24655 y Perfect Order → 24587 en la base real
  (`tcgcsv-singles-bulk.provider.ts` `resolveGroup`, match por `pptSetId` o por nombre).
- Lectura y precedencia en la tienda (`pricing.service.ts:904`, «tcgcsv_singles gana»): citado de
  `PENDIENTES.md`, no re-leído en este pase.
