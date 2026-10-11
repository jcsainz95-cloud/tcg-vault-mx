# Levantamiento: integración de envíos con Skydropx

> **Qué es esto:** insumo para el **product-owner**, no una especificación ni una decisión. Lo redactó el
> orquestador el **2026-09-25** sobre `bb239c0`, a pedido del dueño: *«cómo lo podemos integrar, qué
> capacidades podríamos tener para dejarlo lo más automático posible para el guest checkout y cuando el
> cliente pide retiro de la bóveda»*.
> **Alcance:** los dos flujos que terminan en paquete saliendo de la tienda (compra de invitado con envío
> directo y retiro de bóveda). El buylist (guía que le mandamos al vendedor) se menciona solo como extensión.
> **Antecedente:** `PROJECT.md` D19 (`PROJECT.md:1040-1041`) dejó la integración con paquetería como
> «**proyecto aparte**». Este es ese proyecto.

> ⚠️ **Re-medido contra producción el 2026-09-29** (`a2da420`, 1277 commits por delante de `bb239c0`, sobre el que
> se escribieron §2–§9). **§11 manda sobre todo lo anterior**, y ahí están las tres correcciones.

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
| C13 | ~~Elección automática~~ **SUSTITUIDA el 2026-09-29: la elige el operador (§11.5 F3).** Queda como **preferencia preseleccionada**. **Reglas de paquetería**: lista permitida (p. ej. solo Estafeta/DHL/FedEx), y criterio de elección (más barata, más rápida, o la más barata con ≤ N días) | Elimina la elección manual en cada guía. | 🟢 con regla |

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
(⚠ SUSTITUIDO el 2026-09-29 por §11.5 F3: la guía se cotiza y se elige a mano al preparar)
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
2. ~~**¿Cuándo se compra la guía?** Al pagar, o al empacar con un clic (§4).~~ **Respondida el 2026-09-29:** al preparar, eligiendo el operador la opción en la plataforma (§11.5 F3).
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

---

## 8. Contraste con la referencia oficial (añadido 2026-09-29)

> El dueño entregó una referencia compilada de la doc oficial, guardada tal cual en
> `docs/specs/SKYDROPX_API_REFERENCIA.md`. **Esta sección manda sobre §1–§5 donde choquen.** El orquestador no
> la contrastó contra la fuente (la red sigue bloqueando los dominios de Skydropx). Lo que se afirma del
> **código** sí está medido, sobre `2e587e8`.

### 8.1 Lo que la referencia confirma

- **Flujo:** cotizar (asíncrono, se consulta hasta `is_completed`) → elegir tarifa → crear envío. El envío
  descuenta créditos. Es el flujo del §4.
- **Límites y acceso:** token de 2 h, 2 req/s, sandbox en `sb-pro`.
- **Seguro:** `package_protected` + `declared_value`, al cotizar o después con `/protect` (C8/V3).
- **Cancelación** (C9), **saldo** (C10), **sucursales** (`/office_points`) y **cobertura de recolección** (C7).
- **Cargos extra con endpoint propio** (`/finance/extra-charges`, p. ej. `ExtraCharge::Overweight`). Hacen
  falta en el P&L (§9).
- **Carta Porte: el hueco H4 es REAL.** `consignment_note` (código SAT del contenido) y `package_type`
  (código de empaque) van en cada paquete y **«suelen ser obligatorios en la práctica»**. Se eligen una vez del
  catálogo (`GET /shipments/consignment_notes`, `/packagings`) y quedan como ajuste.
- **Dirección de origen como plantilla** (`address_templates`, `address_type: from`). Resuelve H2 del lado de
  Skydropx; nosotros guardamos su `id` en un ajuste.

### 8.2 Lo que la referencia corrige o agrega

