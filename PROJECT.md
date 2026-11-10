# PROJECT.md — TCG HUNT (marketplace Pokémon TCG con bóveda, México)

> **Estado vigente, no bitácora.** Versión anterior (19 155 líneas) congelada en `docs/archive/PROJECT.md`. Las
> **decisiones literales del dueño** viven en `HECHOS.md` (no se re-preguntan); historia en `docs/DECISIONES.md`. Si
> este resumen y `HECHOS.md` discrepan, **manda HECHOS**. Marca: **TCG HUNT** (`common.brand.name`; dominio `tcghunt.mx`). Razón social (`common.footer.legalEntity`) pendiente de carga.

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

**P-PROMOS (HECHOS 2026-11-06/07; `docs/specs/P_PROMOS.md`):** import de grupos TCGCSV: semilla 24451 + descubrimiento automático (§AUTO-F); todo-o-nada; sin precio ⇒ PRICE_PENDING; sello = versión aparte que no hereda el precio de la plana; promos viejas: cartas de pokemontcg.io, precio de TCGCSV. 2.ª corrida ⇒ 0 duplicados.
**§PSA-ACABADO (HECHOS 2026-11-09; spec `PSA_ACABADO.md`; dinero):** estimado «si se gradea» por carta, grado y ACABADO; nunca hereda la cifra de otro; sin separación del proveedor ⇒ «sin estimado». Manual heredada ⇒ acabado principal de su carta. 0 precios de venta movidos; gates qa + seguridad-lead.
**§PROMOS-MASTERSET (HECHOS 2026-11-09; spec `PROMOS_MASTERSET.md`):** el sync incluye siempre promos viejas y grupos TCGCSV; bajo cada Master Set, apartado «Promos de la colección» con su «x de y» (dueño: sí), nunca sumado al set. Sellos siempre; Black Star solo con la compuerta automática abierta (§AUTO). Gates qa + seguridad-lead.
**§AUTO (HECHOS 2026-11-09; spec `AUTO_CATALOGO.md`):** nada depende del dueño. El sync diario reintenta y descubre grupos de promos solo (duda ⇒ cuarentena); solo confianza alta se publica; la compuerta Black Star se abre/cierra sola por backtest contra sellos; estimado PSA con cota dura fallida ⇒ cuarentena; 0 precios de venta cambian. Excepciones manuales: KYC, SPEI, empaque.
**§MKT-V2 · panel de Marketing v2 (HECHOS 2026-11-09, «Dale diseñalo…»; detalle, umbrales y pruebas en `docs/specs/MKT_PANEL_V2.md`; gates qa + seguridad-lead):** (1) Pestaña «Resumen» (`pantalla=r`): 8 cifras de la semana cerrada con flecha; gráfica diaria solo para el dueño. (2) Avisos por reglas fijas con umbral, citan sus números, sin IA. (3) Correo cada lunes (CDMX), una vez por semana, sin datos personales. (4) Tráfico propio (`diag-*`, `qa-*`, `e2e-*`, `?tcg_int=1`) no se mide; la lista crece por prefijo. (5) Datos nuevos de GA4/Search Console y 10 arreglos (Consent Mode con modelado: NO): spec §5–6. **§GSHOP (HECHOS 2026-11-10; `docs/specs/GOOGLE_SHOPPING_E_INDEXACION.md`):** (6) Cada semana el panel revisa la indexación del sitemap en Search Console y el correo avisa (AV7) de problemas en fichas que deben indexarse, sin acción del dueño. (7) La tienda publica sola un feed XML de lo vendible (precio exhibido) para Merchant Center; el dueño solo crea la cuenta (spec §C).
**§D9 · comisión de plataforma DENTRO del precio (HECHOS:201 y :272 «A en todo», 2026-11-09; `docs/specs/D9_COMISION.md`; se construye tras publicar §DYN):** el precio exhibido ya incluye la comisión (≈4.4 %, al peso hacia arriba por unidad: carta 10000 → 10500 centavos); ninguna pantalla, ticket ni correo dice «comisión». Se cobra el precio visto, igual para todos los métodos; envío de retiro mostrado = cobrado; envío gratis desde 400000 sobre el subtotal visto; en Finanzas Stripe es solo gasto (pedidos nuevos `FEE_INCLUDED`). Precio final del dueño en accesorios/sellado no se toca. Gates qa + seguridad-lead.
**§WSH · lista de deseos SIEMPRE activa (HECHOS 2026-11-08, «Quita el interruptor déjala prendida siempre»):** sin interruptor `wishlist_enabled`; lista y avisos siempre activos (staff sin correo: 403); siguen los demás diales. La migración no toca listas ni avisos; gates qa + seguridad-lead.

## 4. Fuera de alcance hoy
Envío internacional · japonés (después) · fotos propias de cartas · pentest externo (riesgo aceptado por el dueño) · Meta Ads / bots en redes · disputas dentro de la tienda.

## 5. Restricciones técnicas
Repo **público**: ningún secreto en el árbol. Solo producción (no hay staging); blanco de seguridad = local.
Publica **solo la rama `production`** (Vercel + Railway despliegan al recibir push). ES por defecto, EN a un clic.
Stack y estructura en `docs/ARCHITECTURE.md`; endpoints en `docs/API_CONTRACT.md`.

## 6. Criterios de aceptación vigentes (resumen por área)
Lista completa (criterios 1…~1000) congelada en `docs/archive/PROJECT.md` (`grep -n "criterio NNN"`). Criterio nuevo: aquí, corto.
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
