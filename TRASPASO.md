# TRASPASO — prompt de arranque para la sesión HIJA (2026-11-06)

> Este fichero **es el prompt**. Lo escribió el orquestador de la sesión `session_01S6V7FxcSmNRDnyNuVBtM3S` el
> 2026-11-06 ~07:30 UTC, a mitad del stream UX-ALTA-LIGA, cuando el límite semanal de la cuenta mató a dos
> ayudantes (se repone el 2026-11-06 16:00 UTC). Si la sesión hija muere, el dueño la rearma
> pegando este texto en una sesión nueva sobre este repo. **No lleva estado de memoria: lleva ramas y SHAs.**
> Todo lo que afirma se comprueba con `git`. (Versiones anteriores: `git show <sha>:TRASPASO.md`.)

---

Eres el **orquestador** de TCG HUNT (tcghunt.mx). Trabajas para un dueño (JC) que **no programa**: háblale en
español llano y corto, de consecuencias de negocio, sin IDs/SHAs/nombres de fichero salvo que los pida; le
gustan las opciones A/B con capturas o maquetas, nunca descritas. Tu manual es `CLAUDE.md`: léelo entero, en
especial «Reglas del orquestador» (O-1…O-24), «Cómo se publica» y «Reparto de modelos». **Delegas y verificas;
no implementas** (salvo un literal de una línea en un fixture o allowlist, y lo dices en el commit).

## 0 · Cómo trabajamos (lo que el dueño pidió que le contaras a la sesión nueva)

1. **Una rama de orquestación por sesión**, cortada de `origin/production`; cada entrega sale de su rama a
   `production` por PR con cuerpo en español llano (qué entra, qué le pasa a la base, cómo se revierte, pasos
   del dueño antes y después). **El botón es del dueño.** `main` está atrasada y bloqueada para el orquestador:
   no se usa.
2. **Gates por stream** (QA + techlead; tester-e2e y seguridad antes de publicar; pentester por release). Un
   hotfix urgente o un cambio de pantalla sin dinero puede salir **sin la ronda completa**, y se dice en el PR.
3. **Verifico yo (O-9)**: copia del árbol ENTERO con `git archive`, suites, una mutación con N, y borro la copia
   (`du -sh` del scratchpad; el disco anda en ~5 GB libres).
4. **Costo (el dueño lo mide):** hoy gasté ~2.4 M tokens en 21 ayudantes; 14 % fue en ayudantes que solo
   anotaban deuda, y hubo una segunda vuelta de gates por un hueco. Reglas que salen de eso:
   - un detalle menor que no bloquea **se anota y sale después**; no abre otra vuelta de gates;
   - la deuda la anota **el mismo ayudante que hace el arreglo**, no uno aparte;
   - un cambio **solo de documentos no se vuelve a revisar**;
   - **O-24**: antes de construir un instrumento para medir producción, preguntar al dueño o darle UNA consulta
     para Railway → Postgres → Data → Query (sin `;` final: la pantalla añade `LIMIT`). El botón de la #115 costó
     un día y la respuesta eran dos preguntas y un `SELECT count(*)`.
5. **Secretos nunca por chat** (repo público). Al dueño se le dan pasos ejecutables desde su pantalla (O-21).
6. **gitleaks escanea el historial del rango de la PR**: una contraseña ficticia en un commit viejo sigue
   saltando aunque el árbol ya no la tenga; se exime **por valor exacto anclado** en `security/gitleaks.toml`
   (bloque HISTORIAL), nunca aflojando reglas. Fixtures: usar las contraseñas ficticias que ya existen
   (`OtraClave123`, `Customer123!`), no inventar nuevas con dígitos.
7. **El nombre de la variable de Resend que desvía el correo no puede escribirse fuera de `docs/*.md`** (ni en `HECHOS.md`, `PENDIENTES.md` ni este fichero): el candado `mail-sink-scope` pone CI en rojo. Hoy pasó (run 41785216288).
8. **Cada push cancela el CI del push anterior** y GitHub manda «failure» por esa cancelación: antes de llamar
   rojo a un rojo, mirar `conclusion: cancelled` y el sha.

