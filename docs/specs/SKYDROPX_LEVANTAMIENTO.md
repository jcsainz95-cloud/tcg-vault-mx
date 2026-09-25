# Levantamiento: integración de envíos con Skydropx

> **Qué es esto:** insumo para el **product-owner**, no una especificación ni una decisión. Lo redactó el
> orquestador el **2026-09-25** sobre `bb239c0`, a pedido del dueño: *«cómo lo podemos integrar, qué
> capacidades podríamos tener para dejarlo lo más automático posible para el guest checkout y cuando el
> cliente pide retiro de la bóveda»*.
> **Alcance:** los dos flujos que terminan en paquete saliendo de la tienda (compra de invitado con envío
> directo y retiro de bóveda). El buylist (guía que le mandamos al vendedor) se menciona solo como extensión.
> **Antecedente:** `PROJECT.md` D19 (`PROJECT.md:1040-1041`) dejó la integración con paquetería como
> «**proyecto aparte**». Este es ese proyecto.

---

## 0. Resumen en cinco líneas

1. Skydropx PRO tiene API para **cotizar, comprar guía (PDF), cancelarla, asegurarla, rastrear, recibir avisos
   automáticos (webhooks) y programar recolecciones**. Cubre el ciclo entero.
2. Hoy **todo es manual**: tarifa fija de MX$175, el operador compra la guía fuera y teclea paquetería, número
   y costo; los estados «enviado» y «entregado» los mueve a mano.
3. Con la integración, lo único que sigue siendo humano es **empacar y pegar la etiqueta**. Guía, costo real,
   estados, correos y recolección pueden ir solos.
4. Hay **cuatro huecos previos** que no dependen de Skydropx y hay que cerrar primero: **no tenemos peso ni
   medidas** de nada, **no existe dirección de origen**, la **dirección del cliente con cuenta casi no se
   valida**, y **no hay correo de «entregado»**.
5. Recomendación: **fase 1 = guía automática + estados automáticos + costo real**, manteniendo la **tarifa
   fija** al cliente. Tarifa en vivo en el checkout, después y solo si el margen lo pide.

---

## 1. Qué medí y qué no (regla O-1)

