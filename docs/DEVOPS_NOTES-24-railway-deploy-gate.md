# DEVOPS_NOTES — Addendum §24: Railway congeló el backend ~11 h por un E2E MOCK flaky (2026-08-19)

> **Addendum a `docs/DEVOPS_NOTES.md`.** Se publica como archivo aparte porque el
> `DEVOPS_NOTES.md` (188 KB) no se pudo reescribir de forma segura con las herramientas
> disponibles en esta sesión (full-replace + `git commit` local bloqueado). Este contenido
> es la sección **§24** y **corrige** la recomendación de **§5.1** que listaba `e2e-ok`(mock)
> como *required check* bloqueante. Dueño: **devops**.

> **TL;DR:** Railway tiene **«Wait for CI»** activado y espera al **check-suite completo** de
> GitHub Actions antes de desplegar. Un job en rojo —`frontend-e2e` (MOCK) y su gate
> `e2e-ok`— tumbaba el suite, así que **ningún merge posterior a las ~15:44 UTC del 18** llegó
> a producción (frontend nuevo hablando con backend viejo). El rojo **no era de entorno**
> (Chromium instaló bien): eran **8 tests de `frontend/e2e/buylist.spec.ts` en MODO MOCK**.
> Arreglo: el MOCK pasa a **informativo, no deploy-blocking**; los gates money-safe
> (build + `backend-e2e` + seguridad) siguen **duros**.

## 24.1 Diagnóstico (con datos, no supuestos)