| # | Hallazgo | Consecuencia para nosotros | Medido en código |
|---|---|---|---|
| R1 | **La colonia (`area_level3`) y el municipio (`area_level2`) son OBLIGATORIOS al cotizar.** | **Nuestra colonia es OPCIONAL** en el invitado y en la libreta. Un pedido sin colonia **no se puede cotizar**, y el cliente ya pagó. Hay que **volverla obligatoria** (H3 crece). `city` hace de municipio: hay que verificar que el cliente escriba ahí el municipio (en CDMX, la alcaldía) y no «CDMX». | `orders/dto/guest-checkout.dto.ts:31` y `users/dto/users.dto.ts:42` (`@IsOptional() neighborhood`); `schema.prisma:569` (`neighborhood String?`) |
| R2 | El destino exige `street1`, `name`, `company`, `phone`, `email`. `reference` y `further_information` (≤70, se imprime en la guía) son opcionales. | `company` no existe en nuestras direcciones; se llena con el nombre del destinatario. El `email` sale de `guestEmail` o `User.email`. **No hacen falta campos separados de número exterior/interior**: en MX el número va dentro de `street1`. Eso cierra la duda de H3. Campo nuevo **opcional**: «referencias» para el repartidor. | §2 de este documento |
| R3 | **El origen exige `reference`, `email`, `company`** y admite RFC. | Van en la plantilla de origen: se capturan una vez. | — |
| R4 | **Las tarifas valen 24 horas.** | Invitado: se liquida en minutos, así que da tiempo. Retiro: el envío se crea antes del pago y el pago puede tardar, así que **si la tarifa venció, se recotiza** y la guía puede costar distinto de lo cotizado. Hay que decidir quién absorbe esa diferencia. | — |
| R5 | **La guía puede generarse asíncrona**: `master_tracking_number` llega `null` y aparece después. Los errores llegan en `error_detail`. | Estado intermedio **«guía en proceso»** en nuestro sistema. Hoy `guia` exige paquetería y número juntos (`setTracking`). No se puede marcar `guia` hasta tener el número. | `shipments.service.ts` `setTracking` |
| R6 | **`POST /rate/shipments`: crear guía SIN cotizar**, con paquetería y servicio fijos. | El camino **más automático**: con una regla «siempre Estafeta Terrestre», la guía sale en una sola llamada al pagar. Se pierde comparar precios. | — |
| R7 | **Estados de rastreo documentados:** `created`, `picked_up`, `in_transit`, `last_mile`, `delivery_attempt`, `delivered_to_branch`, `delivered`, `exception`, `in_return`, `canceled`, `destroyed`, `retained`. | Mapeo propuesto en §8.3. Cinco de ellos (intento, sucursal, excepción, devolución, retenido/destruido) **no tienen estado en nuestro sistema**. | `schema.prisma:177-184` |
| R8 | **Webhooks: payload, eventos y firma NO documentados** en la referencia. | La firma HMAC-SHA512 del §1 viene de un cliente no oficial y **sigue sin confirmar**. **No se implementa el webhook sin la doc oficial.** Mientras, **polling** con `GET /shipments/{id}` desde una tarea programada: con 2 req/s alcanza de sobra para nuestro volumen (**NO MEDIDO**: volumen diario real). | — |
| R9 | **Recolecciones: cuerpo de la petición no documentado** en la referencia. | C7 queda en fase 3 hasta tener la doc. | — |
| R10 | **`external_shipments`**: registrar en Skydropx guías hechas FUERA de Skydropx, para rastrearlas. | Transición: las guías que el operador aún haga a mano también ganan rastreo automático. | — |
| R11 | **Host dudoso**: la doc menciona `api-pro.skydropx.com`, pero los ejemplos usan `pro.skydropx.com`. | La URL base va en variable de entorno, nunca fija en el código. | — |
| R12 | **La API clásica se apaga en abril de 2026** (ya pasó). | Cualquier ejemplo con `Authorization: Token token=` se descarta. | — |

### 8.3 Mapeo de estados propuesto (para el arquitecto; no decidido)

| Skydropx | Nuestro `ShipmentStatus` | Qué más pasa |
|---|---|---|
| `created` | `guia` (cuando ya hay número) | Correo de guía (ya existe) |
| `picked_up`, `in_transit`, `last_mile` | `enviado` | Correo de salida (ya existe); piezas `picking → shipped` |
| `delivered` | `entregado` | Piezas `delivered`/`withdrawn`; **correo nuevo** (H5) |
| `delivered_to_branch` | **No** pasa a `entregado`. Estado o hito nuevo: lo decide el arquitecto | **Decidido 2026-09-29:** correo aparte «tu paquete está en sucursal» |
| `delivery_attempt` | sin cambio | Correo al cliente + alerta al admin |
| `exception`, `retained` | sin cambio | Alerta al admin |
| `in_return`, `destroyed` | sin cambio | Alerta al admin. **Decisión:** ¿reexpedir o reembolsar? (pregunta 8) |
| `canceled` | `cancelado` solo si lo canceló la tienda | Si lo canceló la paquetería, alerta |

### 8.4 Lo que sigue sin confirmar y cómo se cierra

