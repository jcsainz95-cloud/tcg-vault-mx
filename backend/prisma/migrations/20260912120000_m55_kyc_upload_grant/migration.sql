-- M-55 — migración `v1.70` (C15 / SEC-PII-1 · docs/SECURITY_NOTES.md §4.1).
-- DDL ADITIVO: una tabla NUEVA. No toca ninguna columna existente, no hay backfill posible y no lo
-- necesita (ver abajo). Serializada tras M-54.
--
-- QUÉ CIERRA: la compuerta de identificación AML se satisfacía con DOS CADENAS ARBITRARIAS. Las dos
-- puertas de cumplimiento —el intake (`POST /buylist/requests`) y la emisión de la oferta— miden
-- `ineFrontKey != null && ineBackKey != null`, y ese booleano **lo escribía el cliente**: mandaba
-- `{front:'a', back:'b'}` y cobraba a su CLABE sin habernos dado nunca una identificación.
-- Esta tabla es la prueba, del lado del servidor, de que una key LA EMITIMOS NOSOTROS y PARA ESE
-- USUARIO. Se escribe al firmar el presign y se consulta al registrar la key en el expediente.
--
-- ⛔ NO GUARDA PII: `objectKey` es un puntero (`kyc_ine/<fecha>/<uuid>.<ext>`), no una imagen ni un
-- dato de la persona. La imagen vive en el bucket privado.
--
-- ⚠️ SIN BACKFILL, Y ES UNA DECISIÓN, NO UN OLVIDO: no existe forma de saber, hacia atrás, qué keys
-- de los `KycProfile` de hoy salieron de un presign legítimo. Inventar un permiso para cada key
-- existente sería FIRMAR RETROACTIVAMENTE lo que este control existe para comprobar. Las filas
-- anteriores se tratan como lo que son —no verificables— y esa decisión (migrar, re-pedir el
-- documento, o aceptarlas) es del DUEÑO, no de esta migración. Enrutado en `BACKEND_NOTES §P78.12`.
--
-- REVERSA: `DROP TABLE "KycUploadGrant";` — el artefacto anterior ignora la tabla por completo.
CREATE TABLE "KycUploadGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycUploadGrant_pkey" PRIMARY KEY ("id")
);

-- Una llave pertenece a UNA persona: el `@unique` es parte del control, no una optimización.
CREATE UNIQUE INDEX "KycUploadGrant_objectKey_key" ON "KycUploadGrant"("objectKey");
CREATE INDEX "KycUploadGrant_userId_idx" ON "KycUploadGrant"("userId");

-- `Cascade`: si la cuenta se borra (hard delete), sus permisos se van con ella.
ALTER TABLE "KycUploadGrant"
  ADD CONSTRAINT "KycUploadGrant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
