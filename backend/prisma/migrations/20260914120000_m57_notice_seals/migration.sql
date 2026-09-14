-- M-57 — migración `v1.74` (centro de avisos · API_CONTRACT §R.6 · ARCHITECTURE §4.54.4).
--
-- DDL ADITIVO Y MÍNIMO: **tres columnas de SELLO**, y ninguna más. Cero tablas nuevas (⛔ no hay
-- `Notification`, ni `NotificationRead`, ni `NotificationPreference`: la campana se DERIVA, §4.54.2),
-- cero cambios de tipo, cero `DROP`. Segura con la app corriendo.
--
-- QUÉ ES UN SELLO: la regla transversal `D-AVISO-2` («sellar y LUEGO enviar», §R.4) reclama el
-- derecho a avisar con una escritura condicional —`UPDATE … SET <sello> = now() WHERE id = :id AND
-- <sello> IS NULL`— y manda el correo **solo si `count === 1`**. Dos corridas concurrentes no pueden
-- mandarlo dos veces: gana una y la otra ve `count = 0`. El mecanismo NO se estrena aquí; se hereda
-- de `jobs/buylist-sweep.service.ts` (`offerAcceptReminderSentAt`, `shipReminderSentAt`).
--
-- ⚠️ POR QUÉ SOLO TRES, cuando los avisos son ONCE: los otros OCHO **no estrenan columna**. Su «una
-- sola vez» ya la da una guarda del motor que este sistema construyó para no cobrar dos veces
-- (`updateMany` + `count === 1`, `sealOnceTx`, los early-return por estado destino de `settled` y
-- `refunded`, el corto-circuito de `pay-spei`, y la tabla `TRANSITIONS` de M4). Estrenan columna
-- exactamente los tres disparadores que SÍ pueden repetirse sobre el mismo hecho.
--
-- ⛔ SIN BACKFILL, y es la verdad, no un atajo: `NULL` significa «nunca se avisó», y eso es
-- literalmente cierto en toda fila existente — hoy no existe ninguno de los once correos.
-- ⛔ SIN ÍNDICE: las tres se leen **por id** dentro de una operación que ya cargó la fila (y
-- `KycProfile.userId` ya es `@unique`). Un índice aquí sería coste de escritura por cero lecturas.
-- ⛔ SIN DEFAULT: un `DEFAULT now()` marcaría como «ya avisado» a todo lo que se cree después.
-- ⛔ FUERA DE TODO DTO (cliente y admin): son un hecho sobre NUESTRO envío de correo, no sobre la
-- identidad, el envío ni la solicitud. Publicarlas convertiría un detalle de implementación en una
-- promesa de contrato. Candado: `test/avisos.seals-out-of-dto.spec.ts`.
--
-- REVERSA (las tres, en cualquier orden; el artefacto anterior las ignora por completo):
--   ALTER TABLE "KycProfile"      DROP COLUMN "kycRejectionNoticeSentAt";
--   ALTER TABLE "ShipmentRequest" DROP COLUMN "trackingNoticeSentAt";
--   ALTER TABLE "SellRequest"     DROP COLUMN "guideNoticeSentAt";
-- ⚠️ La reversa PIERDE el rastro de a quién ya se le avisó: re-aplicar la migración deja las
-- columnas en `NULL` y el siguiente disparador **volvería a mandar** ese correo. No es pérdida de
-- dinero ni de estado de negocio, pero se dice.

-- AV-1 · rechazo de identidad (§R.3). El ciclo se reinicia al RESUBIR el INE o al deshacer el
-- rechazo (`verified`/`none`) — §R.4.a. Un segundo rechazo consecutivo NO lo reinicia.
ALTER TABLE "KycProfile" ADD COLUMN "kycRejectionNoticeSentAt" TIMESTAMP(3);

-- AV-4 · guía al COMPRADOR (§R.3.a: cuelga de la CAPTURA de la etiqueta, jamás del estado `guia`).
-- Se limpia en la misma escritura que cambia la etiqueta si el par `(carrier, trackingNumber)`
-- queda DISTINTO (§R.4.b).
ALTER TABLE "ShipmentRequest" ADD COLUMN "trackingNoticeSentAt" TIMESTAMP(3);

-- AV-7 · guía al VENDEDOR. Misma regla de reinicio por VALOR sobre
-- `(shipmentCarrier, shipmentTrackingNumber)`.
ALTER TABLE "SellRequest" ADD COLUMN "guideNoticeSentAt" TIMESTAMP(3);