| Qué | Por qué importa | Cómo se cierra |
|---|---|---|
| Nombre del campo de precio de la tarifa, y **si el `total` trae IVA incluido** | Sin eso no se puede calcular el IVA del costo para el P&L (§9) | Una cotización real en sandbox, o la colección OpenAPI oficial |
| Webhooks: eventos, payload y firma | R8 | Colección OpenAPI oficial (referencia §9: botón «Copiar URL de la colección») |
| Cuerpo de recolecciones | R9 | Ídem |
| Si la recolección cuesta | Pregunta 5 | Panel de Skydropx o soporte (api@skydropx.com) |
| Qué código Carta Porte corresponde a cartas coleccionables | H4 | `GET /shipments/consignment_notes` en sandbox, o el contador |

---

## 9. El dinero del envío: P&L y lo que ve el operador (añadido 2026-09-29)

**Hoy** (medido sobre `2e587e8`):

- **Ingreso** (lo que cobramos): en el retiro, `ShipmentRequest.shippingFeeCents`. En el invitado vive en el
  **pedido** (`Order.shippingFeeCents`) y la fila del envío lleva 0 a propósito.
- **Costo:** `shippingCostCents` (bruto, IVA incluido) − `shippingCostIvaCents` (IVA acreditable) = costo neto.
- **P&L:** resta ingreso neto contra costo neto, y cuenta aparte los envíos sin costo capturado
  (`admin/admin.service.ts:1519-1551`; `common/money.ts:740-752`).

| # | Defecto actual | Efecto | Medido |
|---|---|---|---|
| D1 | La pantalla M4 **nunca manda `shippingCostIvaCents`** | El P&L resta el costo **con IVA** como si fuera neto ⇒ **ganancia subestimada** ≈ 13.8 % del costo por envío (16/116) | `M4View.tsx:134-135` (solo manda `shippingCostCents`) |
| D2 | M4 **no muestra cobrado ni margen** del envío | El operador no ve si una guía le hace perder dinero. El servidor sí manda los datos (`toAdminShipmentRow`), pero la pantalla no los pinta. En el invitado el cobrado está en el pedido. | `shipments.service.ts:55-79`; `M4View.tsx` (sin `shippingFee`/`totalCents`) |
| D3 | **No hay ajuste de costo posterior** | Un cargo extra (sobrepeso) de Skydropx no tiene dónde caer ⇒ P&L corto | `schema.prisma` `ShipmentRequest` (un solo costo) |

**Con Skydropx (propuesta para el PO):**

1. Al comprar la guía, el costo y su IVA se guardan **solos** desde la respuesta de Skydropx. Eso cierra D1,
   pero depende de §8.4: saber si el `total` trae IVA.
2. En M4, antes de confirmar la guía: **cobrado al cliente · costo de la guía · seguro · margen**, con alerta
   si el margen sale negativo (D2).
3. Una **tarea diaria** lee `/finance/extra-charges` y los suma al costo del envío como **ajustes** con
   fecha propia. Así el P&L del mes en que llegó el cargo lo refleja (D3; decisión contable del dueño: ¿el
   ajuste cae en el mes del envío o en el mes del cargo?).
4. **Preguntas nuevas para el dueño:** (11) ¿el cargo extra se le cobra al cliente o se absorbe? (12) ¿en qué
   mes cae el ajuste? (13) si la tarifa del retiro venció y la guía sale más cara (R4), ¿quién absorbe?

---

## 10. Resultados de la prueba en el panel (añadido 2026-09-29)

> **Fuente:** `SKYDROPX_PRUEBA_PANEL_RESULTADOS.md`. Lo midió una sesión de Claude en el Chrome del dueño,
> **2026-09-28, 23:10–23:34 CST**, con la cuenta de producción. Solo cotizó. **El orquestador no repitió la
> medición**: lo de abajo es análisis de esos datos. Donde hay una cuenta, el orquestador la rehízo.

### 10.1 Lo que queda medido

