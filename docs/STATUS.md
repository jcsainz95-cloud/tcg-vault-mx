# STATUS.md — fotografía del estado (máx. 150 líneas, se sobrescribe; nunca bitácora)

> Reemplaza a `BACKEND_NOTES`, `FRONTEND_NOTES`, `DEVOPS_NOTES`, `PENTEST_NOTES`, `SECURITY_NOTES` y `TECH_DEBT`
> (congelados en `docs/archive/` el 2026-11-06). Cada rol **sobrescribe solo su sección**. Lo cerrado sale; la historia
> está en git. Toda fila lleva fecha de medición; sin fecha = **NO MEDIDO**.

## Infra y arranque (devops) — medido 2026-11-06
- **Producción**: frontend en Vercel, backend + Postgres 16 + Redis 7 en Railway. Publica **solo `production`**.
  Healthcheck `GET /api/v1/health`. No hay staging (blanco de seguridad = local).
- **Local con Docker**: `./scripts/dev-up.sh` (infra) · `./scripts/dev-up.sh --apps` (+ apps) · `./scripts/dev-down.sh`.
  Genera secretos locales; nunca usa valores del repo.
- **Local sin Docker** (ruta nativa, la de los gates): `./scripts/stack-native.sh up` (`--gate` fija el sha servido).
- **Puertos**: frontend 3000 · backend 3001 · Postgres 5432 · Redis 6379 · S3 local/MinIO 9000.
- **Pruebas**: `cd backend && npm test` (jest) · `npm run test:integration` (Postgres real) ·
  `cd frontend && npm test` (vitest) · `npm run test:e2e` (Playwright).
- **CI** (`.github/workflows/ci.yml`): backend, frontend, E2E, SAST (semgrep, gitleaks, trivy, npm audit), DAST (ZAP) y
  ~30 candados en `scripts/check-*.sh`, cada uno con su canario. `doc-size` excluye `docs/archive/`.

## Seguridad — hallazgos ABIERTOS (seguridad-lead) — último veredicto 2026-11-04 (§CTA, APROBADO, 0 crít/alt/med nuevos)
| ID | Sev | Qué | Dueño | Medido |
|---|---|---|---|---|
| P-RL-1 | Media | Tope por IP esquivable rotando `X-Forwarded-For` si el edge de Railway lo deja pasar (el tope por cuenta sí protege el login) | devops + backend | 2026-10-05 |
| SEC-CHK-1 | Media (Crítica si se configura mal) | Secreto del botón de CP solo seguro como secreto de **entorno** `catalogo-cp` con regla de rama `production` + revisores | devops + dueño | 2026-11-02 |
| CL-1 / CSP-RO | Media | CSP en `report-only`; el nonce de Next no llega a producción | frontend + devops | 2026-11-02 |
| CL-3 | Media | Evidencias pendientes de dinero real: DAST full sobre sha de prod, simulacro de restauración con llaves `PII_*` fuera de Railway | devops + dueño | 2026-10-05 |
| LIVE5-STRIPE | Media | Reembolso SPEI (`chargeState`, `to-manual`) solo probado contra doble de Stripe | backend | 2026-10-05 |
| BL-42 | Media | INE sin ancla de purga en dos caminos ⇒ retención indefinida | backend + dueño | 2026-10-05 |
| S-M4P-A | Media | `RolesGuard` falla abierto y `admin-shipments` (PII densa) sin candado de regresión — **vencido** | backend | 2026-09-22 |
| PT-CTA-5 | Baja | Residual de «cuenta con solo el correo» (aceptado) | backend | 2026-11-04 |
Aceptados (no bloquean): `@nestjs/core` GHSA-36xv (sin `@Sse`), avisos de tooling de dev, SEC-MKT-4, MKT-INFO-1/2/3,
SEC-CS90-1, CS-RT-2…5, SEC-CS-E, aviso de Maps en privacidad. Detalle: `docs/archive/SECURITY_NOTES.md` (grep por ID).
⚠ No encender `sealed_restock_alerts` sin doble opt-in (PEN-CNV-2). Antes de pegar `SEPOMEX_DATABASE_URL`, cumplir SEC-CHK-1.

## Bugs abiertos (qa) — medido 2026-10-31
| ID | Qué | Dueño |
|---|---|---|
| FE-HOMEQUOTER-TEARDOWN | `HomeQuoter.tsx` hace setState tras desmontar ⇒ «window is not defined» en `page.test.tsx` (1/1 en suite con carga ~8; 0/5 aislado, N=5, orquestador) | frontend |
| MKT-953-FOTO | Foto de sellado < 1000 px para `Product` (og) | backend |
Resto del backlog con dueño y fecha: índice de `PENDIENTES.md`.

## Deuda técnica activa (todas las secciones)
| ID | Qué | Dueño | Medido | Cierre |
|---|---|---|---|---|
| **DT-API** | `frontend/src/lib/api.ts` monolítico: **396 628 bytes**. Dividir por dominio (`lib/api/{catalog,orders,vault,buylist,admin,auth,marketing}.ts`) con un `index.ts` que re-exporte para no romper imports | frontend | 2026-11-06 | `wc -c frontend/src/lib/api.ts` < 20 000 y suite vitest verde |
| **DT-DOCS-PARIDAD** | ~35 pruebas de paridad (mocks↔contrato, enums, TECH_DEBT, DESIGN_SYSTEM, PROJECT) y 3 scripts de CI leen `docs/archive/` (congelado). Ya no detectan deriva contra el contrato vivo | arquitecto + backend + frontend | 2026-11-06 | `git grep -l "docs/archive\|'archive'" -- backend/test frontend/src scripts` vacío, con fuentes ejecutables (enums en código) |
| DT-I18N | `messages/es.json` y `en.json` gigantes: partir por scope (`i18n/message-scopes.ts` ya existe) | frontend | NO MEDIDO | tamaño por fichero < 100 KB |
| DT-FIXTURES | `fixtures.ts` / mocks grandes en `frontend/src/lib/mock/` | frontend | NO MEDIDO | — |
| TL-CTA-* | Fichas abiertas del techlead sobre «cuenta con solo el correo» (16, 17, 19, 20, 22, 23) | backend + frontend | 2026-11-04 | ver `docs/archive/TECH_DEBT.md` §CTA |
| TL-MKT2-3…8, TL-MKT3-3/4, TL-MKT4-1…5 | Deuda del stream de marketing (edad del dato servidor→cliente, sellos de OPS) | varios | 2026-10-31 | ver archivo |
| Registro histórico | 172 filas en `docs/archive/TECH_DEBT.md` (sin re-medir): se migran aquí **solo** al tocar su módulo | dueño del módulo | 2026-11-06 | — |

## Backend (backend) — 2026-11-06
27 módulos en `backend/src/modules/`; 86 modelos Prisma, 83 migraciones. Sin cambios de código en esta limpieza.

## Frontend (frontend) — 2026-11-06
Next 15.5 App Router; admin M1–M12. Sin cambios de código en esta limpieza.

## Cierre de stream / release (devops)
Último publicado: `production` = `5db6984e` (PR #121, 2026-11-05). `main` va **587 commits detrás** de `production`
(medido 2026-11-06 con `git rev-list --left-right --count origin/main...origin/production`).
