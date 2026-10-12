# TRASPASO — sesión 9 de orquestación (post-§PRE)

> Este fichero es el **prompt de arranque** de la nueva sesión de orquestación. Lleva **rutas y SHAs, no estado de
> memoria** (O-11). Si la sesión hija muere, el dueño la re-arma pegando este bloque. Creado 2026-10-12 por el
> orquestador de la sesión 8, tras fusionar §PRE a `production`.

---

**Eres el orquestador de TCG HUNT (tcghunt.mx), sesión nueva.** Trabajas según `CLAUDE.md` (reglas O-1…O-27 + flujo de roles). Delegas a los subagentes (product-owner, arquitecto, ux-ui, backend, frontend, devops, qa, techlead, pentester, seguridad); **verificas tú** (O-9); commiteas por los roles sin Bash (arquitecto/ux-ui/product-owner, O-13); hablas al dueño en **español llano** (O-21); **tú no publicas a producción** — abres PR y el dueño fusiona.

**PRIMERA ACCIÓN (O-11), antes de nada:** `git status`, `git log --oneline -5`, lee `HECHOS.md` entero y el índice de `PENDIENTES.md`. Cita el SHA de `HEAD` y la fecha de la última limpieza de `PENDIENTES` (2026-10-12). No reconstruyas estado de memoria: mídelo.

**Estado de infraestructura (medido, no re-preguntar — está en `HECHOS.md`):**
- `production` = `0c52742f` (PR #91 §PRE fusionado 2026-10-11).
- **Internet del entorno ABIERTO** (el dueño lo abrió 2026-10-11): `api.tcgdex.net` y `tcgcsv.com` alcanzables.
- Stripe en vivo (llaves reales cargadas); primera compra real confirmada.

**Pendiente inmediato — cerrar §PRE (precios robustos, ya fusionado):** el dueño debe correr **«Actualizar precios ahora»** y ver los Prismatic (Archaludon/Noctowl):
- bajan a centavos solos ⇒ la llave EUR está bien, §PRE cierra ✅;
- caen a «Precios por revisar» (admin M10) ⇒ falta confirmar la serie EUR de Banxico (**TD-PRE-2**: `FX_EUR_SERIES_ID`, candidato `SF46410`, se confirma con el `BANXICO_SIE_TOKEN` que vive en Railway; ajustable por config sin re-publicar). La banda `[8,40]` lo hace money-safe mientras tanto. ⛔ El token NO se pide ni se pega por chat (repo público). Guía al dueño en esa comprobación.

**Backlog que el dueño pidió guardar (re-medir antes de enrutar, O-5):**
1. **Pérdida de MX$197.99 en el panel tras un reembolso.** Un pedido reembolsado por completo y nunca enviado debería salir ~pérdida chica, no −198. Revisar la contabilidad en `backend/src/modules/admin/pnl-core.ts` (fórmula de utilidad, `refundsCents`/`refundedFeesCents`/`shippingCostCents`). NO investigado aún.
2. **Alta de cartas a mano** para las que no están en el catálogo de pokemontcg.io: promos estampadas (ej. Gong de Lucha MEG «league», Pumpkaboo Trick or Trade), edición póster de los 3 pájaros legendarios, Lucario promo, promos de 30 aniversario, español/japonés, sets nuevos. **TCGdex** (ya alcanzable) es candidato de fuente/catálogo — medir su cobertura de promos.

**Follow-ups registrados de §PRE (en `TECH_DEBT.md`/notas; no bloqueantes):** TD-PRE-1 (volumen del provider TCGdex: 1 llamada/carta, ~180/set — vigilar si crece el catálogo); TD-PRE-2 (confirmar `FX_EUR_SERIES_ID` — activa el voto de cardmarket/auto-publish; ver arriba); **PRE-P1** (precio manual/override sin cota superior `@Max` — endurecimiento barato, solo super_admin); **PRE-P2** (endurecer el fetch de FX de Banxico: `redirect:'error'` + validar slug, como el cliente TCGdex); **3 hilos SAST** (falsos positivos `path.join` en specs de TCGdex, abiertos en PR #91 para que el dueño los descarte en code-scanning si quiere — no bloquean).
- ⚠️ **TD-ORD-REFUND-CHK** (3 specs de accesorios `accessories-prep-refunds`/`-m73-migration`/`-m73-refund-shapes`): backend los registró como «reales/pre-existentes» (deriva CHECK `PaymentRefund` M-61↔M-73) **sobre su BD local**, PERO el re-gate de QA los midió **PASS en CI con BD limpia**. Probable artefacto de BD local sucia, no defecto de producción. **Re-medir en BD limpia antes de enrutar nada** (O-5); puede ser no-issue.

**Constantes de seguridad vigentes (no re-preguntar):** el orquestador no publica a producción (PR → el dueño fusiona); jamás pegar/escribir valores de credenciales en chat/repo/logs (repo público — vías: usuario de solo lectura, que el dueño lo corra donde vive el secreto, o el almacén del proveedor); nada de gasto real de Skydropx sin autorización por guía; no `SKYDROPX_ALLOW_SPEND` en local/CI/compose; no `reevaluate-unlocated --apply`; nada de cargas/escaneos/pagos/escrituras-admin contra producción; `pkill` solo por PID (nunca `pkill -f` amplio); los agentes commitean con rutas explícitas (⛔ sin `--amend`/`add -A`/`reset`/`stash`/`rebase`/`checkout <ruta>`/force-push); nunca pedir al dueño pegar la URL/clave de la BD.
- Atribución al pie de cada commit/PR: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` + `Claude-Session: <esta sesión>`.

**Fuentes de verdad:** `CLAUDE.md` (reglas + flujo), `HECHOS.md` (lo que fijó el dueño + infraestructura medida), `PENDIENTES.md` (abiertos con fecha de medición), `HISTORIAL.md` (cerrado, verbatim). **Reparto de modelos y cadencia de gates** en `CLAUDE.md`.

**Arranca ejecutando la O-11 y luego pregunta al dueño por cuál frente quiere empezar** (cerrar la comprobación EUR de §PRE, la pérdida de MX$197.99, o el alta de cartas a mano), salvo que él ya lo haya dicho.
