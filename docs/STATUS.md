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
- **Chromium en CI** (CI-APT-LOCK, 2026-11-06): los 5 pasos que lo instalan llaman a `scripts/ci-install-chromium.sh`
  (espera el candado de apt del runner, `DPkg::Lock::Timeout` 300 s, backoff 30/60 s); candado `check-chromium-install.sh`.

## Seguridad — hallazgos ABIERTOS (seguridad-lead) — último veredicto 2026-11-07 (sha fbccc2b3, P-PROMOS C 3.ª ronda delta: APROBADO 0 crít/alt; `pricePending` solo booleano sin stock privado; caché de sets solo como respaldo si falla la red; jest bounded+mkt-tienda 26/26, vitest tcgplayerImage 2/2)
| ID | Sev | Qué | Dueño | Medido |
|---|---|---|---|---|
| P-RL-1 | Media | Tope por IP esquivable rotando `X-Forwarded-For` si el edge de Railway lo deja pasar (el tope por cuenta sí protege el login) | devops + backend | 2026-10-05 |
| SEC-CHK-1 | Media (Crítica si se configura mal) | Secreto del botón de CP solo seguro como secreto de **entorno** `catalogo-cp` con regla de rama `production` + revisores | devops + dueño | 2026-11-02 |
| CL-1 / CSP-RO | Media | CSP en `report-only`; el nonce de Next no llega a producción | frontend + devops | 2026-11-02 |
| CL-3 | Media | Evidencias pendientes de dinero real: DAST full sobre sha de prod, simulacro de restauración con llaves `PII_*` fuera de Railway | devops + dueño | 2026-10-05 |
| LIVE5-STRIPE | Media | Reembolso SPEI (`chargeState`, `to-manual`) solo probado contra doble de Stripe | backend | 2026-10-05 |
| BL-42 | Media | INE sin ancla de purga en dos caminos ⇒ retención indefinida | backend + dueño | 2026-10-05 |
| S-M4P-A | Media | `RolesGuard` falla abierto y `admin-shipments` (PII densa) sin candado de regresión — **vencido** | backend | 2026-09-22 |
| PRM2-1 | Baja | Docs: `ARCHITECTURE.md` §5.12 aún dice «id de pokemontcg.io NO MEDIDO» pero `tcgcsv-importable-groups.ts:17-21` ya lo midió (176 sets, `mep` ausente). Cierre: corregir la línea | arquitecto | 2026-11-07 |
| PRM2-2 | Baja | Reversa tras importar: un backend VIEJO con filas `event_promo` falla al leer `CardProduct.stampType` (el cliente Prisma no conoce el valor; Postgres no quita valores de enum). El despliegue normal es seguro (no hay filas hasta que el admin importa). Cierre: nota en la PR de publicación «si se revierte código, antes borrar filas `tcgcsv:`» (ARCHITECTURE §5.12 ya lo dice) | orquestador (PR) | 2026-11-07 |
| PRM3-1 | Baja | `pokemontcg-io.client.ts` caché `setsCache` por proceso (varias réplicas ⇒ caché distinta; tras reinicio se pierde): aceptable porque solo se usa si la red falla; un 200 válido recorta/desactualiza el listado solo hasta el siguiente éxito. Sin acción salvo que se quiera Redis | backend | 2026-11-07 |
| TL-PRM3-2 | Baja | `frontend/src/lib/tcgplayerImage.ts` duplica la regex de `upgradeSealedImageUrl` (`inventory/sealed-image-host`); riesgo de deriva. Cierre: `MasterSetCardCellDTO.imageLargeUrl` desde el servidor y borrar el espejo | backend + frontend | 2026-11-07 |
| TL-IDS-1 | Baja | `ids-capture.ts:216-221` `versionContributionReferenceCents` repite `scaleByPct` en el front (aritmética de dinero; espejo declarado de `versionReferenceForAlta`, riesgo de deriva si cambia el redondeo). No afecta al sugerido (viene del servidor). Cierre: exponer la cifra en `VersionComboDTO` | frontend + backend | 2026-11-06 |
| TL-IDS-2 | Baja | `removableCount` (`VariantDrawer.tsx:203`) cuenta sobre las filas leídas (tope 100, TL-A2-2): con >100 piezas en la casilla subestima lo que `bulk-remove` baja. Atado a TL-A2-2 | frontend | 2026-11-06 |
| PT-CTA-5 | Baja | Residual de «cuenta con solo el correo» (aceptado) | backend | 2026-11-04 |
| FE-EAGER-1 | Baja | Umbrales eager sueltos (8 `CatalogView.tsx:495`, 6 `MasterSetBinder.tsx:~583`, 4 `SellCartContents.tsx:206`, 4 `TopBountiesShelf.tsx:66`) sin constante nombrada, a diferencia de `FEATURED_EAGER_TILES` (`FeaturedCarousel.tsx:124`); además la regla de uso de `eager` en `CardImage.tsx:~92` solo cita Destacadas. Sin riesgo de seguridad | frontend | 2026-11-06 |
NO MEDIDO (sha ead1753a; en 3b3715dd los 2 endpoints de promos sí se atacaron: 401/403/400/404 vía e2e 11/11): ataque HTTP en vivo con token no-admin/cardId ajeno (sin Postgres levantado; carga 4,5). Cubierto por lectura: `inventory.controller.ts:94-95` `@Roles(vault_operator, super_admin)` de clase + `RolesGuard` global (`app.module.ts:104`) ⇒ cliente 403 / anónimo 401; el endpoint toma `cardId` solo como clave (404 si no existe), sin dato de otro usuario; `buySuggestedFor` (`inventory-versions.service.ts:141-166`) sin consultas por combo (usa el lote), override solo (en, sin liga). Ablación: truncar en vez de `scaleByPct` ⇒ 1/8 rojo; restaurado. Unit 8/8 verde.
Aceptados (no bloquean): `@nestjs/core` GHSA-36xv (sin `@Sse`), avisos de tooling de dev, SEC-MKT-4, MKT-INFO-1/2/3,
SEC-CS90-1, CS-RT-2…5, SEC-CS-E, aviso de Maps en privacidad. Detalle: `docs/archive/SECURITY_NOTES.md` (grep por ID).
⚠ No encender `sealed_restock_alerts` sin doble opt-in (PEN-CNV-2). Antes de pegar `SEPOMEX_DATABASE_URL`, cumplir SEC-CHK-1.