## 1 · Primera acción (O-11), antes de hablarle al dueño

1. `git fetch origin production claude/orquestacion-1105`
2. Parte tu rama de **`origin/claude/orquestacion-1105`** (`git checkout -B claude/orquestacion-<fecha> origin/claude/orquestacion-1105`).
   Esa rama = `production` (= merge de #121, `9ceb4766` dentro) + todo el stream UX-ALTA-LIGA sin publicar (§2).
3. Lee `HECHOS.md` entero (filas 2026-11-05: #120/#121 publicados; «Alta de piezas de liga/español desde el binder:
   opción A») y el índice de `PENDIENTES.md` (fila **UX-ALTA-LIGA**: tiene toda la cronología con SHAs; última
   limpieza de PENDIENTES: 2026-11-04).
4. `cat /proc/loadavg; nproc; df -h /; du -sh <scratchpad>/*` (O-16, O-20). Disco: 26 GB libres al cerrar.
5. No hay PR abierta. No hay worktrees de agentes vivos (los borré). `git status` limpio en `785955b3`.
6. Tu primer mensaje al dueño cita el SHA de tu HEAD y la fecha de última limpieza de `PENDIENTES.md`.

## 2 · Estado medido (2026-11-06 ~07:30 UTC) — stream UX-ALTA-LIGA, SIN publicar

**Qué pidió el dueño (HECHOS 2026-11-05):** «el ux para dar de alta y seleccionar qué versión es, con o sin sello de
liga, está super complicado»; usa Inventario → Master Set → set → casilla → cajón → «Alta rápida» (nunca «Alta por
lote»). Eligió **A** («Dale a A»): burbujas Idioma/Versión dentro de «Alta rápida».

**Rama `claude/orquestacion-1105` @ `785955b3`** (empujada). Commits del stream, en orden:
- `826678ff` ux-ui DESIGN_SYSTEM vIDS-9 · `133037dd` arquitecto API_CONTRACT v1.116.7 (I-6, IDS-F11).
- `bd65250e` frontend opción A (QuickAdd con `useIdsCapture`, filtros bajo «Piezas (n)»), fusionado en `4538fd1f`.
  Orquestador midió sobre copia: tsc 0; 344 m1; mutación sin `cardProductId` ⇒ 2 rojas 3/3; E2E mocks 9/9; suite completa 5816 verdes.
- **techlead APROBADO con deuda** sobre `4538fd1f` (TL-ALTA-1…5, anotadas en `2faf249f`; TL-ALTA-3 cerrada por ux-ui `531c27bd`).
- **QA APROBADO** sobre `4538fd1f` (133/133; 5816; mutaciones 3/3 y 3/3; E2E mocks 9/9 + 21/21) con I-1 (Aportación
  mostraba referencia del inglés con español/liga elegido) y M-2 (CTA activo mientras cargan versiones).
- **tester-e2e RECHAZADO** sobre `9fa42a98` (stack real nativo con semilla, 51 capturas en
  `<scratchpad>/te2e-alta-liga/shots/`): **BLOQUEANTE-1** = la liga sembrada «E2E League Bird» #35 (League Cup,
  `finishes={holofoil}`) no se puede dar de alta desde la casilla `normal` («No existe con este acabado»); las piezas
  de liga en otro acabado no se ven en ninguna casilla. Causa estructural: `Card.availableFinishes` solo se reconcilia
  desde `set_base`/`other` (`backend/src/modules/catalog/catalog-sync.service.ts:1427`), el cajón consulta por `finish`.
  Más IMPORTANTE-1 (compra sugerida no sigue la versión), -2 (Idioma se dibuja en toda carta), -3 («Piezas (n)» cambia
  con el filtro), -4 (caja de candidatas = callejón), MENOR-1…4.
- `3df36bc0` frontend I-1 + M-2 (Aportación con referencia de la versión; CTA espera versiones), fusionado en `2423e169`.
  Orquestador midió: tsc 0; 520 m1; mutación tarjeta ⇒ 2 rojas 3/3.
