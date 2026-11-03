# DEVOPS_NOTES — Addendum §24: qué E2E bloquea y por qué (gate de `e2e.yml`)

> **Addendum a `docs/DEVOPS_NOTES.md`.** Dueño: **devops**. Aquí vive **un solo hecho**: qué jobs E2E
> de `e2e.yml` bloquean y cómo se decide verde/rojo en `frontend-e2e` (MOCK). La versión anterior
> (soft-gate de 2026-08-19, pasos de aquel deploy, hallazgo de `buylist.spec.ts`) está en git:
> `git show 48077124:docs/DEVOPS_NOTES-24-railway-deploy-gate.md`.

## 24.0 Estado vigente (2026-11-03, rama `claude/ids-diseno`, base `48077124`)

- **`frontend-e2e` (MOCK) es DURO.** Una prueba roja en **todos** sus intentos (`retries: 2` en CI,
  `frontend/playwright.config.ts`) ⇒ job **rojo** y `e2e-ok` **rojo**. Una prueba roja y luego verde
  en un reintento (**flaky**) ⇒ job verde, pero **registrada**: `::warning::` con su nombre y tabla
  «Flaky» en el resumen del job. Flaky no bloquea; tampoco es silencio.
- **Mecanismo:** el paso corre `npm run test:e2e 2>&1 | tee $LOG || rc=$?` y pasa `rc` y log a
  `scripts/e2e-mock-verdict.sh`. **Manda el rc de Playwright**; el script solo endurece: rc=0 con
  «N failed»/«interrupted» en el resumen ⇒ rojo; rc=0 y 0 pasadas («No tests found») ⇒ rojo.
- **Candado + canario:** `scripts/e2e-mock-verdict-canary.sh`, paso de `ci.yml › e2e-harness-gaps`.
  (A) el job no tiene `continue-on-error`, el rc llega al veredicto sin `|| true` y `e2e-ok` bloquea
  por `needs.frontend-e2e.result`; 5 mutaciones del workflow, todas rojas. (B) 13 casos sobre
  salidas reales de `@playwright/test` 1.56.0. Sobre el `e2e.yml` de `48077124` el candado da rojo.
- **`e2e-ok` bloquea por:** `backend-e2e`, `frontend-e2e` (`skipped` por `detect` no bloquea;
  `cancelled` sí) y `measurement-e2e`. Reporta los tres antes de salir.
- **Coste aceptado:** Railway tiene «Wait for CI» y espera el check-suite completo (24.2). Desde hoy
  una prueba MOCK roja 3/3 en `production` **congela el deploy del backend** hasta que frontend la
  arregle. Es lo que se quiere: un rojo determinista es un defecto; uno intermitente ya no congela.

### 24.0.1 Por qué se endureció (medido)

Run **41702516917** (workflow «E2E», sha `48077124`), job `frontend-e2e` **126150617900**: «2 failed /
38 skipped / 5 did not run / 433 passed», `Process completed with exit code 1`… y el job en
**success**, porque el paso tenía `continue-on-error: true` (`e2e.yml:622` en `48077124`) y el paso
siguiente degradaba el fallo a `::warning::`. Las dos rojas, en sus 3 intentos:

- `e2e/ids-real.spec.ts:147:7` · `@real IDS-F7` — `Error: No se encontró la API real…` en
  `utils/env.ts:155`, llamado desde **`ids-real.spec.ts:77:17`**: el `afterAll` del describe hace
  `apiAs('admin','GET','/admin/settings')` **sin** el `if (!IS_REAL) return;` que sí tiene el
  `beforeAll`; en MOCK no hay API y Playwright carga el error del `afterAll` a la última prueba del
  bloque (F7). Atribución reproducida en scratch con Playwright 1.56.0; el 3/3 es lo medido en CI. **Dueño: frontend.**
- `e2e/discount-codes.spec.ts:156:7` · DSC «el mismo renglón; un código de envío gratis da C13a…» —
  `TimeoutError: locator.fill: Timeout 15000ms exceeded`. **Dueño: frontend.**

El soft-gate de 2026-08-19 era una excepción de CI sin dueño, sin caducidad y sin candado: según
`CLAUDE.md` («Condiciones de veredicto»), no vale.

## 24.1 Diagnóstico de 2026-08-19 (histórico, resumido)

Railway congeló el backend ~11 h: `frontend-e2e` y `e2e-ok` rojos sobre `production@2bad15c0` (run
32203036390) por **8 pruebas deterministas** de `e2e/buylist.spec.ts` en MOCK (`option[1]` del
filtro de sets inexistente). Se eligió ablandar el MOCK para no congelar el deploy. Detalle: git.

## 24.2 Mecánica de Railway «Wait for CI»

Railway espera a que el **check-suite de GitHub Actions** del commit termine en `success`. Todos los
workflows de Actions cuentan como **un** check-suite; **cualquier** job en `failure` lo deja en
`failure` y Railway **no despliega**. No se puede excluir un job desde el panel de Railway. **No se
apaga «Wait for CI»**: es el candado que impide desplegar con seguridad en rojo.

## 24.3 Matriz de checks E2E (referencia canónica)

| Check | Workflow | ¿Bloquea? | Qué garantiza |
|---|---|---|---|
| `backend-e2e` | `e2e.yml` | **SÍ** | integración REAL contra Postgres + Redis + s3-local |
| `frontend-e2e` (MOCK) | `e2e.yml` | **SÍ** desde 2026-11-03 (flaky: no, registrada) | regresión de UI contra fixtures |
| `measurement-e2e` | `e2e.yml` | **SÍ** | candado de privacidad de la Fase 2 (§101.4) |
| `e2e-ok` | `e2e.yml` | **SÍ** | agrega los tres de arriba |
| `E2E real (stack real)` | `e2e-real.yml` | **NO por push; SÍ pre-prod** | flujos críticos contra endpoints reales (nightly + `workflow_call`) |

## 24.4 Rollback de esta política

Revertir el commit que la introdujo (`git revert <sha>`) devuelve el `continue-on-error`; el candado
de `ci.yml` se pondrá rojo, como debe: volver al soft-gate exige quitar el candado a la vista, con
dueño y fecha de caducidad (`CLAUDE.md`, «Condiciones de veredicto»).
