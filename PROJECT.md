# PROJECT.md — TCG HUNT (marketplace Pokémon TCG con bóveda, México)

> **Estado vigente, no bitácora.** Versión anterior congelada en `docs/archive/PROJECT.md`. Las **decisiones literales
> del dueño** viven en `HECHOS.md` (no se re-preguntan; si discrepan, **manda HECHOS**); historia en `docs/DECISIONES.md`.
> Marca: **TCG HUNT** (`common.brand.name`; `tcghunt.mx`). Razón social (`common.footer.legalEntity`) pendiente.

## 1. Idea y problema
TCG HUNT vende **cartas individuales y producto sellado de Pokémon** en México con **precio derivado del mercado** y
una **bóveda de custodia**: guardamos físicamente lo comprado (autenticado, condición garantizada) y lo enviamos solo
cuando el cliente lo pide, en un solo paquete. También **compramos cartas** a usuarios (buylist).
Resuelve: precios opacos, envíos repetidos, dudas de autenticidad/condición y no poder ver el valor de la colección.

## 2. Roles
| Rol | Puede | No puede |
|---|---|---|
| **Invitado** | Comprar con correo + dirección, **solo envío a domicilio**; seguir su pedido por enlace tokenizado; luego crear cuenta y reclamar el pedido | Bóveda, buylist, portafolio |
| **Cliente** (`customer`) | Registro con correo/contraseña o Google; celular obligatorio para todos al entrar (10 dígitos MX, no se borra; §CELULAR); comprar a bóveda o domicilio; ver bóveda y portafolio con gráfica; pedir retiros; vender (buylist); lista de deseos | Back-office, dinero de la plataforma |
| **Operador de bóveda** (`vault_operator`) | M1 inventario, M4 «Pedidos por preparar» (envíos, colocaciones, «Por reponer»), M5 buylist hasta verificación; ofertas de buylist **hasta su tope** (dial M10); comprar/cancelar guías Skydropx; reembolsar **solo** la carta faltante/dañada de un ENVÍO en preparación, **tope MX$5,000 por 24 h**; M6: lista y ficha de clientes con totales y notas | Diales, finanzas, SPEI, reembolso total, KYC, altas, staff, bloquear, editar celular |
| **Súper-admin** (`super_admin`, el dueño; **una sola cuenta**, sin 2FA por ahora) | Todo M1–M11; único que saca dinero (SPEI buylist, reembolsos), edita diales, ve finanzas, verifica KYC, autoriza ofertas sobre tope | — |
| **Staff sin correo** | Operadores/admins entran con **usuario + contraseña**; el dueño restablece su contraseña; contraseña temporal **obliga** a cambiarla | KYC (no aplica) |

## 3. Reglas de negocio críticas (vigentes)
**Condición e identidad**
- Raw solo **Near Mint (NM)**. Gradeadas (PSA/CGC): el slab es la garantía (empresa + grado + `certNumber` verificable).
  Sellado: condición propia (Mint / «Detalle menor en caja»).
- Cartas: imagen de catálogo (pokemontcg.io), sin fotos propias. Accesorios sí llevan foto.
- **Acabado/versión** (Normal, Reverse Holo, Holofoil, 1st Edition) se captura y se valúa por separado.
- **Master Set / sets multi-parte**: subsets con set-id propio (p. ej. `cel25` + `cel25c`) se **agrupan solo en
  presentación** (tienda, M1 Master Set, bóveda); no cambian identidad ni precio de la carta.
- Folio de inventario legible `INV-000123`; folio propio de pedido en cada guía.

**Precio (venta)**
- Precio **puro por valor de mercado** (§N): una curva por eje de dinero; rareza y acabado ya no fijan precio.
- **Piso MX$25**; publicar al piso cuando el mercado cae debajo aplica **solo a ex y Double Rare** (resto se retiene).
- Precio exhibido **con IVA dentro** (dial de traslación, arranca 100 %); **ninguna pantalla apila IVA** encima y
  **no se rotula** «IVA incluido» junto al precio.
- El precio exhibido se calcula **una vez al día**; **se cobra el precio que el cliente vio**.
- Sellado: precio automático (mercado + margen) de respaldo; si el dueño escribe precio final, manda el suyo.
- Precios robustos multi-fuente con candado anti-inflado (§PRE). Mercado de carta en español = inglés × 75 % (dial).
- Dinero siempre en **centavos enteros MXN**; markup y gross-up de comisión de Stripe calculados en servidor.