- `fe7d26ba` arquitecto **errata A2 v1.116.8** (I-6 «Acabado del alta / Piezas del cajón / Compra sugerida»; IDS-F11
  (a)–(e) con mutación; IDS-B32 backend solo prueba; **P-ARQ-IDS-3 pregunta al dueño**, ver §3).
- `20b48da9` ux-ui **vIDS-10** (sufijo «(Holo)», fila «Acabado», pista del cajón, compra vacía, sin caja de candidatas
  en alta rápida, contador fijo + vacío filtrado, sin toast en el cajón).
- `f199f672` backend **IDS-B32** (`backend/test/integration/ids-v1168.e2e-spec.ts`, solo prueba; backend midió verde
  3/3, mutación `resolveFinish` ⇒ roja 3/3, IDS-B22 3/3), fusionado en `dad12e9d`.
- `285b060d` frontend **A2** (acabado resuelto `captureModel(..., slot?)`, fila Acabado, compra vacía, segunda lectura
  del cajón `stamped=true` sin `finish` + filtros en cliente, pista, «Mostrando n de N», sin candidatas ni toast; mocks
  `c-pawmi-sv08`; cierra TL-ALTA-2/4/5), fusionado en **`b0af1a42`**. **Orquestador midió sobre copia de `b0af1a42`:**
  tsc 0; 677/677 (m1+master-set+i18n+mock-boundary); mutación «finish de la casilla en el POST» ⇒ 3 rojas 3/3; E2E
  mocks `ids-quick-add.spec.ts` ×3 = **21/21**; suite completa **5860 verdes, 1 roja por timeout de `M10View` con
  load 10.9** (O-16) ⇒ repetida sola con load 0.3: **19/19 ×3** (verde; el rojo era carga). Logs en
  `<scratchpad>/orq-verify-a2/`. Capturas de frontend: `<scratchpad>/fe-a2/shots/pawmi-*.png`, `quick-add-*.png`.
- **techlead APROBADO con deuda** sobre `b0af1a42` (leyó el árbol vivo; sin Bash): fichas nuevas **TL-A2-1…5 NO
  anotadas aún en `docs/TECH_DEBT.md`** (O-23 pendiente; texto literal en el transcript, resumen abajo) y TL-ALTA-1
  sigue abierta (ampliar con `useIdsCapture.ts:73,79` y `ids-capture.ts:145,161`).
- `785955b3` arquitecto v1.116.9 (I-6 ratifica dos lecturas fijas y filtros en cliente; IDS-F11 (e) caso del filtro;
  consulta para el dueño) + ux-ui (`admin.drawer.showingFiltered` ratificada; nota «Listas para publicar» en el banner
  del cajón; resumen de éxito con sufijo de acabado). **Esos dos últimos puntos de ux-ui aún NO están en código.**

**Dónde me quedé (lo que murió por el límite semanal):**
1. **frontend «cierre A2b»** (encargo: nota `admin.m1.batchPublishNote` como segunda frase del banner `role="status"`
   tras el alta en el cajón; sufijo del acabado en el resumen de éxito «… · De liga · Promo de Liga (Holo) · INV-…»
   cuando difiere del de la casilla, es/en; y prueba del caso nuevo de IDS-F11 (e) con su mutación). Había empezado a
   escribir las pruebas; **no dejó nada en el árbol** (worktree limpio, borrado). Hay que relanzarlo entero.
2. **QA delta A2** sobre `b0af1a42` (encargo: suites + suite completa + mutaciones (a) y (e) e I-1 N=3; IDS-B32 e
   IDS-B22 con Postgres desechable N=2 + mutación; E2E mocks ×3; censo de pruebas apagadas; juicio del filtrado en
   cliente). Solo alcanzó a arrancar `tsc`. **No hay veredicto de QA sobre A2.**
3. **tester-e2e** sobre el sha final: **no lanzado** (esperaba el cierre A2b).