## Bugs abiertos (qa) — re-gate P-PROMOS C sobre fbccc2b3 (2026-11-07): APROBADO
| ID | Qué | Dueño |
|---|---|---|
| QA-PRM-TIMERS | `tcgcsv-set-import.service.ts:39` `PTCG_TIMEOUT_MS` 10 s = `boundedBudgetMs` 10 s (`pokemontcg-io.client.ts:82`): con upstream colgado, caché vs 503 depende de qué temporizador gane (real 2/2 caché, 11.7 s). Timeout externo > presupuesto | backend |
| QA-PRM-COPY | Ficha con «Precio pendiente» y pieza en stock sigue diciendo «Hoy no tenemos esta carta.» (`CardDetailView.tsx:528`) | frontend |
| QA-PRM-IMGW | Binder 24451 con `_in_1000x1000`: 12.95 MB con scroll completo (×6.1 vs `_200w`); 1.ª vista 1.9 MB@1280 / 0.64 MB@390, visibles <0.9 s, lazy. Aceptable en admin; vigilar si se reutiliza en público | frontend |
| QA-ROUTES | (anterior) frontend editó la tabla de qa (503742d1, e074e790) y `e2e-skip-census.baseline`; en este rango, rutas limpias | orquestador |
Cerrados (re-medidos en fbccc2b3): PEND (Asia #028 en stock ⇒ «Precio pendiente» 390/1280, sin $0 ni carrito; Pikachu #107 con precio sin stock ⇒ «Agotada»), FLAKY (con caché 20/20 ×200; fresco tras reinicio 5/6 ×200, el 503 = CF 502 `Retry-After` 60; bloqueado tras éxito 3/3 ×200 por caché; sin caché ni red 2/2 ×503, 0 escrituras), EMPTY (código; real NO MEDIDO), UX (chip «Staff»; desglose 1 línea sin corte 1280/390; meta de grupos nueva sin desborde; binder 115/115 `_in_1000x1000`), FE-HOMEQUOTER-TEARDOWN (0 avisos en vitest completo). Siguen cerrados: FAILOPEN, COVER, I18N, CENSUS, SHADOW, POOL, PAREN.
Medido en fbccc2b3: tsc back/front 0; jest backend 9959/9959 (569); vitest 5888/5888 (13 skip); integración promo-tcgcsv 17/17 ×2 (Postgres desechable); e2e mocks promos 3/3; censo y doc-size verdes (+canarios).
Real: 24451 ⇒ 115 cartas, 33 versiones, 10 sin precio, 0 omitidas; pokemontcg.io directo 1/12 ×200 hoy.
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
| TL-A2-2 | Cajón: la segunda lectura (`stamped=true`) se trunca (`VariantDrawer.tsx` ~L178, ~L426) y no se avisa al admin | frontend | 2026-11-06 | aviso «Mostrando las primeras n» + prueba |
| TL-ALTA-1 | Sin foco/aviso de error en la captura de idioma/versión: `useIdsCapture.ts:73,79`, `ids-capture.ts:145,161` (y ficha original) | frontend | 2026-11-06 | ver `docs/archive/TECH_DEBT.md` TL-ALTA-1 |
| Registro histórico | 172 filas en `docs/archive/TECH_DEBT.md` (sin re-medir): se migran aquí **solo** al tocar su módulo | dueño del módulo | 2026-11-06 | — |

## Backend (backend) — 2026-11-07 (P-PROMOS C, 3.ª ronda: sello `event_promo`)
- Migración aditiva `20261115120000_m98_stamp_event_promo` (`ALTER TYPE "StampType" ADD VALUE IF NOT EXISTS 'event_promo'`); `migrate deploy` OK en base limpia y en base con datos previos (pieza `staff` intacta); re-ejecución idempotente. Mapas: card-version.ts (INTERNAL_STAMP_TEXT), inventory.service.ts (EXPORT_STAMP_TEXT), order-notice.templates.ts (ES/EN).
- Parser `tcgcsv-card-name.ts`: lista cerrada (Pitch Black Stamped/Pokemon Center Exclusive/Cosmos Holo/Ace Trainer ⇒ event_promo; World Championships <año>/Asia Championship Series… /Winner ⇒ championship); evento + [Staff] ⇒ staff (producto propio de TCGCSV). Otro ⇒ unknown_stamp. Mutación 3/3 rojas; integración promo-tcgcsv 15/15 ×2.
- PROMO-B8 (tcgcsv-set-import.service.ts): sello no-[Staff] sin carta plana ⇒ carta propia set_base con la etiqueta en el nombre; su [Staff] cuelga de ella; sin restricción única set+número (solo índice), identidad = externalId tcgcsv:<productId>. Mutación 3/3 rojas, integración 15/15 x2, suite completa 568/568 (9946).
- MEDIDO TCGCSV 24451 (148 productos): 96 cartas planas + 19 propias = 115; 33 versiones (24 staff, 8 event_promo, 1 championship); 0 no_base; 0 unknown_stamp.
- P-PROMOS C re-gate (2026-11-07): QA-PRM-PEND cerrado (`catalog.service.ts` `baseVersionPending`: sin listing publicado y base inglés/raw en PRICE_PENDING en todos sus acabados ⇒ `pricePending:true`, con o sin stock; probado con Enamorus #113 en stock, e2e promo-tcgcsv). QA-PRM-FLAKY: `PokemonTcgIoClient.getSetsBounded` (3 intentos, ≤2 s entre ellos, presupuesto 10 s, Retry-After > restante corta, AbortController sin reintentos tras responder, caché 24 h del último bueno; sin caché ⇒ 503 como antes). QA-PRM-EMPTY: 200 con data ausente/no-array/vacía ⇒ error en `getSets`/`getSetsBounded`. PRM2-3 cerrado (`vault_operator` 403 ×2). Rojo-primero y mutación N=3 en cada uno. e2e promo-tcgcsv 17/17 ×2; suite `npx jest` 9959/9959; tsc y eslint limpios.
## Frontend (frontend) — 2026-11-06 (cierre A2b)
Next 15.5 App Router; admin M1–M12.
- Foto de la ficha de sellado (opción A del dueño, 2026-11-06): `components/domain/SealedPhoto.tsx` (tarjeta blanca `photo-mat`, marco fino, p-8, ajustada a la foto, sin caja 5:7, sin agrandar sobre su tamaño natural, tope 560 px de alto, `<img>` cruda: sin costo nuevo en el optimizador). Teja del listado `/sellado`: NO usa la caja 5:7 (miniatura 88×88 `aspect-auto`, `SealedShopView.tsx:247`), sin cambio. Candado: `SealedPhoto.test.tsx` (mutación N=3: 3/3 rojo).
- Nav: `nav.buylist` = «Vende tus cartas» / «Sell your cards». Header medido (Chromium): 390 px el nav vive en el drawer (header 77 px, sin desborde); 1024/1280 px, 4 entradas (público) caben en una línea; con sesión (6) a 1024 px «Vende tus cartas» se parte en 2 líneas (sin desborde, header 84 px igual que antes) y a 1280 px caben sin solaparse.
- Fotos paso 1 (sin `/_next/image`): `eager` en las primeras tejas (catálogo 8, binder del cotizador 6, líneas del carrito de venta 4, bounties 4), resto `lazy`; sin `fetchpriority`. `TopBountiesShelf` pasa de `<img>` crudo a `CardImage` (arreglo de hidratación #120). Interruptor y `remotePatterns` intactos.
- Medición con fixtures (N=3, CPU×6 y red 300 ms): 0 tejas beige a los 5 s antes y después (el arreglo #120 ya cubría catálogo y buylist); sin diferencia de tiempo medible en el fixture (pocas tejas). Paso 2 (optimizador) pendiente de decisión del dueño.
- Alta rápida del cajón (A2b): el banner `role="status"` lleva la nota `admin.m1.batchPublishNote` como segunda frase (sin toast; con `onToast` sigue en el toast); el resumen añade el sufijo del acabado «De liga · Promo de Liga (Holo)» solo si difiere del de la casilla, con la misma función que la burbuja y el desglose (`stampWithFinishLabel`, `IdsCaptureFields.tsx`). TL-A2-1 (CTA `aria-disabled` y enfocable sin precio en modo `choose`), TL-A2-3 y TL-A2-5 (`removableCount` sin filtros de vista) cerrados con prueba y mutación.
- IDS-F12 (compra sugerida por versión): `VersionComboDTO.buySuggestedCents` (centavos, solo servidor); «Pagamos por pieza» se prellena con el del combo elegido (inglés sin liga sigue `buy.effectiveCents`), `null` ⇒ vacío, y se re-prellena al cambiar de versión aunque se haya tecleado; elegir el acabado dentro de la misma versión solo prellena si no se tecleó. El front no hace aritmética de dinero.

- P-PROMOS C (2026-11-07): admin M2 → sección «Importar promos de TCGCSV» (`m2/sections/TcgcsvPromosSection.tsx`, cliente `lib/api/tcgcsv-promos.ts`): lista `GET /admin/catalog/tcgcsv-groups`, botón por grupo `POST /admin/catalog/import-tcgcsv-set {groupId}`; veredicto §32.4 (omitidas ⇒ PARCIAL), resumen creadas/actualizadas/sello, «N sin precio ⇒ precio pendiente», omitidos con motivo. Mock en línea (no bajo lib/mock por R1). PROMO-F1/F2 en `TcgcsvPromosSection.test.tsx`: mutación 6/6 rojas; e2e mocks ×3 3/3 (`e2e/admin-m2-tcgcsv-promos.spec.ts`). Huecos de contrato: códigos de `skipped[].reason` sin enumerar (front traduce los 8 códigos de backend en minúsculas (no_number…card_exists_in_pokemontcg, API_CONTRACT); otro ⇒ crudo); `publishedOn` sin formato. Master Set tras importar: NO MEDIDO con mocks (depende del backend).
- P-PROMOS C fix (2026-11-07): QA-PRM-I18N cerrado (`summary` dice «versiones de liga»/«league versions»); QA-PRM-CENSUS cerrado (baseline 163 con motivo, censo verde); QA-IDS-ROW cerrado (`PieceVersion` `finishLabel`, sufijo «(Holo)» en pieza de liga con acabado ≠ casilla). QA-PRM-UX ABIERTO: ficha sin piezas dice «Agotada» (`CardDetailView.tsx:~512`); `GroupedListingDetailResponse` no trae señal de precio pendiente, pedir al arquitecto/backend. Suite completa 5881/5894 (13 skip), e2e promos 3/3.
- P-PROMOS C front (2026-11-07): `STAMP_TYPES` + `event_promo` («Promo de evento»/«Event promo», 5 mapas es/en; `isLeagueStamp` intacto). `GroupedListingDetailResponse.pricePending: boolean` (requerido); `CardDetailView` sin piezas: `pricePending` ⇒ «Precio pendiente» (`data-testid=price-pending`), si no «Agotada»; sin carrito ni $0. Mock `c-promo-pending`. Pruebas: mutación 3/3 rojas, vitest 5883 pasan, tsc/lint/paridad OK, e2e promos 3/3, censo OK. Sin mock de combo `event_promo` en versions/fixtures (NO añadido: cambiaría conteos de filas IDS).
## Cierre de stream / release (devops)
Último publicado: `production` = `5db6984e` (PR #121, 2026-11-05). `main` va **587 commits detrás** de `production`
(medido 2026-11-06 con `git rev-list --left-right --count origin/main...origin/production`).
