# PROJECT.md — TCG HUNT (marketplace Pokémon TCG con bóveda, México)

> **Estado vigente, no bitácora.** Versión anterior (19 155 líneas) congelada en `docs/archive/PROJECT.md`. Las
> **decisiones literales del dueño** viven en `HECHOS.md` (no se re-preguntan); historia en `docs/DECISIONES.md`. Si
> este resumen y `HECHOS.md` discrepan, **manda HECHOS**.
> Marca: **TCG HUNT** (`common.brand.name`; dominio `tcghunt.mx`). Razón social (`common.footer.legalEntity`) pendiente de carga.

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
- Reembolsos manuales SPEI: se marcan «pagado + quién»; topes contra errores de dedo; dueño los ve en el panel.

**Control de gasto y legal**
- Avisos al dueño y topes sobre lo que cuesta dinero (p. ej. MX$2,500 en guías por persona en 24 h). Todo proceso es automático (regla AUTO); lo manual es excepción con costo.
- Aviso de privacidad y términos mínimos; salida en vivo sin datos fiscales (se regulariza). PII (INE, CLABE, RFC) cifrada y enmascarada; INE con retención acotada.

**P-PROMOS (HECHOS 2026-11-06/07; texto y criterios en `docs/specs/P_PROMOS.md`):** import de grupos TCGCSV: semilla 24451 + DESCUBRIMIENTO automático (dueño 2026-11-09, sustituye la «lista explícita»; §AUTO-F); todo-o-nada; sin precio ⇒ PRICE_PENDING (se publica solo al llegar precio); sello = versión aparte que nunca hereda el precio de la plana; promos viejas con cartas de pokemontcg.io y precio de TCGCSV. 2.ª corrida ⇒ 0 duplicados.
**§PSA-ACABADO (HECHOS 2026-11-09, «B precios PSA»; `docs/specs/PSA_ACABADO.md`; dinero):** el estimado «si se gradea» es por carta, grado y ACABADO; un acabado nunca hereda la cifra de otro. Proveedor sin separación por acabado ⇒ solo cartas de acabado único; las demás «sin estimado». Cifras viejas automáticas no se leen. Se recalcula solo en el siguiente `price-ingest`. Criterios: Gengar Perfect Order #50 holo y reverse no repiten cifra; tope ×raw contra el raw del MISMO acabado; 0 precios de venta movidos; gates qa + seguridad-lead.
**§PROMOS-MASTERSET (HECHOS 2026-11-09; `docs/specs/PROMOS_MASTERSET.md`):** (a) «Importar sets nuevos»/«Sincronizar todo» (y el job diario) incluyen siempre las 6 promos viejas y los grupos TCGCSV (semilla + descubiertos); pokemontcg.io caído ⇒ nada se escribe. (b) Bajo el Master Set de cada expansión, un apartado «Promos de la colección» (tienda, M1, bóveda) con su propio «x de y» (dueño 2026-11-09: sí), aparte y nunca sumado al Master Set (conteo, %, valor intactos). La liga promo→expansión se INFIERE sola (§AUTO); sin tabla manual. Criterios: promo fuera del corte entra; 2.ª corrida ⇒ 0 duplicados; grupo cubierto ⇒ no es error; gates qa + seguridad-lead.
**§AUTO (HECHOS 2026-11-09; `docs/specs/AUTO_CATALOGO.md`):** nada depende del dueño. (A) El job diario `catalog-metadata-sync` aguarda el resultado y reintenta solo (backoff) si pokemontcg.io falla; importa sets nuevos, promos y grupos TCGCSV con actor de sistema auditado. (F) Descubre solo grupos de promos de TCGCSV (categoría Pokémon, nombre de promos, ≥20 productos con número, sin set equivalente vivo en pokemontcg.io, ≥7 días publicado; máx. 2 nuevos por corrida); si hay duda ⇒ cuarentena: no se importa y se reporta. (B) Promo→expansión por misma carta + ventana de productId; solo confianza alta se publica; precisión alta k/k contra la lista humana de Prismatic Evolutions (65). (C) PSA por acabado se recalcula en el siguiente `price-ingest`. (D) **Regla de precio:** estimado PSA automático que falle una cota dura (múltiplo excesivo, no supera al raw, grados invertidos, sin raw del acabado) queda en cuarentena (no se muestra) y se re-chequea en cada ingesta; la lista de revisión es solo informativa; 0 precios de venta cambian. Excepciones manuales: KYC, SPEI, empaque.
**§D9 · comisión de plataforma DENTRO del precio (HECHOS:201, 2026-10-30; detalle y preguntas en `docs/specs/D9_COMISION.md`; PENDIENTE DEL DUEÑO, tras publicar §DYN):** el precio exhibido `P` ya incluye la comisión de cobro; ninguna pantalla muestra «comisión de plataforma». `P` lo fija el servidor una vez al día. NO DECIDIDO: P1–P6, P8 (spec); gates qa + seguridad-lead.
**§WSH · lista de deseos SIEMPRE activa (HECHOS 2026-11-08, «Quita el interruptor déjala prendida siempre»):** sin interruptor `wishlist_enabled`; lista y avisos siempre activos (staff sin correo: 403); siguen los demás diales. La migración no toca listas ni avisos; gates qa + seguridad-lead.

## 4. Fuera de alcance hoy
Envío internacional · japonés (después) · fotos propias de cartas · pentest externo (riesgo aceptado por el dueño) ·
Meta Ads / bots en redes · disputas dentro de la tienda.

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