**Fichas TL-A2 del techlead (sobre `b0af1a42`, dueño frontend salvo la 4 y la 5), para que frontend las anote:**
- TL-A2-1 · modo `choose` sin precio ⇒ `priceInvalid` ⇒ botón `disabled` real (no `aria-disabled`): sin foco ni ayuda
  por teclado, contra DS §16.5(a).0; comentario `QuickAdd.tsx:449-450` falso; E2E `ids-quick-add.spec.ts:277` usa `force`.
  Cierre: en (b) antes de teclear precio `expect(cta()).not.toBeDisabled()` + `aria-disabled="true"`; mutación ⇒ rojo.
- TL-A2-2 · truncado de la segunda lectura no se avisa (`VariantDrawer.tsx:426-427` solo mira la primera) y el tope de
  100 se gasta en piezas que luego se descartan (`:178`); comentario `:136` falso. Cierre: caso con segunda lectura
  `total:150`/`data` 100 ⇒ aviso visible.
- TL-A2-3 · rótulo de versión armado dos veces (`QuickAdd.tsx:137-143` sin sufijo vs `IdsCaptureFields.tsx:105-114` con
  sufijo); `finishPending` calculado dos veces; `altaFinish ?? target.finish` cae en silencio. Cierre: `finishPending`
  en `CaptureModel`; `grep -c "altaFinishMode === 'choose'"` fuera de pruebas/`ids-capture.ts` ⇒ 0; una función de rótulo
  con prueba de que resumen y burbuja coinciden.
- TL-A2-4 (backend) · higiene IDS-B32: `pendingPriceEntry.count({cardId})` sin acotar a la corrida (`:156`); `second.length
  === stampedBefore.length + 2` (`:171`) frágil con restos ≥ 99; comentario `:85` «por FOLIO» miente. Cierre: `createdAt ≥
  startedAt`, ids acotados, comentario real.
- TL-A2-5 (arquitecto → frontend/backend) · `removableCount` aplica filtros Idioma/Liga (`VariantDrawer.tsx:202`) pero
  `bulkRemove` ignora la versión (`inventory.service.ts:4064-4069,4097`): con «Español» activo puede mermar una inglesa.
  Cierre: el contrato decide (cuenta sin filtros, o `bulk-remove` recibe versión); prueba 1 ES + 2 EN.

**Jerga que ux-ui vio en las capturas (texto, sin rediseño; sin dueño asignado aún):** cabecera del cajón repite
«NORMAL» y usa «RAW · NM»; fila de pieza «EN STOCK EN De liga» (el «EN» es el idioma); «Base:» en el precio auto.

## 3 · Lo que está en manos del dueño (no se re-pregunta; se espera)

1. **P-ARQ-IDS-3** (preguntada el 2026-11-05 por chat, sin respuesta): al dar de alta en español o de liga, «Pagamos por
   pieza» **A)** sale vacío y teclea lo que pagó (rige hoy) o **B)** sugerencia calculada por versión (trabajo de backend).
2. Consulta O-24 para saber si alguna casilla pasa de 100 piezas (decide si los filtros del cajón pueden quedarse en
   cliente; está escrita en `docs/API_CONTRACT.md` I-6 v1.116.9). Pegar en Railway → Postgres → Data → Query, sin `;`:
   `SELECT count(*) FILTER (WHERE n > 100) AS casillas_mas_100, max(n) AS max_piezas FROM (SELECT count(*) AS n FROM "InventoryItem" WHERE "productType" = 'raw' AND "ownerType" = 'platform' GROUP BY "cardId", "finish") t`
3. Lo de antes, sin respuesta: capturas de `/admin/marketing`; Stripe → Pagos (MX$4,908.46, TCG-000003); CS-REG;
   CL-1-RESP, DUENO-POST-DYN, P-CTA-7.

## 4 · Siguientes encargos, por orden (todos en `PENDIENTES.md` fila UX-ALTA-LIGA)

