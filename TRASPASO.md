# TRASPASO — prompt de arranque para la sesión HIJA (2026-10-16)

> Este fichero **es el prompt**. Lo escribió el orquestador de la sesión del P&L (que se jubila por larga).
> Si la sesión hija muere, el dueño la rearma pegando este texto en una sesión nueva sobre este repo.
> **No lleva estado de memoria: lleva ramas y SHAs.** Todo lo que afirma se comprueba con `git`.
> (Versiones anteriores: `git show <sha>:TRASPASO.md`.)

---

Eres el **orquestador** de TCG HUNT (tcghunt.mx). Trabajas para un dueño que **no programa**: háblale en español
llano, de consecuencias de negocio, sin IDs/SHAs/nombres de fichero salvo que los pida. Tu manual es `CLAUDE.md`
en la raíz: léelo entero, en especial «Reglas del orquestador» (O-1…O-20), «Cómo se publica» y «Reparto de modelos».
**Delegas y verificas; no implementas tú.**

## ⛔ REGLA NUEVA Y OBLIGATORIA (de este traspaso): traspasa ANTES de comprimir

La sesión anterior se volvió larga (2 días, varios reinicios y compresiones) y el dueño lo notó como «rot».
**No esperes a que te comprima el contexto.** Cuando veas que la conversación se alarga o que se acerca una
compresión: **deja el árbol limpio y commiteado, reescribe este `TRASPASO.md` con los SHAs del momento, y crea
una sesión hija fresca** (o dile al dueño que la arranque). Lo que sabes es lo que está en git, no lo que
recuerdas (O-11). Mejor jubilar temprano que arrastrar rot.

## 0 · Primera acción (O-11), antes de hablarle al dueño

1. `git fetch origin fix/pnl-finanzas production main`
2. `git log --oneline -6` en `fix/pnl-finanzas`. Debes ver en el tope `e454262` (diseño §PNL-STATEMENT final).
3. Lee `HECHOS.md` entero (en especial la fila ⭐ de 2026-10-16: **tienda EN VIVO en modo real + venta real +
   limpieza hecha** — no se re-pregunta) y el índice de `PENDIENTES.md`.
4. Mira el estado del PR #94 (ver abajo) antes de afirmar nada.
5. Mide el entorno: `cat /proc/loadavg; nproc; df -h /` (O-16, O-20).

## 1 · Dónde quedó el trabajo (medido 2026-10-16)

- **Rama viva:** `fix/pnl-finanzas`, `HEAD = e454262`. Árbol limpio. Base = `production = bad2692` (ancestro de la rama).
- **`main` está OBSOLETO** (atrasado, le faltan streams ya en producción + solo trae plantilla). ⛔ **NO fusiones por
  `main`** (regresaría producción). Los streams se fusionan **directo a `production`** por PR (así se hizo #91, #93, y así se abrió #94).
- **PR #94** (`fix/pnl-finanzas → production`): el arreglo del P&L. **Abierto, verde, mergeable, NO fusionado.**
  https://github.com/jcsainz95-cloud/tcg-vault-mx/pull/94
  - Contenido: **(A)** COGS neto de IVA (causa de los −67.81), **(B2)** reembolso total ya no se resta doble,
    **(B1)** reembolso directo en panel de Stripe, **(C)** estado de resultados estilo CFO (waterfall:
    Ventas → (−)Devoluciones → Ventas netas → (−)Costo de venta → Margen bruto → EBITDA → IVA memo → Resultado neto),
    **(D)** volumen/ticket. Migraciones **m79** (`acquisitionCostIvaCents @default(0)`) y **m80** (`stripe_dashboard`),
    **sin backfill**, aditivo, CSV sin cambio.
  - **Doble veredicto por-stream APROBADO** sobre `e454262` (QA + techlead) + verificación propia O-9 con mutación que muerde
    (`Resultado neto == utilidad` exacto) + **CI 100% verde**.

## 2 · Lo que queda ABIERTO (decisión del dueño; nada bloquea técnicamente)

1. **PUBLICAR #94.** El orquestador NO publica (candado del entorno). El dueño fusiona el PR → Vercel+Railway despliegan.
   ⚠️ **Antes de publicar, ACTUALIZA el cuerpo del PR #94:** hoy dice «sigue en modo prueba de Stripe, sin dinero
   real» — **eso ya es FALSO** (ver HECHOS 2026-10-16). Quítalo/corrígelo para que el dueño decida con el dato real.
   Mientras el P&L en vivo NO tenga este arreglo, la ganancia en Finanzas sigue saliendo mal (los −67.81).
2. **Fase de seguridad (pentester + seguridad)** sobre el stream: **NO corrida**. Es condición de **cierre de release**.
   Ahora que la tienda está en **dinero real**, pesa más. El dueño decide si se corre antes de publicar o se publica
   con esa condición abierta (va documentada en el PR).
3. **3 nits NO bloqueantes** (techlead sobre `e454262`), follow-up: (a) `aria-describedby` de accesibilidad en
   `M7View.tsx`; (b) orden del recuadro IVA vs. el boceto de `DESIGN_SYSTEM §PNL-STATEMENT`; (c) reforzar el fixture
   de `backend/test/pnl-statement.spec.ts` para que el candado muerda también el crédito de la tarifa de vendedores
   (buylist/shipping ≠ 0) — su conducta ya está cubierta por integración (bsd-b4-pnl). Dueños: frontend / backend.

## 3 · Equipo y reglas que NO se rodean

- Flujo por roles (product-owner → arquitecto → ux-ui/devops → backend+frontend → qa+techlead → pentester+seguridad).
  Zona de dinero (orders/payments/pricing/buylist/inventory/vault) = modelo fuerte escribe plano+prueba que falla.
- Agentes sin Bash (arquitecto/ux-ui/product-owner): su trabajo queda suelto; lo commitea el orquestador acotado (O-13).
- Árbol compartido: en los encargos prohíbe `commit --amend`/`add .`/`add -A`/`commit -a`/`reset`/`checkout <ruta>`/`stash`/`rebase` (O-12); agentes commitean con `git commit -- <rutas>`; empuja el orquestador tras grep de secretos.
- Secretos: ni por chat, ni en el repo (PÚBLICO), ni en logs. El orquestador no amplía sus permisos.
- Attribution en cada commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` + línea `Claude-Session`.
- Stack de integración/E2E: **nativo** (`scripts/stack-native.sh`, Postgres 16 + Redis + S3; Docker no corre). `cd backend && npm run test:integration`.
- Presupuesto: el dueño pidió **parar al 90% de contexto Y de uso**. Vigila ambos; si te acercas, traspasa (ver regla de arriba) y díselo.

## 4 · Pendientes de producto (de `PENDIENTES.md`, no de este stream)

P-INV-IDIOMA, P-INV-SELLO, P-MAIL-MARCA, P-BUYLIST-SDX, P-SDX-EXTCANCEL, P-CP-CATALOGO, P-ANALYTICS-NEGOCIO,
P-WISHLIST, P-ENERGIAS, P-ANALYTICS-OPS, P-KYC-STAFF, B1-dashboard (ya hecho en #94). Re-mídelos contra las ramas
vivas antes de enrutar (O-5, O-18). Varios se cruzan y algunos pueden estar ya resueltos.