| Afirmación | Fuente | Estado |
|---|---|---|
| Recursos de la API (rutas), sandbox `sb-pro.skydropx.com`, OAuth2 client-credentials, token ~2 h, ~2 req/s, prepago | Espejo de terceros de la especificación ([api-evangelist/skydropx](https://github.com/api-evangelist/skydropx)), que declara esas partes **aterrizadas** en la doc oficial | **Fuente secundaria.** Los sitios oficiales (`docs.skydropx.com`, `pro.skydropx.com`) están **bloqueados** por la red de este contenedor. |
| Forma exacta de los cuerpos (campos de dirección, paquete, tarifa) | Mismo espejo, que dice textualmente que los esquemas están **«MODELED … should be reconciled against the live reference»** | **NO MEDIDO.** |
| Cotización asíncrona (`is_completed`, hay que consultar hasta que termine), formato térmico 4×6, seguro con `declared_value`, webhooks con firma HMAC-SHA512 (`X-Skydropx-Signature` + `X-Skydropx-Timestamp`) y lista de eventos | Cliente no oficial [Docxter/Skydropx-API](https://github.com/Docxter/Skydropx-API) | **NO MEDIDO**, y la lista de eventos se ve genérica. **Lo primero que hay que confirmar** en la doc oficial. |
| Todo lo del §2 (cómo funciona hoy) | Código, con `fichero:línea`; los puntos clave los re-medí yo a mano | **Medido** 2026-09-25 sobre `bb239c0`. |

**Lo que cerraría los NO MEDIDOS:** leer la doc oficial en *Conexiones → API* de una cuenta PRO, o abrir
`docs.skydropx.com` en la política de red del entorno, y hacer **una** cotización + **una** guía en sandbox.

---

## 2. Cómo funciona hoy (medido)

| | Compra de invitado (envío directo) | Retiro de bóveda |
|---|---|---|
| Entrada | `POST /checkout/guest/quote` y `/session` (`orders/guest-orders.controller.ts:35-60`) | `POST /shipments/quote` y `POST /shipments` (`shipments/shipments.controller.ts:14-30`) |
| Tarifa | Fija, `shipping_fee_cents` = MX$175 (`settings/settings.constants.ts:290`), en el **mismo cobro de Stripe** que las cartas | La misma tarifa fija + IVA + comisión, **cobro aparte** de Stripe |
| Se crea el envío… | **Después** de que el pago se confirma (webhook de Stripe → `settleDirectShipOrder`, `payments/payments.service.ts:332-433`), ya en `picking` | **Antes** de pagar, en `solicitado`; pasa a `picking` al confirmarse el pago (`payments.service.ts:297-312`) |
| Dirección | Formulario validado: CP de 5 dígitos, teléfono de 10 dígitos, solo México (`orders/dto/guest-checkout.dto.ts:29-46`) | Libreta del usuario: **CP con mínimo 3 caracteres, teléfono con mínimo 7, país libre** (`users/dto/users.dto.ts:45-47`) |
| Correo del destinatario | `Order.guestEmail` | `User.email` |
| Seguimiento del cliente | Enlace con token, 90 días (`pedido?token=…`) | Pantallas `/shipments` y `/vault` |

**Estados** (`shipments.service.ts:553-560`): `solicitado → picking → guia → enviado → entregado`, y
`cancelado`. **Todo avance después del pago es manual** en la pantalla M4 del admin:

- **Guía:** el operador captura paquetería (texto libre), número y costo (`POST /admin/shipments/:id/tracking`).
  **La pantalla nunca manda el IVA del costo** (`shippingCostIvaCents`); solo aparece en un fixture de prueba.
- **Enviado / entregado:** botones manuales (`PATCH /admin/shipments/:id/status`).
- **Correos:** al capturar la guía, al marcar enviado y al cancelar. **No hay correo de «entregado».**

**Lo que no existe** (buscado, sin resultados):

- **Peso o medidas** en ningún modelo (cartas, sellado, inventario).
- **Dirección de origen** de la tienda en ningún ajuste, variable de entorno ni constante.
- **Reembolso ligado al envío.** Cancelar un envío no devuelve dinero ni libera piezas. Un reembolso en
  Stripe de la **tarifa de retiro** no tiene efecto en el sistema (`onChargeRefunded` solo busca `Order`,
  `payments.service.ts:551-555`).

**Infraestructura que se puede reusar:**

- **Webhook de Stripe:** cuerpo crudo, firma, idempotencia por tabla y 503 si falta el secreto
  (`payments/webhooks.controller.ts`). Hoy el cuerpo crudo solo se habilita para la ruta de Stripe
  (`main.ts:47-52`).
- **Jobs:** BullMQ con tareas repetibles (`jobs/scheduler.service.ts`).
- **Ajustes** en `settings.constants.ts`.
- **Secretos por variable de entorno**, con el patrón de `stripe.service.ts:67-93`.

---

## 3. Catálogo de capacidades (qué podríamos tener)

Marcas: 🟢 automático sin tocar · 🟡 un clic del operador · ⚪ sigue manual por naturaleza.

### 3.1 Comunes a los dos flujos

| # | Capacidad | Qué cambia para el dueño | Automatización |
|---|---|---|---|
| C1 | **Guía con un clic** (o sola al pagar, ver §4) | Se acaba comprar la guía fuera y teclear datos. Paquetería, número, costo y PDF se guardan solos. | 🟢 / 🟡 |
| C2 | **Costo real registrado solo**, con su IVA | El P&L por envío deja de depender de lo que se tecleó. Cierra de paso el hueco del IVA que la pantalla nunca manda. | 🟢 |
| C3 | **Etiqueta PDF térmica 4×6** descargable desde la lista de picking | Imprimes todas las del día de una vez. | 🟡 |
| C4 | **Estados por webhook**: recolectado → `enviado`, entregado → `entregado`, incidencia → alerta al admin | Nadie vuelve a mover estados a mano. Las piezas pasan solas a `shipped`/`delivered`/`withdrawn`. | 🟢 |
| C5 | **Correo de «entregado»** (hoy no existe) y de **incidencia** (intento fallido, devolución) | El cliente se entera sin escribirte. | 🟢 |
| C6 | **Historial de rastreo** (eventos con fecha y lugar) en la página del pedido o retiro | Menos «¿dónde está mi paquete?». | 🟢 |
| C7 | **Recolección programada**: una por día con todas las guías del día; antes se consulta si hay cobertura en el CP de origen | No llevas paquetes a sucursal. | 🟢 (tarea diaria) o 🟡 |
| C8 | **Seguro con valor declarado**, automático arriba de un umbral (p. ej. si el pedido vale más de $X) | Protege cartas caras. Cuesta una prima por guía. | 🟢 con regla |
| C9 | **Cancelar la guía** al cancelar un envío que ya tenía guía, y que el saldo regrese a Skydropx | Hoy la guía comprada fuera se pierde o se cancela a mano. | 🟢 |
| C10 | **Saldo prepago visible en el admin** + alerta cuando baje de un mínimo | Sin saldo **no se genera ninguna guía**. Este es el modo de fallo más probable. | 🟢 |
| C11 | **Validar el CP contra cobertura** antes de cobrar | Evita cobrar un envío que ninguna paquetería cubre. | 🟢 |
| C12 | **Reintentos y cola**: si Skydropx no responde, el envío queda «guía pendiente» y una tarea reintenta | El pago del cliente nunca depende de que Skydropx esté arriba. | 🟢 |
| C13 | **Reglas de paquetería**: lista permitida (p. ej. solo Estafeta/DHL/FedEx), y criterio de elección (más barata, más rápida, o la más barata con ≤ N días) | Elimina la elección manual en cada guía. | 🟢 con regla |

### 3.2 Específicas de la compra de invitado

| # | Capacidad | Nota |
|---|---|---|
| G1 | **Guía generada sola al confirmarse el pago** (en `settleDirectShipOrder`, que ya crea el envío en `picking`) | El operador ve la etiqueta lista en la lista de picking. Cuidado con la idempotencia: Stripe reintenta webhooks. |
| G2 | **Rastreo en el enlace con token** (`/pedido?token=…`) con los eventos de C6 | El invitado no tiene cuenta: este enlace es su único canal. |
| G3 | **Tarifa real en el checkout** (fase posterior) | La cotización es **asíncrona** (segundos de espera, NO MEDIDO cuántos). Toca `orders`, IVA y el contrato. Alternativa intermedia: **tarifa por zona o CP** precalculada. |
| G4 | **Validar CP y cobertura en el formulario** | El formulario de invitado ya exige CP de 5 dígitos y teléfono de 10: es el flujo que menos trabajo necesita. |

### 3.3 Específicas del retiro de bóveda

| # | Capacidad | Nota |
|---|---|---|
| V1 | **Endurecer la dirección de la libreta** al nivel del invitado (CP de 5 dígitos, teléfono de 10, país MX) | **Prerrequisito.** Con «CP ≥ 3 caracteres» una cotización puede fallar después de que el cliente ya pagó. |
| V2 | **Guía sola al confirmarse el pago** (paso `solicitado → picking` del webhook) | Igual que G1. |
| V3 | **Seguro por defecto**, porque los retiros suelen ser piezas de valor | La bóveda ya conoce el valor de las piezas. Cuidado: el valor declarado es un dato que sale a un tercero. |
| V4 | **Tarifa real antes de pagar** | Aquí es **más fácil** que en el invitado: el envío se crea **antes** del cobro, así que hay un momento natural para cotizar. |
| V5 | **Reembolso de la tarifa de retiro** si la guía se cancela | Hoy **no existe** ningún camino de reembolso de retiro (§2). Es un hueco previo, no de Skydropx. |

---

## 4. El flujo «lo más automático posible»

```
Cliente paga ─► webhook Stripe ─► envío en picking ─► [tarea] cotiza + compra guía con la regla C13
                                                        │  (si falla: «guía pendiente», reintento C12)
                                                        ▼
        Operador: lista de picking con etiquetas PDF ─► empaca y pega ─► (⚪ lo único manual)
                                                        ▼
        [tarea diaria] recolección con todas las guías del día (C7)
                                                        ▼
        webhook Skydropx: recolectado ─► enviado (correo AV-5) ─► en tránsito ─► entregado (correo nuevo C5)
                                        └─ incidencia ─► alerta al admin + correo al cliente
```

**Decisión de diseño que el PO tiene que presentar al dueño:** ¿la guía se compra **al pagar** (lo más
automático; si el pedido luego se cancela hay que cancelar la guía) o **al empacar**, con un clic (un toque
más, pero nunca se compra una guía de un pedido que no sale)? PROJECT.md D21 ya eligió «comprar solo cuando
es seguro que sale» para el buylist. Es el mismo dilema.

---

## 5. Huecos previos (hay que cerrarlos antes o dentro de la fase 1)

| # | Hueco | Por qué bloquea | Medido |
|---|---|---|---|
| H1 | **No hay peso ni medidas** | Toda cotización pide paquete (largo, ancho, alto, kg). Propuesta para el PO: **empaques estándar** (sobre rígido para 1–N cartas, caja chica, caja de sellado) y elegir empaque según el contenido, en vez de pesar cada pieza. | `grep` de weight/peso/dimension/parcel en `schema.prisma`: 0 |
| H2 | **No hay dirección de origen** | Toda cotización y guía la necesita, igual que la recolección. Es un ajuste de admin. | `grep` en ajustes, entorno y constantes: 0 |
| H3 | **Dirección de la libreta débil** | V1. Además no hay campos separados de número exterior/interior ni referencias; hoy va todo en `line1`/`line2`. Si Skydropx los exige separados es **NO MEDIDO** (§1). | `users/dto/users.dto.ts:45-47` |
| H4 | **Carta Porte (SAT)** | La especificación de terceros menciona códigos SAT de producto y embalaje al crear el envío. Si son obligatorios para paquetería nacional es **NO MEDIDO**. Si lo son, se fijan una vez (cartas coleccionables) como ajuste. | fuente secundaria |
| H5 | **Sin correo de «entregado»** | C5. | `shipments.service.ts:1073-1092` |
| H6 | **Reembolso de retiro no conectado** | V5. Hueco preexistente de `payments`, no de Skydropx. | `payments.service.ts:551-555` |
| H7 | **Los enlaces de los correos de envío llevan a rutas que no existen** (`cuenta/pedidos`, `boveda/envios`). Las reales son `/orders` y `/shipments`, y no hay reescrituras. Al invitado se le manda a «cuenta» aunque no tenga. | Si los estados se automatizan, esos correos salen más y todos llevan a un 404. | `shipment-notice.templates.ts:72-74`; `frontend/src/i18n/routing.ts` sin `pathnames` |

---

## 6. Preguntas para el dueño (que el PO debe cerrar, no asumir)

1. **Tarifa al cliente:** ¿se queda fija en MX$175 y absorbemos la diferencia, o pasamos a tarifa real o por zona?
2. **¿Cuándo se compra la guía?** Al pagar, o al empacar con un clic (§4).
3. **Paqueterías permitidas** y regla de elección: más barata, más rápida, o combinación.
4. **Seguro:** ¿siempre, nunca, o arriba de qué valor? ¿Quién paga la prima?
5. **Recolección** diaria automática, o llevar a sucursal.
6. **Empaques estándar:** cuáles usa hoy y cuánto pesa cada uno con contenido típico (H1).
7. **Dirección de origen** (H2): ¿una sola bodega?
8. **Incidencias:** paquete devuelto o intento fallido, ¿qué hace la tienda? (¿reexpedir con `reexpedir`, reembolsar?)
9. **Cuenta Skydropx PRO:** ¿ya existe? ¿Quién recarga el saldo y con qué alerta?
10. **¿Entra el buylist** (guía que le mandamos al vendedor, D16/D21/D22) en este proyecto o después?

---

## 7. Fases propuestas

| Fase | Contenido | Toca |
|---|---|---|
| **0 · Previos** | H1 empaques, H2 origen, H3 validación de dirección, H5 correo entregado, H7 enlaces rotos | `settings`, `users`, `shipments/mail`, schema |
| **1 · Guía y estados** | C1, C2, C3, C4, C9, C10, C12, C13 + G1/V2 según la respuesta 2 | `shipments`, nuevo cliente Skydropx, webhook nuevo, jobs, schema, contrato |
| **2 · Cliente** | C6, G2, C8/V3, C11/G4 | `shipments`, `orders` (lectura), frontend storefront |
| **3 · Recolección** | C7 | `shipments`, jobs |
| **4 · Tarifa real** (opcional) | G3, V4 | `orders`, `payments`, `pricing` del envío, IVA, contrato |

**Equipo (CLAUDE.md):** product-owner → arquitecto (contrato + schema, regla 9) → backend + frontend en
paralelo, en el stream **«Órdenes y dinero»** (`shipments`, `payments`) → QA + techlead → **fase de
seguridad**. Hay un webhook entrante nuevo con firma, un secreto nuevo y datos personales que salen a un
tercero. Toca dinero, así que lleva **triple veredicto** y modelo fuerte.

**Secretos:** `client_id`/`client_secret` y el secreto del webhook van al almacén de secretos de Railway,
**nunca por chat ni en el repositorio**, que es público (`HECHOS.md`). Para diseñar y probar basta el
**sandbox**.
