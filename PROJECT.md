# PROJECT.md — TCG HUNT (marketplace Pokémon TCG con bóveda, México)

> **Estado vigente, no bitácora.** Destilado el 2026-11-06 de la versión de 19 155 líneas, que queda congelada en
> `docs/archive/PROJECT.md` (numeración de criterios 1…~1000 y secciones §A…§IDS). Las **decisiones literales del
> dueño** viven en `HECHOS.md` (no se re-preguntan); su historia, en `docs/DECISIONES.md`. Si este resumen y una fila
> de `HECHOS.md` discrepan, **manda HECHOS** y se corrige aquí.
> Marca: **TCG HUNT** (clave i18n `common.brand.name`; dominio `common.brand.domain` = `tcghunt.mx`). «TCG Vault MX»
> fue un nombre interno retirado. La razón social (`common.footer.legalEntity`) está pendiente de carga.

## 1. Idea y problema
TCG HUNT vende **cartas individuales y producto sellado de Pokémon** en México con **precio derivado del mercado** y
una **bóveda de custodia**: guardamos físicamente lo comprado (autenticado, condición garantizada) y lo enviamos solo
cuando el cliente lo pide, en un solo paquete. También **compramos cartas** a usuarios (buylist).
Resuelve: precios opacos, envíos repetidos, dudas de autenticidad/condición y no poder ver el valor de la colección.

## 2. Roles
| Rol | Puede | No puede |
|---|---|---|
| **Invitado** | Comprar con correo + dirección, **solo envío a domicilio**; seguir su pedido por enlace tokenizado; luego crear cuenta y reclamar el pedido | Bóveda, buylist, portafolio |
| **Cliente** (`customer`) | Registro con correo/contraseña o Google; celular obligatorio; comprar a bóveda o domicilio; ver bóveda y portafolio con gráfica; pedir retiros; vender (buylist); lista de deseos | Back-office, dinero de la plataforma |
| **Operador de bóveda** (`vault_operator`) | M1 inventario, M4 «Pedidos por preparar» (envíos, colocaciones, «Por reponer»), M5 buylist hasta verificación; ofertas de buylist **hasta su tope** (dial M10); comprar/cancelar guías Skydropx; reembolsar **solo** la carta faltante/dañada de un ENVÍO en preparación, **tope MX$5,000 por 24 h** | Diales, finanzas, SPEI, reembolso total, KYC |
| **Súper-admin** (`super_admin`, el dueño; **una sola cuenta**, sin 2FA por ahora) | Todo M1–M11; único que saca dinero (SPEI buylist, reembolsos), edita diales, ve finanzas, verifica KYC, autoriza ofertas sobre tope | — |
| **Staff sin correo** | Operadores/admins nuevos entran con **usuario + contraseña** por la misma pantalla; el dueño restablece su contraseña; contraseña temporal **obliga** a cambiarla | KYC (el staff no tiene KYC) |

## 3. Reglas de negocio críticas (vigentes)
**Condición e identidad**
- Raw solo **Near Mint (NM)**. Gradeadas (PSA/CGC): el slab es la garantía (empresa + grado + `certNumber` verificable).
  Sellado: condición propia (Mint / «Detalle menor en caja»).
- Sin fotos propias de cartas: imagen de catálogo (pokemontcg.io). Accesorios sí llevan foto.
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
- Retiro sin mínimo de cartas; envío nacional; tarifa fija configurable (M10); **todo paquete va asegurado** (costo nuestro).
- Guías con **Skydropx** desde «Capturar guía»: el operador elige paquetería (preferida preseleccionada) y puede
  corregir toda la dirección (queda auditado). Correo «Entregado» y «en sucursal» automáticos.
- Accesorios y energías: solo en compra con envío a domicilio (cross-sell), precio final del dueño con IVA.
- Códigos de descuento (§DSC, alcance B).

**Buylist (compramos cartas)**
- Cotizador público: carta + acabado, NM fija; muestra **valor de mercado junto a «Te pagamos»** (sin frase fija de %).
  Curva de compra de fábrica: 30 % hasta MX$25, 40 % en MX$100, 50 % desde MX$500 (`backend/src/common/pricing-curve.ts`).