**Compra, pago y custodia**
- Checkout con **Stripe** (modo real desde 2026-10-16, según el dueño). Webhook firmado e idempotente.
- Destino **bóveda** (requiere cuenta) o **domicilio**. Titularidad `pending` → `settled` al liquidar; solo se retira lo `settled`.
- Retiro sin mínimo de cartas; envío nacional; retiro con tarifa fija configurable (M10) hasta ENV3-b; **todo paquete va asegurado** (costo nuestro). **§RETIRO-SALIDA:** cartas fuera de bóveda al `enviado` (DECISIONES).
- **§ENV3 (HECHOS 2026-11-19; `docs/DECISIONES.md`; gates qa + seg.):** domicilio cobra **costo real de la guía FedEx con seguro y zona extendida + MX$20**, según CP y contenido; **gratis desde MX$4,000** (tras descuento). Mostrado = cobrado, congelado en el pedido; respaldo en tabla por CP; guía más cara ⇒ AG-26. Retiro: ENV3-b.
- Guías con **Skydropx** desde «Capturar guía»: el operador elige paquetería (preferida preseleccionada) y puede corregir toda la dirección (queda auditado). Correo «Entregado» y «en sucursal» automáticos.
- **§PERSONA (HECHOS 2026-11-18; `docs/DECISIONES.md`; gates qa + seg.):** «Entregado en persona» solo con envío preparado y sin guía: `entregado` con los mismos efectos de inventario, paquetería 0 y un correo. **No reembolsa envío** (AG-25). Sin «deshacer».
- Accesorios y energías: solo con envío a domicilio (cross-sell), precio final del dueño con IVA. Descuentos (§DSC, alcance B).

**Buylist (compramos cartas)**
- Cotizador público: carta + acabado, NM fija; muestra **valor de mercado junto a «Te pagamos»** (sin frase fija de %).
  Curva de compra de fábrica: 30 % hasta MX$25, 40 % en MX$100, 50 % desde MX$500 (`backend/src/common/pricing-curve.ts`).
- Ciclo: solicitud (celular + dirección + KYC con INE cifrada) → oferta por correo → acepta/rechaza → guía Skydropx **de entrada** pagada por nosotros y **descontada del pago** → recepción y verificación → pago **SPEI** (solo súper-admin) → publicar.
- Sin oferta en 7 días hábiles ⇒ correo «no procederemos». Aceptada sin guía en 7 días ⇒ se cancela sola.
  Aceptada no se cancela: se rechazan cartas en mala condición con motivo. El operador puede declinar (auditado).
- **Bounties**: nunca pagan arriba del mercado (`min(bounty, mercado)`); se pueden eliminar.
- Topes AML/mensuales por vendedor según dial; KYC lo verifica **solo el dueño**.

**Disputas y reembolsos**
- **No hay disputas en la tienda.** Tras la entrega el cliente escribe a soporte («Escríbenos») o reclama a su banco
  vía Stripe (contracargo). Sin plazo escrito en términos.
- Reembolso de **solo la carta** que llegó mal (desde Ventas, con motivo). Retiro de bóveda entregado: devolución por SPEI.
- Faltante/dañada al preparar: se reembolsa esa carta (carta + su parte de comisión); el pedido sigue.
- Reembolsos manuales SPEI: «pagado + quién»; topes contra errores de dedo; el dueño los ve en el panel.

**Control de gasto y legal**
- Avisos al dueño y topes sobre lo que cuesta dinero (p. ej. MX$2,500 en guías por persona en 24 h). Todo es automático (AUTO); lo manual es excepción con costo.
- Aviso de privacidad y términos mínimos; en vivo sin datos fiscales (se regulariza). PII (INE, CLABE, RFC) cifrada y enmascarada; INE con retención acotada.

