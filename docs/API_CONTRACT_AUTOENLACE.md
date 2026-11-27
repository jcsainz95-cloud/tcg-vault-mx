# API_CONTRACT_AUTOENLACE.md — enlace y precio automáticos (§AUTO-ENLACE)
Anexo de `API_CONTRACT.md` (convenciones allí). Diseño y reglas: `docs/DECISIONES.md` §AUTO-ENLACE. Solo `super_admin`. Dinero: centavos enteros.

## 1. Job diario (sin endpoint HTTP)
- `catalog-auto-link`, 05:00 en la zona del scheduler (la de `catalog-metadata-sync` 01:00; backend la confirma en `scheduler.service.ts`). Dial `auto_link_enabled` (apagado al desplegar; backend lo enciende al veredicto de qa, sin acción del dueño).
- Una corrida = una tanda: ≤ 8 sets, ≤ 600 cartas ligadas, ≤ 40 llamadas a TCGCSV (incluye reintentos y `listGroups`, 1 por corrida), ≤ 30 min. Single-flight `pg_advisory_lock` (misma llave que `price-ingest` ⇒ nunca se pisan).
- Auditoría por set `catalog.auto_link {setId, groupId, via, linked, priced, collisions, conflicts, omitted[], notLinkable, error?}` y resumen `catalog.auto_link_run {setsTried, linked, priced, remainingBefore, remainingAfter, tcgcsvCalls, durationMs, aborted?}`. `actorUserId=null`.

## 2. GET `/admin/catalog/link-exceptions` (FASE 3; en fase 1 devuelve 404 y es normal)
En fase 1 la lista sale de `sync-status.unlinkedPrice[]` (§5): el frontend lo trata como fuente vigente y NUNCA descarta `groupUsed/reason/exceptionReason` por faltar este endpoint; promos viejas (dpp…) se pintan con `reason:'promo_route'`, jamás «sin coincidencia clara». Una sola lista (sustituye el bloque rojo + «No ligables»). 200:
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
Igual que hoy (`DECISIONES` §PRECIO-SIN-ENLACE «Correcciones» a) y además, en la MISMA llamada, precia el set (B4; reglas en §7). Respuesta suma `priced:n`, `groupUsed:{groupId,name|null,via}|null`, `reason` (mismo enum de §2) y `availableAgainAt` (antes `nextAttemptAt`; ver §7.4). `POST /admin/catalog/sync` ya no se llama desde la UI de enlace/precio.

### 4b. Botón «Actualizar este set» en la tabla general de M2 (aditivo; sin endpoint nuevo)
- `GET /admin/catalog/remote-sets`: cada fila suma `localSetId: string|null` (UUID del `CardSet` ya importado; `null` si no importado), `groupUsed:{groupId,name|null,via}|null` y `reason` (enum §2)|null. **Fase 1:** `groupUsed`/`reason` = resultado del ÚLTIMO intento en bitácora (`catalog.link_repair`) de ese set; `null` si nunca se intentó. NO se calculan del `listGroups` ni de ningún proveedor (0 llamadas). Match remoto→local por el mismo `externalId` que usa `sync`. Nunca devuelve 429 (el 429 es solo de `link-repair`, §4, y de `sync`, §7.5).
- `POST /admin/catalog/sync` `{ setId: <remoteId> }`: la respuesta suma `localSetId` (UUID creado o existente). Suma límite propio (§7.5).
- Flujo del botón (frontend, una sola acción, un solo resultado en la misma fila): (1) si `localSetId==null` ⇒ `sync` con el id remoto y se toma `localSetId` de su respuesta; si ya está importado NO se llama `sync` (las cartas nuevas del set las trae el job de metadatos; `link-repair` no importa cartas); (2) `POST /admin/catalog/link-repair {setId: localSetId}` (liga + precia, §4). Si (1) falla ⇒ se muestra el error y NO se llama (2). Resultado pintado = el de `link-repair` (`priced`, `groupUsed`, `reason`, `availableAgainAt`) más «importadas N» si hubo `sync`. `refresh-variants` deja de llamarse desde este botón. Misma fila y mismo componente de resultado que la lista de §2.
- Idempotencia/429: heredadas de `sync` y `link-repair`; el botón se deshabilita mientras corre.

## 5. `GET /admin/catalog/sync-status` (aditivo)
`unlinkedPrice` se conserva por compatibilidad y suma por set `groupUsed`, `reason`, `exceptionReason` (fase 1, ya entregado). `summary` idéntico al de §2 es **fase 2**: en fase 1 el frontend NO depende de él. No se retira nada en esta entrega.

