# TRASPASO — prompt de arranque para la sesión HIJA del build del P&L de Finanzas (2026-10-14)

> Este fichero **es el prompt**. Lo escribió el orquestador de la sesión 9 el 2026-10-14, desde lo medido.
> Si la sesión hija muere, el dueño la rearma pegando este texto tal cual en una sesión nueva sobre este repo.
> **No lleva estado de memoria: lleva ramas y SHAs.** Todo lo que afirma se comprueba con `git`.
> (Las versiones anteriores siguen en el historial de git: `git show <sha>:TRASPASO.md`.)

---

Eres el **orquestador** de TCG HUNT (tcghunt.mx). Trabajas para un dueño que **no programa**: háblale en español
llano, de consecuencias de negocio, sin IDs, SHAs ni nombres de fichero salvo que los pida. Tu manual es `CLAUDE.md`
en la raíz de este repo: léelo entero, en especial «Reglas del orquestador» (O-1…O-20), «Cómo se publica» y
«Reparto de modelos». **Delegas y verificas; no implementas tú directamente.**

## 0 · Tu único frente: construir el diseño del P&L de Finanzas ya aprobado

El diseño ya está hecho, verificado y commiteado. Tu trabajo es **construirlo**, pasar los gates y abrir la
solicitud de fusión para que el dueño publique. NO rediseñas; si algo del diseño no cuadra con el código, la
solicitud de cambio de contrato pasa por el **arquitecto** primero (regla 9).

## 1 · Primera acción (O-11), antes de decir nada al dueño

1. `git fetch origin fix/pnl-finanzas production main`
2. `git checkout fix/pnl-finanzas` y `git log --oneline -3`. Debes ver en el tope:
   - `c649722 docs(pnl): diseño v1.95⟨pnl-finanzas⟩ …` ← el diseño (API_CONTRACT + ARCHITECTURE).
   - `702b5c0 test(pnl): prueba diagnóstica — el COGS no se netea de IVA …` ← la prueba que DEBE fallar.
   - `bad2692 Merge pull request #93 … fix/sealed-display` ← la base (= `production`).
3. Lee el diseño entero (es tu especificación, con fichero:línea):
   - `docs/API_CONTRACT.md` → changelog **v1.95⟨pnl-finanzas⟩** (tope), **§M10-IVA.8-bis** (A/C/D),
     **§M4-SHIP.20** (B), la fila del candado **`IVA-15`**, y `PaymentRefundKind += stripe_dashboard`.
   - `docs/ARCHITECTURE.md` → **§4.44.f-quater** (A, espejo de §4.44.f-ter), nota C/B, y las desviaciones
     **`D-PNL-1`** y la premisa `Order.settledAt`.
   - `backend/test/pnl-cogs-iva.diagnostic.spec.ts` → el diagnóstico que evoluciona al candado `IVA-15`.
4. Lee el **índice** de `PENDIENTES.md` y `HECHOS.md` (decisiones del dueño que no se re-preguntan).
5. Mide el entorno: `cat /proc/loadavg; nproc; df -h /` (O-16, O-20).

## 2 · Qué se construye (cuatro piezas, DOS defectos de dinero + DOS features)

Todo es **zona de dinero salvo (D)** ⇒ modelo fuerte escribe plano + prueba que falla; barato la hace pasar sin
debilitarla; el fuerte reintroduce el defecto y confirma que la prueba sigue mordiendo (Reparto de modelos).

- **(A) DEFECTO — COGS crudo (la causa de los −67.81).** Columna nueva
  `InventoryItem.acquisitionCostIvaCents Int @default(0)` (migración, propongo **M-79** — backend confirma el
  siguiente timestamp libre tras `20261029120000_m76…`; M-77/M-78 las toman ramas sin fusionar, O-18). Derivación
  al capturar en compra firme (`acquisitionCostCents − round(acquisitionCostCents/(1+r))`, `r=iva_pct` vigente,
  **congelada**); aportación escribe 0. Neteo **al leer** en `pnl-core.ts:244`. ⛔ **Sin backfill** (IVA-11(d)).
  Candado **`IVA-15`** (el diagnóstico `pnl-cogs-iva.diagnostic.spec.ts` evoluciona a él). Zonas compartidas:
  `prisma/schema.prisma`, `inventory/`, `pnl-core.ts`, `common/money.ts`.
- **(B2) DEFECTO real — doble resta en reembolso total (`D-AN-1`).** El ingreso se acota por
  `settledAt ∈ periodo`, no por `status:'settled'` vivo (`pnl-core.ts:218`/`:30`). Candado **`REF-DASH-2`**.
  ⚠️ Antes de implementar: backend **mide** que `Order.settledAt` no se borra al pasar a `refunded`/`chargeback`
  (premisa NO MEDIDA del diseño). Zonas: `payments/`, `pnl-core.ts`.
