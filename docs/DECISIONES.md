# DECISIONES.md — registro de decisiones del dueño

> Lo escribe **product-owner**. Una línea por decisión: fecha, pregunta, respuesta literal del dueño (o «default
> aceptado» cuando así la dio) y la sección de `PROJECT.md` que cambió. `PROJECT.md` describe el producto de hoy;
> aquí queda de dónde salió. Lo que no tiene respuesta literal conservada lo dice, y su texto completo está en git
> (`PROJECT.md` en `ee8d5c73`).

| Fecha | Pregunta | Respuesta del dueño | Sección de `PROJECT.md` |
|---|---|---|---|
| 2026-10-25 | Códigos de descuento: ¿opción A o B? | «b para los códigos si aplica el treshold, si aplica para vault purchases no se puede combinar con otros descuentos, no puede usar el código de nuevo si reembolsa. Solo yo puedo crearlas. Bopis déjalo en el tintero» (`HECHOS.md`, fila «Códigos de descuento: opción B…») | §DSC (nueva), criterios 890–916, §AC.8, «Fuera de alcance», §Z |
| 2026-10-25 | Pedido de MX$4,200 con 10 % paga MX$3,780: ¿el umbral de envío gratis se mide antes o después del descuento? | «No: se mide después (Recomendado)» | §DSC.2 regla 5, criterio 895 |
| 2026-10-25 | Códigos de descuento: ¿cuándo se construyen? | «Arrancar tras publicar» (la entrega de envío v2) | §DSC (encabezado) |
| 2026-10-04 | P-S11-3 · Contracargo de un pedido ya enviado: ¿pide motivo? | Default aceptado: no pide motivo («solo ex y double rare, lo demás por defecto») | §S.11.7, criterio 253 |
| 2026-10-04 | P-S11-4 · Compra a bóveda reembolsada con una carta ya retirada: ¿pide motivo? | Default aceptado: no; lo retirado no se toca | §S.11.7, criterio 253 |
| 2026-10-04 | P-PRE-1 · ¿Se quita el precio a mano por pieza de sueltas y gradeadas? | Default aceptado: se conserva, sin hacerlo más visible | §N.5-bis (b), criterio 255 |
| 2026-10-04 | P-PRE-2 · Premium en el piso: ¿todas las premium o solo ex / Double Rare? | «solo ex y double rare» | §N.5-bis (a), criterio 254 |
| 2026-10-04 | P-STF-1 · ¿Súper-admin sin correo? | Default aceptado: sí | §U.2, criterio 256 |
| 2026-10-04 | P-STF-2 · ¿El staff con correo pasa a usuario sin correo? | Default aceptado: no | §U.6, criterio 266 |
| 2026-10-04 | P-STF-3 · ¿Se puede cambiar el nombre de usuario tras el alta? | Default aceptado: no en este corte | «Fuera de alcance» (§U) |
| 2026-10-04 | P-STF-4 · ¿Cómo entra el equipo? | «¿no es más fácil que detecte usuario la misma página en mi cuenta y así entra directo a admin?» | §U.3, criterios 258, 259, 262, 269 |
| 2026-10-04 | P-STF-5 · ¿Aviso de candado por correo al dueño y al staff con correo? | Default aceptado: sí, como hoy | §U.5, criterio 265 |
| 2026-10-04 | P-STF-6 · ¿La contraseña inicial obliga a cambiarla siempre? | Default aceptado: sí, siempre | §U.2, criterio 260 |
| 2026-10-04 | P-STF-7 · ¿Contador de cuentas bloqueadas en el tablero? | Default aceptado: no | §U.5, criterio 265 |
| 2026-10-04 | P-STF-8 · ¿Staff sin correo puede comprar o vender? | Default aceptado: no | §U.7, criterio 269 |
| 2026-10-04 | P-DSP-1 · ¿Qué pasa con M8 y las disputas abiertas? | Default aceptado: M8 en transición hasta cerrar las abiertas | §V.5, criterio 272 |
| 2026-10-04 | P-DSP-2 · ¿Se conserva la ventana de 7 días para reclamar? | Default aceptado (luego acotado por «Sin plazo escrito», 2026-10-05) | §H, §LEG.4 |
| 2026-10-04 | P-DSP-3 · Una carta mal de varias: ¿cómo se compensa? | Reembolsar solo esa carta (`HECHOS.md:44` (a)) | §V.2, criterios 403–405 |
| 2026-10-04 | P-DSP-4 · ¿«Escríbenos» también en un retiro entregado? | Sí, con devolución por SPEI (`HECHOS.md:44` (b)) | §V.1, §V.2, criterios 401, 406–407 |
| 2026-10-04 | P-DSP-5 · ¿De dónde sale el correo de soporte? | Default aceptado: el mismo buzón y origen | §V.6 |
| 2026-10-02 | 88 · Cargo extra de Skydropx tras comprar la guía: ¿cliente o tienda? | «de las preguntas de skydropx déjalas como las mapeaste» ⇒ lo absorbe la tienda | §T.7, criterio 238 |
| 2026-10-02 | 89 · ¿En qué mes cae el ajuste por cargo extra? | (misma respuesta) ⇒ el mes del cargo | §T.7, criterio 238 |
| 2026-10-02 | 90 · Retiro con cotización vencida más cara: ¿quién absorbe? | (misma respuesta) ⇒ la tienda | §T.7, criterio 241 |
| 2026-10-02 | 91 · Paquete que regresa o queda retenido: ¿qué hace la tienda? | (misma respuesta) ⇒ alerta al admin, a mano, sin correo | §T.6, criterio 241 |
| 2026-10-05 | P-LEG-7 · ¿Plazo para reclamar tras la entrega? | «Sin plazo escrito» y «No mencionarlo» (contracargo) | §LEG.4 (T-5) |
| 2026-10-07 | P-ACC-3a · ¿Qué cajas usas? | Las registra el dueño en el panel; el catálogo empieza vacío («"Termina wishlist y accesorios"…») | §AC.4.1, criterio 725 |
| 2026-10-07 | P-ACC-3b · ¿Cómo se cobra cada caja? | Tarifa fija por caja que escribe el dueño | §AC.4.1 |
| 2026-10-07 | P-ACC-3c · ¿Y si no cabe en ninguna caja? | Se cobra la más grande y lo resuelve quien prepara | §AC.4.1, criterios 728, 729 |
| 2026-10-07 | P-ACC-10 · ¿Accesorios para cuenta con envío a domicilio? | (a): solo en compra de invitado a domicilio | §AC.4, §AC.5, criterios 713, 749 |
| 2026-10-07 | P-EN-1 · ¿Los 8 tipos de energía? | Sí: Planta, Fuego, Agua, Rayo, Psíquica, Lucha, Oscura y Metálica | §AC.9 |
| 2026-10-07 | P-EN-2 · ¿Energías en «¿Te falta algo?»? | No, nunca | §AC.5 |
| 2026-10-07 | P-EN-3 · ¿Deck con 4 energías o menos? | «P-EN-3 y P-EN-7 van con la recomendación del product-owner» ⇒ no se muestra el paquete | §AC.10 |
| 2026-10-07 | P-EN-4 · ¿Cuándo «el deck está en el carrito»? | (a): cuando están todas las cartas de «Agregar de jalón» | §AC.10 |
| 2026-10-07 | P-EN-5 · ¿Reembolso del paquete? | «el paquete se reembolsa completo solo si se devuelve el deck completo» | §AC.10, criterio 744 |
| 2026-10-07 | P-EN-6 · ¿MX$20 y MX$5 editables? | «MX$5 y MX$20 se editan en el panel» | §AC.6, §AC.10 |
| 2026-10-07 | P-EN-7 · ¿Paquete en «Pegar lista»? | Con la recomendación del product-owner ⇒ no en esta versión | §AC.8 |
| 2026-10-08 | P-BMK-1…5 · Mercado junto a lo que pagamos: override, bounty, precio pendiente, total, «Mi cuenta» | «todo como recomiendas» ⇒ mercado igual con override y bounty; no en precio pendiente; no en el total; no en «Mi cuenta» | §BMK.2–§BMK.4, criterios 853, 854, 856 |
| 2026-09-01 | D30, D34–D40 · rondas 4ª, 6ª y 7ª del ciclo de buylist (oferta condicional NM, piso de neto MX$200 inclusivo, meta de bounty 2, el reloj reinicia al cancelar, «Declinar ahora», dirección al crear la solicitud) | Literal no conservado en `PROJECT.md`; resúmenes de ronda retirados el 2026-10-25, texto en git `ee8d5c73` | §P, criterios 16–172 |