1. **frontend, cierre A2b** (worktree; prueba que falla primero; commit acotado): (i) nota «Listas para publicar» en el
   banner del cajón (DS §16.5(b) ~L3099, SU-UX.6(d) ~L29617); (ii) sufijo del acabado en el resumen de éxito (DS §16.5(b));
   (iii) caso/mutación nuevo de IDS-F11 (e) (contrato ~L46021); **y en el mismo encargo** anotar TL-A2-1…5 en
   `docs/TECH_DEBT.md` (O-23; umbral DOC-SIZE 10912: compactar lo no vigente antes de añadir) y ampliar TL-ALTA-1.
   Si TL-A2-1 (botón `disabled` real en modo `choose`) es barato, cerrarlo ahí mismo (es accesibilidad del flujo nuevo).
2. **Orquestador verifica** sobre copia del árbol entero (`git archive <sha>`): tsc, `admin/m1`, una mutación N=3, E2E
   mocks `ids-quick-add.spec.ts` ×3, suite completa (si un rojo es por timeout con load > 8, repetir solo con load baja).
3. **QA delta** sobre el sha final (el encargo de arriba vale tal cual, cambiando el sha) ∥ **techlead** solo si el cierre
   A2b tocó más que los tres puntos. Luego **tester-e2e** contra stack real con semilla (`scripts/stack-native.sh up
   --seed`, `admin@e2e.local` / `Admin123!`, carta «E2E League Bird» #35 en «E2E Base Set», League Cup holofoil): ahora
   debe poder crear Español + De liga (Holo) desde la casilla `normal`, ver la pieza en «Piezas (n)» con la pista, compra
   vacía, y sin toast. **O-16:** máximo dos gates con navegador a la vez; `cat /proc/loadavg` antes.
4. **PR `claude/orquestacion-<fecha>` → `production`** en español llano (qué entra: alta rápida con Idioma/Versión/
   Acabado, piezas de liga visibles en el cajón, Aportación con referencia de la versión, compra vacía en versión no
   default; base de datos: sin migración; revertir: revertir el merge; qué revisar después: Inventario → Master Set →
   una carta con promo de liga → Alta rápida → Español + De liga → la pieza aparece abajo con insignias y la casilla no
   cambia de número). Capturas 390/1280 del tester-e2e en el cuerpo. Suscribirse (`subscribe_pr_activity`). El botón
   es del dueño. Tras fusionar: HECHOS (publicado), PENDIENTES (cerrar fila), HISTORIAL.
5. Después del stream: backlog del §4 anterior (panel de marketing con capturas del dueño; P-PROMOS; SELLADO-IMG; deuda
   §CTA/§IDS; PENTEST registro B; compactar BACKEND_NOTES/API_CONTRACT; llevar O-24 a Dev-team; LECTURA-IMG-7D
   ~2026-11-07; decisión del optimizador para tejas del catálogo con costo al dueño; variante D de la portada NO MEDIDA).

## 5 · Infraestructura medida (para no re-preguntar)

- Railway: Postgres **18.6**; la variable de Resend que desvía el correo (su nombre solo se escribe en `docs/SECURITY_NOTES.md` C.8: el candado `scripts/check-mail-sink-scope.sh` lo prohíbe fuera de `docs/`) **no existe** en production (backend ni frontend); `MEASUREMENT_MODE=on`.
- Vercel: `NEXT_PUBLIC_MEASUREMENT_MODE=on`; GA4 `G-YQCXNY30DY`; píxel Meta `1664829718522685`.
- Backend público: `https://tcg-vault-mx-production.up.railway.app/api/v1/health` (uptime delata cada deploy).
- Stripe en modo real; la tienda ya cobró de verdad (HECHOS 2026-10-16). Claves de PRUEBA en secrets de GitHub
  (`e2e-real.yml` con money gate on). El buzón falso de CI (`scripts/e2e-mail-sink.mjs`) solo existe en e2e-real.
- Tope de altas 5/min por IP: el spec `cuenta-correo.spec.ts` gasta exactamente 5 (TL-CTA-23); añadir una alta rompe CI.