| # | Hallazgo | Consecuencia |
|---|---|---|
| M1 | **Los precios traen el IVA incluido** («Incluye IVA»; nunca «+ IVA»). El desglose da la línea de IVA: Paquetexpress $51.25 = envío $50.00 (IVA $6.90 dentro) + gestión $1.25. | **Cierra §8.4 (panel).** El IVA es exactamente 16/116 del envío más el combustible, **sin** la tarifa de gestión. Cuenta del orquestador: 50 × 16/116 = 6.90 ✓ y (52.11 − 1.27) × 16/116 = 7.01 ✓. Para el P&L: `shippingCostCents` = total pagado y `shippingCostIvaCents` = la línea de IVA, **si la API la expone**. Que la API la dé es **NO MEDIDO**. Si no la da, hay que calcularla con esa regla. |
| M2 | **Peso mínimo 1 kg y solo kilos enteros** (panel). | El sobre de cartas (≈0.3 kg) **se cobra como 1 kg de todos modos**. **H1 se simplifica:** no hace falta pesar cartas; basta con **empaques estándar** de peso fijo. La API acepta decimales según la referencia (**NO MEDIDO** si redondea). |
| M3 | **El tipo de empaque es obligatorio desde la cotización y cambia el resultado.** ampm solo aparece con «Caja de cartón». | El empaque se decide **antes de cotizar**. Cada empaque estándar lleva su código de empaque de Skydropx. |
| M4 | **No hubo zona extendida en ningún destino**, ni en San Cristóbal (13 servicios revisados). | Riesgo bajo de cargos por zona en destinos urbanos. **NO MEDIDO** en zonas rurales de verdad. |
| M5 | **Los 10 CPs se aceptaron** y el panel ofrece las **colonias de cada CP**, por ejemplo 16 en 77500. | **Refuerza R1:** la colonia debe ser obligatoria y conviene **elegirla de una lista por CP**, no escribirla a mano. Con texto libre, «Centro» contra «Cancún Centro» puede no cuadrar. |
| M6 | **SOS Protección está activada «Automáticamente para todos los envíos»** en la cuenta: **+$25.00 por guía**, casi 50 % sobre $51.25. | **Decisión del dueño (pregunta 4).** Hoy cada guía del panel cuesta $76.25 y no $51.25. Si ese ajuste de cuenta aplica también a las guías creadas por API es **NO MEDIDO**. Si aplica, la regla de seguro por valor (C8) no se cumpliría. |
| M7 | **La recolección depende del servicio, y el dato «con/sin recolección» cambió en minutos** para el mismo destino. J&T, Imile y Yaslan la dan solo «vía soporte» y con mínimos (5, 15 y 10 paquetes). J&T «Sin recolección», 99minutos y PuntoPost son **solo sucursal**. | La regla de paquetería debe **filtrar por «con recolección»** si no quieres vueltas. **No se puede confiar en una lista fija:** el sistema debe leer ese dato **en cada cotización**. Si la API lo expone es **NO MEDIDO**. |
| M8 | **PuntoPost a $1.19 es de sucursal a sucursal**: el destinatario lo recoge en un punto. | **Queda fuera** del envío a domicilio que se promete al invitado y en el retiro (`PROJECT.md` v1.5: «envío directo a domicilio»). El precio de $1.19 es anómalo (¿promo o error?) y **no se usa para decidir nada**. |

### 10.2 Lo que la prueba NO permite decidir todavía

**Los precios están distorsionados por una promoción** («50 envíos a $50 MXN c/u»). Paquetexpress, J&T y ampm
salieron **idénticos, $51.25**, para el sobre de 1 kg y la caja de 5 kg, y para CDMX y Tijuana por igual. Eso
no es una tarifa: es la promo. La regla de paquetería del §3 (C13) se decidía por **cuánto cambia el precio
entre paqueterías y destinos**, y esa variación **no se midió**. Referencias fuera de la promo que sí se vieron:
FedEx Express Saver **$52.11–$52.96** con 2 a 8 días, e Imile Express **$85.61** con 2 días.

**Mientras dure la promo** (50 envíos), el precio es igual en todas, así que lo que decide es **tiempo y
recolección**:

| Servicio | Días (medidos) | Recolección | Para nosotros |
|---|---|---|---|
| ampm · Plataformas | **1–2** en el centro del país; 3–7 en sur y norte | Sí, al día siguiente; solo con caja | El más rápido en el centro |
| Paquetexpress · Nacional | 3–5 | Sí (casi siempre) | El más parejo: entre las 3 más baratas en 9 de 10 destinos (en MTY no, **NO MEDIDO** si ahí salía) |
| FedEx · Express Saver | 2–8 | Sí | +$1–2 por combustible |
| J&T · Sin recolección | 6 | **No**, hay que llevarlo | Descartar si no quieres vueltas |

**Propuesta provisional para el PO (sin decidir):** paquetería por defecto **Paquetexpress Nacional con
recolección**, y **ampm** cuando sea caja y dé 1–2 días. Se re-decide con precios reales al acabarse la promo.

**El margen de hoy tampoco es representativo:** cobramos MX$175 y la guía cuesta $51.25 (+$25 de seguro
automático) **solo mientras dure la promo**.

### 10.3 Pendientes que deja la prueba (dueño)