**Specs en `docs/specs/` (HECHOS 2026-11-06/10; gates qa + seg. donde hay dinero):** **P-PROMOS** import TCGCSV todo-o-nada, sin precio ⇒ PRICE_PENDING, el sello no hereda precio. **§PSA-ACABADO** estimado «si se gradea» por carta, grado y acabado; sin separación ⇒ «sin estimado». **§PROMOS-MASTERSET** «Promos de la colección» bajo cada Master Set, nunca sumado al set. **§AUTO** nada depende del dueño: sync diario con reintento, duda ⇒ cuarentena; manual solo KYC, SPEI, empaque. **§MKT-V2** «Resumen» semanal, avisos sin IA. **§GSHOP** indexación semanal y feed XML.
**§REPORTES-CEO (HECHOS 2026-11-22/23; `docs/DECISIONES.md`; API en `docs/API_CONTRACT_REPORTES.md`; dinero ⇒ gates qa + seg.; solo `super_admin` ve dinero):** «junta de dirección» por áreas (Finanzas, Ventas, Compras a vendedores, Inventario, Operación, Marketing), cifra → pedido, cada cifra en UNA pantalla. R1 un periodo (México) con comparación; R2 P&L Propio · Marketplace · Total × Sellado · Raw · Gradeadas · Accesorios; gastos fijos solo al Total; comprar inventario no es gasto hasta venderse; R3 marketplace: GMV informativo, ingreso = comisión; R4 gastos fijos: lista del súper-admin; R5 **pendiente del dueño:** spread de envíos (default: «Resultado del envío» fuera del ingreso).
**Criterios (CR-1..16 en el anexo §9):** F1 reordenar (CR-1..4); F2 P&L por línea, Σ líneas = ganancia de hoy (CR-5..8); F3 gastos fijos sin alterar el pasado (CR-9..12); F4 cifras nuevas (CR-13..16). Fuera: caja, metas, modelo del marketplace.
**§D9 · comisión DENTRO del precio (HECHOS:201 y :272, 2026-11-09; `docs/specs/D9_COMISION.md`; tras publicar §DYN):** el precio exhibido ya incluye la comisión (≈4.4 %); ninguna pantalla ni correo dice «comisión»; se cobra el precio visto; Stripe es solo gasto en Finanzas (`FEE_INCLUDED`); precio final del dueño no se toca. Gates qa + seguridad-lead.
**§WSH (HECHOS 2026-11-08):** lista de deseos siempre activa. **§PROV (HECHOS 2026-11-12; `docs/DECISIONES.md`; `API_CONTRACT_PROVEEDORES.md`; gates qa + seg.):** compra y vende mayoreo a tiendas aliadas (mín. 1 case); rol `supplier` aislado; **tope duro 100 % del mercado**; automatismos APAGADOS al arrancar. **§MARKETPLACE-PROV (diseño firme, HECHOS 2026-11-22; `API_CONTRACT_MARKETPLACE.md`; gates qa + seg.):** invitación, ≥15 proveedores, guía pagada por el cliente, margen neto ≥3 %, pago quincenal, strikes 3/5/8; fiscal: VALIDAR CON CONTADOR antes de dinero real.

## 4. Fuera de alcance hoy
Envío internacional · japonés (después) · fotos propias de cartas · pentest externo (riesgo aceptado por el dueño) · Meta Ads / bots en redes · disputas dentro de la tienda.

## 5. Restricciones técnicas
Repo **público**: ningún secreto en el árbol. Solo producción (no hay staging); blanco de seguridad = local.
Publica **solo la rama `production`** (Vercel + Railway despliegan al recibir push). ES por defecto, EN a un clic.
Stack y estructura en `docs/ARCHITECTURE.md`; endpoints en `docs/API_CONTRACT.md`.

## 6. Criterios de aceptación vigentes (resumen por área)
Lista completa en `docs/archive/PROJECT.md` (`grep -n "criterio NNN"`). Criterio nuevo: aquí, corto.
1. **Tienda**: catálogo con filtros/facetas, ficha con precio con IVA dentro, sellado y accesorios; portada < 1 s (Destacadas del día, Joyas para gradear por turnos).
2. **Checkout**: invitado y con cuenta; destino bóveda/domicilio; desglose de importe; Stripe real; correo de confirmación.
3. **Bóveda/portafolio**: cartas en custodia con acabado, pestaña Sellado, valuación a mercado y gráfica 5d…Máx.
4. **Retiro/envío**: solicitud, cobro de envío, guía Skydropx, rastreo y correos de estado. **§ENV3**: solo con CP; Skydropx caído ⇒ tabla, cobro = mostrado; cotización caducada ⇒ 409; ≥ MX$4,000 o código de envío gratis ⇒ 0.
5. **Buylist**: cotizador público con mercado y oferta; ciclo completo hasta SPEI y publicación; KYC con INE.
6. **Back-office M1–M11**: inventario y Master Set, precios y diales, ventas/reembolsos, pedidos por preparar, buylist, usuarios y staff, finanzas/P&L, analítica, configuración.
7. **Cuentas**: verificación de correo, recuperación de contraseña, Google, cuenta con solo el correo («termina tu cuenta»).
8. **Seguridad**: sin críticos/altos abiertos; dinero idempotente y sin carreras; authz por rol sin IDOR.
9. **§PERSONA**: botón solo con `preparedAt` y sin guía, con confirmación; 2 pulsaciones ⇒ 1 entrega y 1 correo; fuera de sondeo, «Salida de hoy» y guías por cancelar; P&L sin «costo faltante».

## 7. Métrica de «lanzado»
Tienda en vivo cobrando en real, con los flujos críticos (compra, bóveda, retiro, buylist, reembolso) recorridos de punta a punta en producción.

## 8. Preguntas abiertas
Viven en `PENDIENTES.md` (índice con dueño y fecha). Las respondidas pasan a `HECHOS.md`.