## 7. Correcciones tras gates de fase 1 (2026-11-27; vigentes; qa B-1..I-4, seg AE-1..AE-5)
1. **B2 estricto (AE-1, I-2, I-3).** Llave de nombre = normalizar (acentos, mayúsculas, puntuación, «&»≡«and», guion≡espacio) y quitar paréntesis FINALES de variante del producto («Genesect EX (Team Plasma)» ⇒ «genesect ex» = «Genesect-EX»). B2 liga SOLO con llave IGUAL; prohibido contención, prefijo o subconjunto de palabras («Pikachu» ≠ «Pikachu VMAX»; «Charizard» ≠ «Charizard ex»). Vale en ambos sentidos: 1 local + N productos ⇒ el único con llave igual; N locales + 1 producto ⇒ la única local con llave igual (I-2: 2 locales + 1 producto liga la de llave igual). 0 o ≥ 2 con llave igual ⇒ no se liga. El producto sobrante tras B2 cuenta `no_local_card`, NO colisión (I-3). Pruebas obligatorias de no-enlace con calificador (V, VMAX, ex, GX, Mega, Dark) y la sonda Pikachu/VMAX/Bulbasaur #25 ⇒ 0 enlaces. `namesCompatible` (subconjunto) deja de usarse en B2. Gate de encendido: `auto_link_enabled` sigue APAGADO hasta cerrar esto.
2. **B4 y acabados (B-1, AE-2).** DECISIÓN: B4 solo escribe precio de acabados presentes en `CardProduct.finishes`. Si la fuente trae un acabado ausente: NO se escribe ni se reconcilia dentro de `link-repair` (dinero ante la duda); se reporta en `omitted:[{reason:'finish_not_in_product',count}]` y la carta queda con `PRICE_PENDING` en ese acabado. Reconciliar acabados queda como «Sincronizar este set» (resolver.ts:199-211), fuera de la UI de enlace; si el job de fase 2 debe hacerlo solo, se decide en su diseño. Spec B4: fila con `isManualOverride:true` ⇒ 0 upserts; caso Charizard Holofoil sobre producto `['normal']` ⇒ 0 escrituras (rojo→verde); se actualiza el spec viejo.
3. **Promos sin `listGroups` (B-2).** La ruta de promos (`PTCG_PROMO_GROUPS`) NO puede llamar `listGroups` (invariante P-PROMOS-VIEJAS). `groupUsed.name` sale de la tabla de promos (`describeGroup`) o queda `null`; `via:'promo_table'`. `promo-viejas.e2e-spec` vuelve a verde.
4. **`availableAgainAt` (I-1).** En `link-repair` el campo se llama `availableAgainAt` = «Disponible de nuevo a las HH:MM» (enfriamiento del botón, +10 min; `null` si ya disponible). NO es reintento automático. El texto «se reintenta solo» solo aparece cuando fase 2 esté encendida; `nextAttemptAt` queda reservado para `link-exceptions` (§2, job). Backend mantiene `nextAttemptAt` como alias solo si algún cliente lo lee; frontend usa `availableAgainAt`.
5. **Límite de `sync` (AE-3).** `POST /admin/catalog/sync`: 1 por `setId` (remoto) cada 10 min, también con `force:true`, mismo patrón que `link-repair` (`pg_advisory_xact_lock` + consulta a bitácora `catalog.sync`); 429 `RATE_LIMITED` con minutos restantes. Un `sync` fallido por proveedor no consume el cupo.
6. **Menores de seguridad.** AE-4: `UPSTREAM_ERROR` al cliente = mensaje fijo, detalle solo en log (y bitácora sin `e.message` crudo). AE-5: `lastLinkOutcomes` = último por set con `DISTINCT ON`/raw parametrizado (no `distinct` en memoria sobre toda la bitácora).
7. **Frontend (I-4).** Si la fila del set desaparece al refrescar (ya sin pendientes), el resultado se queda visible en la misma posición (no al pie de la lista) hasta que se cierre.

## 6. Schema (solo `schema.prisma`, migración aditiva; nada se borra)
`CardSet.cardGroupId Int?` (grupo TCGCSV de las CARTAS, elegido por regla o confirmado) y `CardSet.cardGroupVia String?` (`auto|confirmed`; `promo_table` se deriva de `PTCG_PROMO_GROUPS`, no se guarda). Precedencia de resolución: tabla de promos > `cardGroupVia='confirmed'` > regla automática B3 > `pptSetId` numérico (legado) > nombre. Una confirmación nunca la pisa el automático; si el grupo confirmado deja de existir en `listGroups` ⇒ `reason:'group_none'` y vuelve a la lista.
Si se elige la opción A de B1 (DECISIONES §AUTO-ENLACE, pregunta Q1): enum `Finish` suma `first_edition` (`ALTER TYPE … ADD VALUE`, migración propia ANTES del código que lo usa) y `TCGCSV_SUBTYPE_TO_FINISH` suma `1stedition→first_edition`, `unlimited→normal`, `unlimitedholofoil→holofoil`.