- Ciclo: solicitud (requiere celular + dirección + KYC del vendedor con INE cifrada) → oferta por correo → el cliente
  acepta/rechaza → guía Skydropx **de entrada** pagada por nosotros y **descontada del pago** → recepción y
  verificación → pago **SPEI** (solo súper-admin) → publicar.
- Sin oferta en 7 días hábiles ⇒ correo «no procederemos». Aceptada sin guía en 7 días ⇒ se cancela sola.
  Aceptada no se cancela: se rechazan las cartas en mala condición con motivo. El operador puede declinar (auditado).
- **Bounties**: nunca pagan arriba del mercado (`min(bounty, mercado)`; sin mercado ⇒ bounty completo); se pueden eliminar.
- Topes AML/mensuales de compra por vendedor según dial; KYC lo verifica **solo el dueño**.

**Disputas y reembolsos**
- **No hay disputas en la tienda.** Tras la entrega el cliente escribe a soporte («Escríbenos») o reclama a su banco
  vía Stripe (contracargo). Sin plazo escrito en términos.
- Reembolso de **solo la carta** que llegó mal (desde Ventas, con motivo). Retiro de bóveda entregado: devolución por SPEI.
- Faltante/dañada al preparar: se reembolsa esa carta (carta + su parte de comisión); el pedido sigue.
- Reembolsos manuales SPEI: se marcan «pagado + quién»; topes contra errores de dedo; dueño los ve en el panel.

**Control de gasto y legal**
- Avisos al dueño y topes sobre lo que cuesta dinero (p. ej. MX$2,500 en guías por persona en 24 h).
- Procesos **lo más automáticos posible**; lo manual es último recurso.
- Aviso de privacidad y términos mínimos; salida en vivo sin datos fiscales (se regulariza).
- PII (INE, CLABE, RFC) cifrada y enmascarada; INE con retención acotada.

## 4. Fuera de alcance hoy
Envío internacional · japonés (después) · fotos propias de cartas · pentest externo (riesgo aceptado por el dueño) ·
Meta Ads / bots en redes · disputas dentro de la tienda.

## 5. Restricciones técnicas
Repo **público**: ningún secreto en el árbol. Solo producción (no hay staging); blanco de seguridad = local.
Publica **solo la rama `production`** (Vercel + Railway despliegan al recibir push). ES por defecto, EN a un clic.
Stack y estructura en `docs/ARCHITECTURE.md`; endpoints en `docs/API_CONTRACT.md`.

## 6. Criterios de aceptación vigentes (resumen por área)
La lista numerada completa (criterios 1…~1000, con su texto literal) está congelada en `docs/archive/PROJECT.md`;
buscar con `grep -n "criterio NNN"` antes de abrir contexto. Un criterio nuevo se escribe aquí, corto.
1. **Tienda**: catálogo con filtros/facetas, ficha con precio con IVA dentro, sellado y accesorios; portada < 1 s
   (Destacadas del día, Joyas para gradear por turnos).
2. **Checkout**: invitado y con cuenta; destino bóveda/domicilio; desglose de importe; Stripe real; correo de confirmación.
3. **Bóveda/portafolio**: cartas en custodia con acabado, pestaña Sellado, valuación a mercado y gráfica 5d…Máx.
4. **Retiro/envío**: solicitud, cobro de envío, guía Skydropx, rastreo y correos de estado.
5. **Buylist**: cotizador público con mercado y oferta; ciclo completo hasta SPEI y publicación; KYC con INE.
6. **Back-office M1–M11**: inventario y Master Set por lote, precios y diales, ventas/reembolsos, pedidos por
   preparar (palomeo carta por carta), buylist, usuarios y staff, finanzas/P&L, analítica de ventas, configuración.
7. **Cuentas**: verificación de correo, recuperación de contraseña, Google, cuenta con solo el correo («termina tu cuenta»).
8. **Seguridad**: sin críticos/altos abiertos; dinero idempotente y sin carreras; authz por rol sin IDOR.

## 7. Métrica de «lanzado»
Tienda en vivo cobrando en real, con los flujos críticos (compra, bóveda, retiro, buylist, reembolso) recorridos de
punta a punta en producción.

## 8. Preguntas abiertas
Viven en `PENDIENTES.md` (índice con dueño y fecha). Las respondidas pasan a `HECHOS.md`.
