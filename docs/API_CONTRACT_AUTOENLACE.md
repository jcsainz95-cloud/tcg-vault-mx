# API_CONTRACT_AUTOENLACE.md — enlace y precio automáticos (§AUTO-ENLACE)
Anexo de `API_CONTRACT.md` (convenciones allí). Diseño y reglas: `docs/DECISIONES.md` §AUTO-ENLACE. Solo `super_admin`. Dinero: centavos enteros.

## 1. Job diario (sin endpoint HTTP)
- `catalog-auto-link`, 05:00 en la zona del scheduler (la de `catalog-metadata-sync` 01:00; backend la confirma en `scheduler.service.ts`). Dial `auto_link_enabled` (apagado al desplegar; backend lo enciende al veredicto de qa, sin acción del dueño).
- Una corrida = una tanda: ≤ 8 sets, ≤ 600 cartas ligadas, ≤ 40 llamadas a TCGCSV (incluye reintentos y `listGroups`, 1 por corrida), ≤ 30 min. Single-flight `pg_advisory_lock` (misma llave que `price-ingest` ⇒ nunca se pisan).
- Auditoría por set `catalog.auto_link {setId, groupId, via, linked, priced, collisions, conflicts, omitted[], notLinkable, error?}` y resumen `catalog.auto_link_run {setsTried, linked, priced, remainingBefore, remainingAfter, tcgcsvCalls, durationMs, aborted?}`. `actorUserId=null`.

## 2. GET `/admin/catalog/link-exceptions`
Una sola lista (sustituye el bloque rojo + «No ligables»). 200:
```
{ summary:{ unlinkedCards:n, unlinkedSets:n, repairedYesterday:n, pricedYesterday:n, lastRunAt:iso|null, nextRunAt:iso, waitingDecision:n },
  sets:[{ setId, name, unlinked:n, total:n,
    reason:'group_ambiguous'|'group_none'|'collisions'|'name_mismatch'|'promo_route'|'wotc_pending'|'provider_failing'|'tcgcsv_source'|'not_in_provider',
    groupUsed:{ groupId, name, via:'auto'|'confirmed'|'promo_table' }|null,
    candidates:[{ groupId, name, publishedOn, productCount, score }]  /* máx. 5, mejor primero; [] si no aplica */,
    canConfirm:bool, lastAttemptAt:iso|null, nextAttemptAt:iso|null, tries:n }] }
```
Orden: con inventario a la venta/en revisión primero, luego `unlinked` desc. Solo lectura local (0 llamadas a proveedores; los `candidates` se calculan del `listGroups` cacheado ≤ 24 h). `reason ∈ {tcgcsv_source,not_in_provider}` no cuentan en `unlinkedCards` (salen aparte, sin botón). `wotc_pending` cuenta en `waitingDecision`.

## 3. POST `/admin/catalog/link-exceptions/:setId/confirm` `{ groupId:int }`
- 200 `{ setId, groupUsed:{groupId,name,via:'confirmed'}, linked:n, priced:n, collisions:n, conflicts:n, omitted:[{reason,count}], examples:[…≤20] }`. Valida que `groupId` exista en `listGroups` (no hace falta que sea candidato). Persiste `CardSet.cardGroupId=groupId`, `cardGroupVia='confirmed'`, liga y precia el set en la misma llamada. Idempotente. Auditoría `catalog.group_confirmed {setId, before, after}`.
- 404 set; 422 `GROUP_NOT_FOUND`; 429 `RATE_LIMITED` (1 por set cada 10 min); 502/retriable `UPSTREAM_ERROR` (no persiste nada).

## 4. POST `/admin/catalog/link-repair` `{ setId }` (cambio aditivo — el único botón «Actualizar este set»)
Igual que hoy (`DECISIONES` §PRECIO-SIN-ENLACE «Correcciones» a) y además, en la MISMA llamada, precia el set (B4). Respuesta suma `priced:n`, `groupUsed:{groupId,name,via}|null`, `reason` (mismo enum de §2) y `nextAttemptAt`. `POST /admin/catalog/sync` ya no se llama desde la UI de enlace/precio.

## 5. `GET /admin/catalog/sync-status` (aditivo)
`unlinkedPrice` se conserva por compatibilidad y suma `summary` idéntico al de §2. No se retira nada en esta entrega.

## 6. Schema (solo `schema.prisma`, migración aditiva; nada se borra)
`CardSet.cardGroupId Int?` (grupo TCGCSV de las CARTAS, elegido por regla o confirmado) y `CardSet.cardGroupVia String?` (`auto|confirmed`; `promo_table` se deriva de `PTCG_PROMO_GROUPS`, no se guarda). Precedencia de resolución: tabla de promos > `cardGroupVia='confirmed'` > regla automática B3 > `pptSetId` numérico (legado) > nombre. Una confirmación nunca la pisa el automático; si el grupo confirmado deja de existir en `listGroups` ⇒ `reason:'group_none'` y vuelve a la lista.
Si se elige la opción A de B1 (DECISIONES §AUTO-ENLACE, pregunta Q1): enum `Finish` suma `first_edition` (`ALTER TYPE … ADD VALUE`, migración propia ANTES del código que lo usa) y `TCGCSV_SUBTYPE_TO_FINISH` suma `1stedition→first_edition`, `unlimited→normal`, `unlimitedholofoil→holofoil`.