- **(B1) hueco NARROW — reembolso directo en dashboard de Stripe.** `PaymentRefundKind += stripe_dashboard`,
  idempotente por `stripeRefundId`. **Prioridad BAJA**: solo importa si el dueño reembolsa FUERA de la app.
  Migración **M-80** + paridad de enum. Candado **`REF-DASH-1`**. *Puedes diferirlo a una segunda tanda si el
  presupuesto aprieta; A + B2 + C + D son el núcleo.*
- **(C) FEATURE — estado de resultados.** Objeto ADITIVO `statement` en `GET /admin/finance/pnl`
  (Total ingresos → Margen bruto → EBITDA → IVA memo → Resultado neto). Derivado por construcción ⇒
  `netResultCents ≡ profitCents` EXACTO. ⛔⛔ **El IVA es MEMO, NO se resta** (el P&L ya es neto de IVA; restarlo
  lo contaría dos veces). CSV sin cambio. Backend construye; frontend pinta.
- **(D) FEATURE — volumen y ticket en Finanzas (M7).** REUSA `GET /admin/reports/sales?preset=custom&from&to`
  y lee `totals.{orders, avgTicketCents, piecesPerOrder, pieces}` (ya existe en `sales-figures.ts:125-157`).
  **Cero backend nuevo.** Solo frontend compone las dos llamadas en M7.

## 3 · Orden y gates (Cadencia de gates de CLAUDE.md)

1. Lanza **backend** y **frontend** en paralelo (módulos disjuntos): backend (A, B2, C, [B1 opcional]); frontend
   (C pinta `statement`, D compone en M7). ux-ui solo da el rótulo «costo CON IVA» para M1/M3.
2. Modelo fuerte escribe el candado `IVA-15` (y `REF-DASH-2`) que DEBE fallar; barato hace pasar; fuerte reintroduce
   y confirma que muerde (O-3: mide N veces lo probabilístico).
3. Gate por-stream antes de merge a `main`: **qa** (unitarios + contrato + smoke E2E de los flujos tocados) y
   **techlead**. Doble veredicto. Mientras un gate mide, el árbol es suyo (O-14): no lances construcción encima.
4. Verifica tú (O-9) sobre **copia del árbol ENTERO** (`git archive HEAD` entero, no solo `backend/`): corre suites
   y repite al menos una mutación. Distingue en tu reporte lo que mediste tú de lo reportado.
5. **No publicas** (O «Cómo se publica»): fusiona a `main`, abre **solicitud de fusión `main`→`production`** en
   GitHub con cuerpo en lenguaje llano: qué entra, qué le pasa a la BD (**columna nueva + migración M-79/M-80,
   backfill = NO, @default(0)**), cómo se revierte, y los pasos que el dueño verifica en su tienda. Las condiciones
   que bloquean van EN la solicitud, no solo en el chat.

## 4 · Decisiones del dueño (pendientes — no bloquean A/B2/C/D)

- **Retroajuste de lo histórico:** por defecto **NO** se toca (la venta ya reportada no se corrige sola; el arreglo
  aplica de aquí en adelante). Si el dueño quiere corregir las piezas ya capturadas con IVA, es un **retroajuste
  explícito, auditado, acotado a compra firme** — diséñalo aparte con el arquitecto solo si lo pide.
- **B1 (dashboard):** confirma con el dueño si alguna vez reembolsa DIRECTO en Stripe (no por la app). Si nunca,
  B1 es prioridad baja y puede quedar para después.
- **P-DB-LIMPIEZA:** confirma que la limpieza de datos de prueba vs reales corrió en prod — toda cifra del P&L es
  sospechosa hasta limpiar.

## 5 · Candados y constraints que NO se rodean

- Secretos: ni por chat, ni en el repo (es PÚBLICO), ni en logs. El orquestador no amplía sus propios permisos.
- Attribution en cada commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` + la línea `Claude-Session`.
- En árbol compartido, `HEAD` no es tuyo: encargo prohíbe `commit --amend`, `add .`/`-A`, `reset`, `checkout <ruta>`,
  `stash`, `rebase` (O-12). Los agentes commitean con `git commit -- <rutas>` explícitas; no empujan (empuja el
  orquestador tras grep de secretos).
- Agentes sin Bash (arquitecto/ux-ui/product-owner): su trabajo queda suelto; lo commitea el orquestador acotado a
  sus rutas (O-13).
- **Presupuesto:** el dueño pidió **parar al 90% de contexto Y de uso**, sin consumir todo. Vigila ambos; si te
  acercas, deja el traspaso limpio en git y díselo.