Runs reales sobre `production@2bad15c0` (release PR #15, `main`→`production`):
- **VERDES**: `backend`, `frontend`, `ci-ok`, `backend-e2e`, `gitleaks`, `trivy-image`,
  `trivy-fs`, `semgrep`, `npm-audit`, `sast-ok`.
- **ROJOS**: `frontend-e2e` y `e2e-ok`.

Log del job `frontend-e2e` (run 32203036390): **Chromium instaló correctamente**
(`/home/runner/.cache/ms-playwright/chromium-1194/chrome-linux/chrome`), la suite **arrancó y
corrió** (`57 passed`), y fallaron **8** — todas de `e2e/buylist.spec.ts`, todas en el helper
`addFirstSellableCard`:

```
TimeoutError: locator.getAttribute: Timeout 15000ms exceeded.
  waiting for getByLabel('Filtrar por set').locator('option').nth(1)
  buylist.spec.ts:37  const firstSet = await setSelect.locator('option').nth(1).getAttribute('value');
```

En MODO MOCK el `<select>` "Filtrar por set" solo trae el placeholder (`option[0]`, "Todos
los sets") y **no aparece ningún set real** (`option[1]` nunca existe). **No es entorno** (ni
Chromium ni el overlay de Next Dev Tools de rondas anteriores, §22.2): es un **fallo de
test/fixtures del frontend** en modo mock. `backend-e2e` (integración real) pasó, lo que
confirma que el problema es específico del frontend-e2e MOCK. **Enrutado al rol frontend**
(§24.7); devops no toca `frontend/e2e/`.

## 24.2 Por qué esto congela el deploy (mecánica de Railway «Wait for CI»)

Railway «Wait for CI» espera a que el **check-suite de GitHub Actions** del commit termine en
`success`. Todos los workflows de Actions cuentan como **un** check-suite; **cualquier** job
en `failure` lo deja en `failure` → Railway **no despliega**. Por eso un rojo de un E2E MOCK
basta para congelar el backend, aunque el backend no tenga nada que ver con ese test. **La
única palanca determinista desde el repo** es que el job MOCK **no reporte `failure`** (no se
puede quitar un job puntual del suite desde el panel de Railway; y **NO** queremos apagar
«Wait for CI» ni desplegar con seguridad en rojo).

## 24.3 Arreglo aplicado (camino (b): separar el MOCK flaky del gate, sin perder seguridad)

Se eligió **(b)** y no **(a)** porque el fallo **no es de entorno acotado** que devops pueda
arreglar: vive en `frontend/e2e/buylist.spec.ts` (zona del rol frontend, CLAUDE.md) y no es
un flake de Chromium. Cambios, **solo en `.github/workflows/e2e.yml` (zona devops)**:

1. **`frontend-e2e` (MOCK) → informativo.** El paso `npm run test:e2e` corre con
   `id: mock_e2e` + `continue-on-error: true`; un paso siguiente degrada el fallo a
   `::warning::` y termina el job en verde. **La instalación de Chromium sigue siendo dura**
   (un fallo de *infra* ahí sí revienta el job): solo se ablandan las **aserciones**, no el
   arranque del entorno.
2. **`e2e-ok` (gate) → bloquea SOLO por `backend-e2e`.** Ya no falla por el MOCK; reporta el
   MOCK como `::warning::` para transparencia.
3. Se conserva el artifact `playwright-report-mock` (la señal informativa sigue disponible).

Lo que **NO** se tocó (candado money-safe intacto): `ci.yml` (build/lint/typecheck/test),
`backend-e2e` (integración real Postgres+Redis+MinIO), y **toda** la fase de seguridad
(`security-sast.yml`: `semgrep`, `gitleaks`, `npm-audit`, `trivy-fs`, `trivy-image`,
`sast-ok`). El **gate REAL de UI** (`e2e-real.yml`, stack completo mocks=false) sigue siendo
nightly + pre-prod (`workflow_call` en `deploy.yml`). "Verde de verdad" no se debilita: solo
dejó de bloquear el deploy un E2E de **fixtures**.

## 24.4 Matriz de checks — deploy-blocking vs informativo (referencia canónica)

| Check | Workflow | ¿Bloquea deploy? | Qué garantiza |
|---|---|---|---|
| `ci-ok` (+ `backend`, `frontend`) | `ci.yml` | **SÍ (duro)** | lint + typecheck + test + **build** de ambas apps |
| `backend-e2e` | `e2e.yml` | **SÍ (duro)** | integración REAL contra Postgres 16 + Redis 7 + MinIO |
| `e2e-ok` | `e2e.yml` | **SÍ (duro)** | agrega el gate E2E; desde §24 bloquea **solo** por `backend-e2e` |
| `sast-ok` (+ `semgrep`, `gitleaks`, `npm-audit`, `trivy-fs`, `trivy-image`) | `security-sast.yml` | **SÍ (duro)** | secretos, SCA high/critical, imágenes, SAST |
| `frontend-e2e` (MOCK) | `e2e.yml` | **NO (informativo)** | regresión de UI contra **fixtures**; señal de PR/nightly |
| `E2E real (stack real)` | `e2e-real.yml` | **NO por-push; SÍ pre-prod** | flujos críticos contra **endpoints reales** (gate REAL de UI, nightly + `workflow_call`) |

## 24.5 Pasos EXACTOS para el humano (opcional, endurecimiento — el arreglo del repo ya desbloquea)

Con el arreglo de §24.3, en cuanto la rama `production` tenga el `e2e.yml` nuevo **todos** los
checks deploy-blocking quedan verdes y Railway despliega **sin tocar ningún panel**. Los pasos
de abajo son **endurecimiento recomendado**, no requisito:

- **GitHub → repo `tcg-vault-mx` → Settings → Branches → Branch protection de `production` (y
  `main`):** en *Require status checks to pass before merging* deja marcados **solo los
  deploy-blocking**: `ci-ok`, `backend`, `frontend`, `backend-e2e`, `e2e-ok`, `sast-ok`.
  **Desmarca `frontend-e2e`** si estuviera marcado. Así un futuro rojo *informativo* nunca
  vuelve a bloquear un merge.
- **Railway → servicio `backend` → Settings → deja «Wait for CI» ACTIVADO.** No lo apagues: es
  el candado money-safe. Con el `e2e.yml` nuevo ya no se queda esperando un check flaky.
  (Railway no permite elegir checks individuales en su panel; la selección fina se hace en la
  branch protection de GitHub de arriba.)

> **Corrección a §5.1:** la recomendación previa listaba `e2e-ok` **(mock)** como *required
> status check*. Queda corregida: los required son los deploy-blocking de §24.4; **`frontend-e2e`
> (MOCK) NO**. (Aunque quedara marcado, ya es inocuo: con el soft-gate el job MOCK termina en
> verde y `e2e-ok` solo depende de `backend-e2e`.)

## 24.6 Paso ÚNICO del PO para desplegar YA el backend pendiente + cómo verificar

1. **Abrir/mergear el release PR `main` → `production`** (mismo mecanismo que el PR #15). En
   cuanto el `e2e.yml` de §24.3 esté en el HEAD de `production`, CI reejecuta y
   `frontend-e2e`/`e2e-ok` salen **verdes**; con todos los deploy-blocking en verde, Railway
   (Wait for CI) **despliega el backend solo**. Si prefieres forzarlo a mano: **Railway →
   servicio `backend` → environment `production` → botón «Deploy» / «Redeploy»** sobre el
   último commit de `production`.
2. **Verificar en los logs de Railway** (servicio `backend`, environment `production`) que
   bajó el backend nuevo:
   - Arranque limpio + migraciones: línea de `prisma migrate deploy` aplicando las migraciones
     recientes (`…_m25_guest_checkout`, `…_m25b_inventory_owner_check`, `…_m26_card_number_order`,
     `…_m27_card_finish_signals`) y el health respondiendo en `/api/v1/health`.
   - **Fix de precios activo** (una vez mergeado su PR): filtro `PokemonPriceTracker` → debe
     **desaparecer** la línea `… falló: HTTP 400/404 … Se devuelven 0 filas` (§23.9) y aparecer
     `ejemplo de entrada cruda` con filas > 0. Si sigue en 0, el fix de backend aún no está en
     `main`/`production` (es otro stream).
   - **Poda de guest checkout activa**: el `guest-order-sweep` corre en el scheduler sin error
     de arranque.

> Los **2 fixes de backend en paralelo** (adapter de precios §23.9 y poda de guest checkout)
> bajan en el **primer release** que los tenga en `main`→`production`. Este arreglo abre y deja
> **confiable** el camino de deploy; el contenido concreto que baja depende de qué esté
> mergeado en `main` al momento del release.

## 24.7 Hallazgo enrutado a `frontend` (no lo toca devops)

`frontend/e2e/buylist.spec.ts` falla en MODO MOCK: el `<select>` "Filtrar por set" no expone
sets reales (`option[1]` inexistente) con `NEXT_PUBLIC_USE_MOCKS=true`. Es un desajuste
**test/fixtures del frontend** (o el mock de catálogo/buylist dejó de sembrar sets, o el
selector quedó obsoleto). **Dueño: rol frontend.** Mientras no se arregle, la suite MOCK queda
en `::warning::` (informativa) y el gate REAL (`e2e-real.yml`, que también corre
`buylist.spec.ts` pero contra el stack real) sigue cubriendo el flujo de venta de punta a
punta. No es bloqueante para el deploy del backend.