| # | Qué | Cierra | Dónde |
|---|---|---|---|
| T1 | Cuánto cuesta el seguro con $2,500 y $10,000 declarados | Pregunta 4, C8 | «Completa el envío», sin crear el envío |
| T2 | Clave SAT de contenido para cartas | H4 | Misma pantalla, bloque de contenido |
| T3 | Sucursal más cercana a 14210 de Paquetexpress, J&T y ampm | C7, pregunta 5 | Mapas de cada paquetería |
| T4 | **Precios sin promo** de Paquetexpress, J&T y ampm (sobre y caja, 3 destinos: CDMX, MTY, TIJ) | **C13, la regla de paquetería** | Al terminarse la promo |
| T5 | Costo y horario de la recolección | C7 | Solo visible al crear el primer envío real |
| T6 | Si «SOS Protección automática» aplica a las guías hechas por API | M6 | Prueba en sandbox o soporte (api@skydropx.com) |

---

## 11. Re-medición contra producción y flujos afectados (añadido 2026-09-29)

> **Contra qué:** `origin/production` = **`a2da420`** (2026-09-28, «entrega conjunta»), que va **1277 commits
> por delante** de `bb239c0`, sobre el que se escribieron §2–§9. `main` está atrasado: la rama ya trae
> producción por merge. Lo re-midió un agente de solo lectura sobre un worktree de `a2da420`. El orquestador
> verificó a mano: `common/money.ts:438-458`, `shipments.service.ts:1519-1540`, `PROJECT.md:6486-6492` y
> `:6597-6603`.

### 11.1 Qué sigue igual

Siguen **ciertas en producción** las 16 afirmaciones de §2, §5 y §9: tarifa fija, dónde nace cada envío,
máquina de estados, captura manual de la guía, M4 sin IVA del costo, sin peso ni medidas, sin origen, colonia
opcional, libreta débil, enlaces de correo rotos (**también** en `order-notice.templates.ts:107,192`), sin
reembolso de retiro, P&L, M4 sin margen, webhook solo para Stripe, y ninguna integración con paquetería.
**«Entrega conjunta» NO es una función de envío**: es el nombre del PR #66 que publicó cuatro entregas juntas.
`ShipmentRequest`, `ShipmentItem` y `ShipmentStatus` no cambiaron (las 6 migraciones nuevas no los tocan).

### 11.2 Tres correcciones a este documento (regla O-2)

| # | Lo que decía | Lo que es (medido) | Efecto |
|---|---|---|---|
| X1 | «Tarifa fija de MX$175» | El dial `shipping_fee_cents` = 17500 es el precio **sin IVA**. **El cliente paga MX$203** (`common/money.ts:438-458`, `shippingFeeDisplayCentsOf`) | Margen durante la promo, en neto: cobramos $175 sin IVA; la guía cuesta $51.25 + $25 de seguro = $76.25 con IVA. El IVA del envío es $6.90; el del seguro es **NO MEDIDO** |
| X2 | H5: «no hay correo de entregado» como **hueco** | Es **deliberado**: `shipments.service.ts:1539`, «`entregado` … CERO correos (criterio 210 / §R.7)», con confirmación del dueño | H5 deja de ser hueco y pasa a **pregunta 14**: con la entrega confirmada por la paquetería, ¿se quiere ahora el correo? |
| X3 | La guía impresa como mejora sin conflicto | `PROJECT.md:6490` lo excluye **por escrito**: «**Impresión de etiquetas: cero.** No existe y no se promete. … la dirección **se transcribe a mano**» (`DESIGN_SYSTEM §35.5`) | El **product-owner** tiene que **reabrir** esa exclusión de §S.2. Lo mismo con «la tarifa de MX$175» (`:6489`), si se toca |

### 11.3 Lo nuevo en producción que cambia el diseño

- **«Pedidos a preparar»** (arriba de M4): cola agrupada por pedido, en dos cubetas (`shipments.service.ts:644-999`;
  `PreparationQueue.tsx`).
  - **Cubeta de envío:** solo tarjetas de **lectura**, con dirección completa, cartas y ubicación.
    **No tiene palomeo todavía**: está diseñado y sin construir (`PROJECT.md:6499-6508,6597-6609`).
  - **La guía se sigue capturando** en la lista vieja de M4, abajo (`M4View.tsx:132-148`).
  - **Cubeta de bóveda:** palomear → preparado → confirmar cajón (`VaultPlacement`). No lleva guía, no lleva
    dinero y queda **fuera** de esta iniciativa.
