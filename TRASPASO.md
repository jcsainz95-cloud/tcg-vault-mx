# TRASPASO — Sesión de orquestación (TCG HUNT) · redactado 2026-09-22

Eres el **orquestador** (sesión principal) de TCG HUNT. Este documento te arranca. **No reconstruyas
el estado de memoria: mídelo en git** (O-11). Primera acción: `git status`, `git log --oneline -8`,
`HECHOS.md`, e índice de `PENDIENTES.md`. Cita el SHA de `HEAD` y la fecha de la última limpieza de
`PENDIENTES.md` en tu primer mensaje.

---

## 1. Cómo operamos el dueño y yo (léelo entero, y lee `CLAUDE.md`)

- **Tú delegas, no implementas.** Roles = subagentes `general-purpose` con prompt de rol (o `.claude/agents/*`). Gates: QA + techlead por-stream; pentester + seguridad por-release.
- **El dueño (jcsainz95@gmail.com) es NO técnico.** Háblale SIEMPRE en **español llano**, sin jerga: el «qué» y el «porqué» en términos de su tienda. Nada de ids crudos, nombres de archivo o SHAs en los mensajes al dueño salvo que él los pida.
- **Verificas TÚ lo que toca dinero (O-9)**, sobre copia del árbol ENTERO (`git archive HEAD`), repitiendo al menos una mutación por pase. No aceptas reportes de agentes como verdad.
- **NO fusionas a `production` — el botón es del dueño.** Tú abres la **solicitud de fusión** contra `production` con cuerpo en LLANO: qué entra, qué le pasa a la BD, cómo se revierte, y los pasos que el dueño verifica en su tienda. Las condiciones que bloquean van EN LA PR, no solo en el chat.
- **No hay `gh` en este entorno.** Abre PRs por la API REST: `curl` con `$GH_TOKEN`, header `Content-Type: application/json`, a `https://api.github.com/repos/jcsainz95-cloud/tcg-vault-mx/pulls`. Arma el JSON del cuerpo con `python3` a archivo y `--data-binary @archivo` (¡ojo! los backticks en el cuerpo se rompen si metes el python dentro de comillas dobles de bash — usa heredoc `<<'PY'`).
- **Antes de dar el botón, confirma que el CI de la PR está VERDE** (lección de #56). Suscríbete a la PR (`subscribe_pr_activity`) y re-verifica el estado real por API (los webhooks no entregan el «verde» de forma confiable; agenda un `send_later`).
- **Money zone** (`orders`, `payments`, `pricing`, `buylist`, `inventory`, `vault`, **sellado**, **bounties**): modelo fuerte + gates completos + tu verificación. **Todo cambio de modelo de dinero se DISEÑA primero** (product-owner draft → aprobación del dueño) **antes de construir**.
- **Sube siempre las ramas `claude/*`** (`git push -u origin <rama>`, backoff si falla la red). Subir no despliega; solo el merge a `production` publica (Vercel+Railway auto).
- **PR fusionado = trabajo terminado**: para seguimiento, arranca rama nueva desde `production` (no apiles sobre historia ya fusionada).
- **numReplicas:1** en Railway (un solo worker; jobs BullMQ y disparo admin en el mismo proceso).

---

## 2. Estado en git al traspaso (MÍDELO, esto es solo guía)

- `origin/production` HEAD: **c7c58aa5** (PR #58, trust-source de legalidad de Meta Battle Decks). Fecha: 2026-09-22.
- Última limpieza de `PENDIENTES.md`: bloque **2026-09-22** (este traspaso).
- Ramas vivas relevantes: `claude/decksmeta-publish-now` (PR #59), `claude/m4-pedidos-preparar` (contrato aterrizado), `claude/sealed-pricing-design` (diseño, sesión hija), `claude/handoff-sesion-nueva` (este traspaso).

---

## 3. EN VUELO al momento del traspaso (verifica cada uno con git/PR antes de actuar)

### 3.1 PR #59 — «Publicar ahora» (M12) — VERDE, esperando el botón del dueño
- Rama `claude/decksmeta-publish-now` (`deca05d9`). Botón super_admin en M12 que dispara la publicación inmediata (`POST /admin/jobs/decks-meta-refresh`, ya existía). Solo frontend; sin backend ni contrato.
- **Verificado por el orquestador** (tsc, 16/16 tests M12, i18n 43/43, mutación) y **CI 64/64 verde** en `deca05d9` (un intermitente de `buylist-intake-concurrency` se limpió con un re-run; ver P-BUYLIST-CONC-FLAKE).
- **Acción:** re-suscríbete (`subscribe_pr_activity` #59) y vigila hasta que el dueño lo fusione. URL: https://github.com/jcsainz95-cloud/tcg-vault-mx/pull/59

### 3.2 M4 makeover «Pedidos a preparar» — CONTRATO LISTO, falta CONSTRUIR (rebanada de ENVÍO, sin dinero)
- Rama `claude/m4-pedidos-preparar`. Diseño aprobado 2026-09-15 recuperado (`b5b38d47`). **Contrato de la rebanada de solo lectura aterrizado por el arquitecto (`5c973e6b`, solo docs, cero migración)** en `docs/API_CONTRACT.md §M4-PREP` y `docs/ARCHITECTURE.md §4.21p`.
- **HALLAZGO del arquitecto (importante):** la cola actual `GET /admin/shipments/picking-list` (`shipments.service.ts:543`) proyecta solo `ShipmentRequest{status:'picking'}`, y **todas** esas filas son ENVÍO ⇒ la **cubeta de ENVÍO se sirve completa sin schema**, pero la **cubeta de BÓVEDA está VACÍA hoy**: las órdenes `fulfillmentMode='vault'` NO generan `ShipmentRequest`/cola de preparación. Servir `?destination=vault` **requiere schema + lógica nueva** (una cola de colocación en bóveda) = **seguimiento aparte**, NO reproyección.
- **SIGUIENTE (constrúyelo, cubeta de ENVÍO):**
  1. **backend** reproyecta `GET /admin/shipments/picking-list` al DTO nuevo (enriquecer el `include` con `items.inventoryItem.{card:{set}, location}`; componer `conditionLabel` en el back; derivar `destination`/`lastName`; `?destination=vault|ship` con `400` fuera de dominio; orden `requestedAt` asc). Sin schema, sin dinero.
  2. **frontend** reconstruye M4 como «Pedidos a preparar» (renombre de cara al operador; tarjeta por pedido con destino, cliente+apellido, dirección con calle, carta con nombre/set/acabado/condición/miniatura, ubicación, antigüedad; filtro de las dos cubetas).
  3. Gates QA + techlead. **Tú verificas** (O-9). PR contra `production`.
- **DTO EXACTO aterrizado (cópialo 1:1 a `frontend/src/types/contract.ts`):**
  ```ts
  export type PreparationDestination = 'vault' | 'ship'; // TIPO DE DTO, no enum de dominio
  export interface PreparationOrderDTO {
    shipmentId: string; orderId: string | null; orderNumber: string | null;
    destination: PreparationDestination; requestedAt: string;
    customer: { lastName: string | null; fullName: string };
    shipTo?: { recipientName: string | null; line1: string; line2?: string | null;
      neighborhood?: string | null; city: string; state: string;
      postalCode: string; country: string; phone: string };
    items: PreparationItemDTO[];
  }
  export interface PreparationItemDTO {
    shipmentItemId: string; inventoryItemId: string; folio: string; quantity: number;
    card: { name: string; setName: string | null; finish: Finish;
      conditionLabel: string; imageSmallUrl: string | null };
    currentLocation: LocationView;
  }
  export interface LocationView { kind: 'assigned' | 'unassigned'; label?: string; }
  ```
- **SEGUIMIENTOS (NO en esta 1a PR):** cubeta de BÓVEDA (requiere schema); palomear/firmar preparado (`PATCH …/prep-items`, `POST …/prepared` + columnas `preparedAt`/`preparedByUserId`); sugerencia de bóveda; y 💰 **reembolso parcial** por carta faltante (extender `POST /admin/orders/:id/refund` + `refund-preview` + `partialRefundedCents`; requiere los **3 veredictos** QA+techlead+seguridad y aviso al dueño). Todo en `docs/specs/PEDIDOS_A_PREPARAR_CONTRACT_DRAFT.md §2–§7`.

### 3.3 Sesión hija `session_01QBuT3Vv2gkt9sXioNTBLrp` — DISEÑO precio de sellado
- Produce un borrador de producto (product-owner) para el nuevo modelo de precio de sellado y abre una **PR de solo-diseño** (rama `claude/sealed-pricing-design`, «no fusionar») con **5 preguntas** para el dueño.
- Lo que pidió el dueño (2026-09-22): al **dar de alta** el sellado, teclear **costo** y **precio de venta** directos; **mercado solo como referencia**; **precio distinto por colección/formato**; **abandonar** el panel de spreads (mercado × margen).
- Hechos medidos: `acquisitionCostCents` (schema:851) y `manualMarketMxnCents` (alta de sellado) YA existen; hoy el precio manual solo aparece si NO hay mercado; `sealedProductId` = set+presentación.
- **Acción:** cuando el dueño conteste las 5 preguntas en la PR, enruta a arquitecto → backend/frontend (MONEY ZONE: gates completos + tu verificación). Ver P-SELLADO-PRECIO en `PENDIENTES.md`.

---

## 4. Pendientes registrados esta sesión (ver `PENDIENTES.md`, bloque 2026-09-22)

`P-M4-PREP`, `P-SELLADO-PRECIO` (💰), `P-SELLADO-REPRECIO`, `P-FONTS-CJK`, `P-BUYLIST-CONC-FLAKE`.
**Obsoletos** (no re-enrutar): `P-LEG-CAUSE`, `P-LEG-AUTODERIVE`, `P-API-DOC` (standard-legality) — PR #58 retiró el gateo de legalidad.

---

## 5. Próximos pasos sugeridos (en orden)

1. Re-suscríbete y vigila **PR #59** (verde; espera el botón del dueño).
2. Construye **M4 rebanada de ENVÍO** desde el contrato aterrizado (`claude/m4-pedidos-preparar`, `5c973e6b`) → gates → tu verificación → PR.
3. Al despertar el dueño: revisa con él la **PR de diseño de precio de sellado** (5 preguntas) y arranca ese stream (money zone) con sus respuestas.
4. Si hay capacidad: **P-FONTS-CJK** (fix de fuentes CJK, no dinero) y **P-BUYLIST-CONC-FLAKE** (estabilizar la prueba de concurrencia).
