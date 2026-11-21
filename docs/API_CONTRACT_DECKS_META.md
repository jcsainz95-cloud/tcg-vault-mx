# API_CONTRACT_DECKS_META · «Publicar ahora» y reporte (anexo; §DECKS-TOP-FUENTE, backend 3b60e538)

Convenciones del contrato principal (`API_CONTRACT.md`): errores `{error:{code,message}}`, auth por cookie, dinero n/a.

## 1. POST `/admin/jobs/decks-meta-refresh` · `vault_operator` (solo `dryRun:true`) y `super_admin` (ambos)
- Request: `{dryRun?: boolean}` (default false). `dryRun:false` con `vault_operator` ⇒ 403 `FORBIDDEN` (conserva el ensayo que el operador ya tenía; no gana publicar).
- 202 `{jobId: uuid, status: 'queued'|'running', deduped: boolean}`.
- Idempotente solo con el MISMO `dryRun`: si hay un job en cola/corriendo del mismo tipo devuelve ESE (`deduped:true`); si no hay, crea uno (`deduped:false`).
- Si hay un job en curso de OTRO tipo ⇒ 409 `REFRESH_BUSY` con `{runningJobId, runningDryRun}` (no se encola, no se devuelve el ajeno).
- Auditoría: `jobs.decks_meta_refresh.run`.
- No es síncrono (una corrida mide ~1-2 min; un proxy cortaría la petición). El job semanal BullMQ no cambia.

## 2. GET `/admin/jobs/decks-meta-refresh/:jobId` · `vault_operator` (solo jobs `dryRun:true`; otro ⇒ 404) y `super_admin`
- 200 `{jobId, status: 'queued'|'running'|'done'|'failed', dryRun: boolean, enqueuedAt: ISO, startedAt: ISO|null, finishedAt: ISO|null, result: RefreshRunResult|null, error: string|null}`; `error` ≤ 300 caracteres.
- `result` solo con `done`; `error` solo con `failed`.
- 404 `NOT_FOUND`: el id no existe, o el servidor reinició (la cola es en proceso, últimos 20). El front trata 404 como «perdido: ver último reporte».
- 400: `:jobId` no es uuid.
- Front: sondea cada 3 s hasta `done|failed`; texto «~1-2 min». Tope de sondeo 5 min (luego «tarda más de lo normal; revisa el último reporte»); se cancela al salir de la página. Fallo de red en el sondeo ⇒ reintentar el sondeo (no abortar); si luego responde 404 ⇒ «El servidor se reinició; vuelve a intentarlo» (nunca «red con Limitless»). 409 `REFRESH_BUSY` ⇒ «Hay un ensayo en curso; espera a que termine» (o «publicación» según `runningDryRun`). Un `done` con `dryRun:false` sin publicar ⇒ «no se publicó: algún chequeo no pasó»; esto ya no puede confundirse con un ensayo ajeno.

## 3. Reporte `RefreshRunResult` (cambios aditivos)
- `delistedSlugs: string[]`: slugs despublicados en esta corrida por `missedRuns` ≥ 3 (vacío si ninguno).
- Canario C6 «índice parseable»: filas válidas de `/decks` ≥ `minDecks`; clave i18n nueva en el front.
- C2 «fuera de banda» = fuera de banda ≤ 40 % (env `META_CANARY_OUT_OF_BAND_MAX_RATIO`, default 0.4); sobre el umbral ⇒ NO_PUBLISH + aviso.
- `source: 'decks-index'|'home-fallback'` según §DECKS-TOP-FUENTE punto 4.