- **El producto ya dice cuál es el siguiente paso:** «envío ⇒ **guía**; bóveda ⇒ cambio de ubicación»
  (`PROJECT.md:6601`). **El botón «Generar guía» encaja exactamente ahí**: después de «preparado», en la
  tarjeta de la cubeta de envío.
- **Pregunta abierta al arquitecto que esta iniciativa hereda:** «¿«preparado» es un estado nuevo de la
  máquina de envíos o un hito dentro de `picking`?» (`PROJECT.md:6772-6775`). Hay que resolverla junto con
  el estado «guía en proceso» (R5).

### 11.4 Decisiones del dueño (2026-09-29, anotadas en `HECHOS.md`)

1. **Todo paquete va asegurado** ($25 medidos con el valor por defecto).
2. **Una sola paquetería preferente, con sucursal cerca: 99minutos.** Respaldo solo donde no cubra.
   - Candidatas del orquestador, con direcciones de directorios web **sin confirmar** y distancias **NO MEDIDAS**:
     - **99minutos:** Punto99, Av. Periférico Sur 4249, Jardines de la Montaña, 14210 (la misma colonia).
     - **J&T:** Tekit 14, Cultura Maya, 14230.
     - **Paquetexpress:** Periférico Sur 5561 Local B, Cantera Puente de Piedra, 14040 (también recoge).
   - DHL tiene sucursal en la misma colonia (Carr. Picacho-Ajusco 160, Local 13A), pero no salió entre las 4
     más baratas en ninguna cotización.
   - **Pendiente T7:** cobertura y precio de 99minutos a los 10 destinos. En la prueba nunca quedó entre las 3
     más baratas y es «Next Day».
3. **La paquetería la elige el operador en la plataforma**, entre las opciones con sus costos, con la preferida
   (99minutos) preseleccionada. Ver F3.

### 11.5 Cómo quedan los flujos con la iniciativa (propuesta para el PO; nada decidido salvo §11.4)

**F1 · Compra de invitado (envío directo).**
- El checkout exige **colonia elegida de la lista del CP** (R1/M5) y referencias opcionales.
- La tarifa no cambia ($203) mientras el dueño no diga otra cosa.
- Pago → `settleDirectShipOrder` crea el envío en `picking` → aparece en la **cubeta de envío**. Esto no cambia.

**F2 · Retiro de bóveda.**
- La libreta de direcciones se endurece al nivel del invitado: CP de 5 dígitos, teléfono de 10 y colonia
  obligatoria (V1).
- Lo demás sigue igual: solicitud → pago de $203 + comisión → `picking` → cubeta de envío.
- **Hueco que sigue:** no hay reembolso de retiro (H6).

**F3 · Preparar, cotizar y elegir la guía (operador), en la tarjeta de la cubeta de envío.**
> **Decisión del dueño (2026-09-29):** la paquetería **la elige el operador dentro de la plataforma**, entre
> las opciones con sus costos, con la **preferida preseleccionada**. Sustituye la «regla automática» de C13
> y §10.2. La compra automática sin elegir queda como posible fase posterior, **no** en el alcance inicial.

1. **Palomear cartas → «preparado».** Es lo ya diseñado en §S y todavía sin construir: **esta iniciativa
   depende de eso, o hay que poner el botón antes**.
2. **«Cotizar envío».** El sistema elige el **empaque estándar** (sobre de 1 kg o caja), marca **seguro**
   con valor declarado y cotiza en Skydropx. La cotización es asíncrona: segundos, con indicador de espera.
3. **Lista de opciones**, ordenada por precio. Cada fila trae:
   - paquetería y servicio;
   - **precio con IVA y seguro incluidos**;
   - días hábiles;
   - **dónde se entrega**: la sucursal de siempre, otra sucursal o recolección;
   - **margen del envío**: cobrado sin IVA − costo neto.

   Encima de la lista: pedido, destinatario, destino, empaque y **lo cobrado al cliente** ($203 / $175 sin IVA).
4. **Preseleccionada la preferida:** 99minutos ★ si cubre el CP; si no, la siguiente según la preferencia del
   dueño. **Se ocultan** las opciones de sucursal a sucursal (PuntoPost y similares), porque se promete entrega a
   domicilio (M8). Hay un enlace a «ver todas las opciones».
5. **Validaciones antes de comprar:**
   - **saldo suficiente** en Skydropx;
   - **tarifa vigente**: si pasaron más de 24 h, se re-cotiza sola y avisa si cambió el precio (R4).
6. **«Comprar guía con la opción elegida».** El sistema:
   - compra la guía con **Carta Porte** fija;
   - guarda paquetería, número, costo, IVA, seguro, PDF, **qué opción se eligió, cuál era la recomendada, quién
     eligió y cuándo** (bitácora de auditoría);
   - si la guía tarda, pasa por «guía en proceso» (R5); luego `guia` y el correo de guía, que ya existe.

   **Si la compra falla** (`error_detail`), muestra el error y deja **elegir otra opción** sin perder el pedido.
7. **Imprimir la etiqueta.** Deja de transcribirse la dirección a mano (reabre §S.2, X3).

**F4 · Llevar a sucursal.** Nueva vista **«Salida de hoy»**: «99minutos, Periférico Sur 4249: N paquetes» y,
si hubo respaldo, su propio grupo. **Sin recolección**, por la decisión del dueño.

**F5 · Rastreo automático.** Una tarea consulta Skydropx (o recibe webhooks cuando esté la doc, R8):
- `picked_up` / `in_transit` → **enviado**: correo de salida (ya existe) y piezas `shipped`;
- `delivered` → **entregado**: piezas `delivered`/`withdrawn`, **sin correo** (X2) salvo que el dueño cambie;
- `delivery_attempt` / `exception` / `in_return` → **alerta** al admin (§8.3).

**F6 · Cancelación.** Cancelar un envío con guía **cancela la guía en Skydropx** (el saldo regresa). El
reembolso al cliente sigue igual: pedido sí, retiro no (H6).

**F7 · Lo que ve el cliente.** Invitado en `/pedido?token=…`; registrado en `/shipments`. Número de guía más
eventos de rastreo. **Antes:** arreglar los enlaces rotos de los correos (H7, ahora también en
`order-notice`).

**F8 · Dinero.** El costo se guarda solo (envío + seguro, con su IVA). Una tarea diaria suma los **cargos
extra**. El margen se ve en la tarjeta. El P&L deja de subestimar la ganancia (D1).

**F9 · Configuración (admin, una vez).**
- Dirección de origen como plantilla de Skydropx (CP 14210).
- Paquetería preferente y respaldo.
- Empaques estándar con sus códigos.
- Código Carta Porte.
- Alerta de saldo bajo.
- Credenciales en los secretos de Railway.

**Fuera de alcance:** cubeta de bóveda (no lleva guía), buylist (guía al vendedor; posible fase posterior),
tarifa en vivo en el checkout.

### 11.6 Lo que falta re-checar antes de pasar al PO

| # | Qué | Quién | Bloquea |
|---|---|---|---|
| T7 | Cobertura y precio de **99minutos** a los 10 destinos | Dueño (panel) | Qué se preselecciona y con qué respaldo. Ya no bloquea: el operador elige entre lo que devuelva la cotización |
| T3 | Confirmar en el mapa las 3 sucursales y su distancia | Dueño | F4 |
| T4 | Precios sin promo | Dueño, al acabarse la promo | Margen real (X1) |
| T1, T2, T6 | Seguro por valor, clave SAT, seguro automático vía API | Dueño / sandbox | F3 |
| — | Colección OpenAPI oficial (webhooks, recolección, forma de las tarifas) | Dueño (URL) | F5, R8 |
| — | Si «preparado» se construye antes o junto con «Generar guía» | PO / arquitecto | F3 |

---

## 12. Cómo le llegan al cliente los datos de su guía (añadido 2026-09-29)

> Medido por el orquestador sobre `1248e55`, que ya incluye production `a2da420`.

### 12.1 Hoy

| Momento | Canal | Qué lleva | Evidencia |
|---|---|---|---|
| El operador captura la guía | **Correo «Tu guía de envío»**, **una sola vez**. El sello `trackingNoticeSentAt` se reinicia solo si cambian la paquetería o el número | Paquetería y número de guía en texto copiable, la nota «la paquetería puede tardar unas horas en mostrar movimiento» y el botón **VER MI ENVÍO** | `shipment-notice.templates.ts:95-135`; `shipments.service.ts:1342` |
| `enviado` | Correo «Tu paquete va en camino» | Repite paquetería y guía, y el mismo botón | `:143-175` |
| `cancelado` | Correo «Tu envío quedó cancelado» | — | `:187-215` |
| `entregado` | **Ninguno**, por decisión (criterio 210) | — | `shipments.service.ts:1539` |
| Consulta del invitado | Página `/pedido?token=…` (el enlace vale 90 días) | Paquetería y guía **copiables**. «**Sin URL de rastreo inventada**»: no hay enlace a la paquetería | `pedido/PublicOrderTracking.tsx:127-139` |
| Consulta de un retiro | `/shipments/[id]` y la lista de retiros en `/vault` | Paquetería y guía | `ShipmentDetailView.tsx:123-125`; `WithdrawalsList.tsx` |

**A quién se manda** (`shipments.service.ts:1366-1383`, §R.5):
- **retiro** → `User.email`;
- **pedido** → `guestEmail` y, si no hay, el correo de la cuenta. Gana `guestEmail` aunque el pedido se haya reclamado.
- Nunca se usa el correo del `addressSnapshot`, y nunca se escribe a una cuenta anonimizada.

**Defectos que ya existen (no son de Skydropx):**
- **E1:** el botón **VER MI ENVÍO** lleva a una ruta que no existe (H7). Al invitado se le manda a
  `cuenta/pedidos`, aunque no tiene cuenta. **Su enlace correcto es el de `/pedido?token=…`.**
- **E2:** **`/orders` no muestra la guía.** `grep trackingNumber` en `(storefront)/orders` = 0 resultados. Un
  pedido de invitado que se reclama con cuenta solo se rastrea por el correo o por el enlace con token.
- **E3:** **no hay otros canales:** ni WhatsApp ni SMS (`grep` de whatsapp/sms/twilio en `backend/src` = 0).

### 12.2 Con Skydropx (propuesta para el PO)

1. **El correo de guía sale solo al comprarla** en F3, con el mismo correo y el mismo sello de una sola vez.
   Cambia el origen del dato, no el correo.
2. **Enlace de rastreo real.** La regla «sin URL inventada» se puede levantar si Skydropx da una **página de
   rastreo por guía**. **NO MEDIDO**: si la API la da. Si no la da, se usa la URL pública de cada paquetería, con
   una lista fija en ajustes. Es decisión del PO.
3. **Línea de tiempo en `/pedido` y `/shipments/[id]`** con los eventos de Skydropx: recolectado, en tránsito,
   en reparto, intento fallido, entregado.
4. **Correos nuevos que el dueño tiene que aprobar**, porque hoy la regla es mínima:
   - «intento de entrega fallido»: el cliente tiene que actuar;
   - «tu paquete regresa»;
   - «entregado» (pregunta 14, X2).
5. **Antes de lanzar:** arreglar E1. Con más correos automáticos, más clientes llegarían a una página que no existe.
6. **Aparte:** E2 (mostrar la guía en `/orders`).

### 12.3 Decisiones del dueño sobre avisos al cliente (2026-09-29, anotadas en `HECHOS.md`)

1. **Liga de rastreo solo si Skydropx la da.** Si no, se queda como hoy: **clave de rastreo + paquetería**.
   Nunca se arma una URL por nuestra cuenta. Esto sustituye el punto 2 de §12.2 (la lista de URLs por
   paquetería queda **descartada**).
   - **Lo que se sabe (medido 2026-09-29):** hay un indicio y no está confirmado. Un cliente no oficial
     (Docxter) lee `packages[].attributes.tracking_url_provider` (la URL de rastreo de la paquetería) y
     `label_url`. Su ejemplo en `docs/SHIPMENTS.md:110,134` trae el campo en `null` en un caso y con URL de
     FedEx en otro. La referencia oficial que compiló el dueño **no lo menciona**.
   - Skydropx tiene además una página pública, `rastreo.skydropx.com`. Si acepta una guía por URL es
     **NO MEDIDO**.
   - **Se cierra con:** la primera guía de sandbox (leer el paquete) o la colección OpenAPI oficial.
   - **Diseño:** el campo puede venir `null` ⇒ el correo y las páginas muestran la liga **cuando existe** y, si
     no, solo clave y paquetería.
2. **Correo de «Entregado» automático** cuando Skydropx confirma la entrega (`delivered`, §8.3). **Reabre el
   criterio 210 / §R.7**, que hoy prohíbe correos en `entregado`: lo reescriben el PO y el arquitecto. Queda
   **decidido el 2026-09-29:** con `delivered_to_branch` (entregado en sucursal) se manda un **correo aparte,
   «tu paquete está en sucursal»**, y el envío **no** pasa a `entregado`. «Entregado» sale solo con `delivered` Pregunta 14 respondida; X2 cerrada.
3. **⚠️ Riesgo de correos duplicados (NO MEDIDO):** según la página de Skydropx, la cuenta puede mandar **sus
   propias notificaciones** de estado al cliente por **correo o WhatsApp** («Mis envíos»). Si están
   activadas, el cliente recibiría dos avisos por cada cambio. **Se cierra con:** revisar esa configuración en
   el panel. Propuesta: apagarlas y dejar solo los correos de TCG Hunt.
