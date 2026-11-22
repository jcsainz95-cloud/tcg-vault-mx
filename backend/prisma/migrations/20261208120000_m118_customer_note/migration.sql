-- §FICHA-CLIENTE (contrato §1b): notas internas del equipo sobre un cliente. Aditiva, sin tocar datos.
-- Reversa: DROP TABLE "CustomerNote";  (pierde solo las notas; retirar el bloque «Notas internas» de la ficha).
CREATE TABLE "CustomerNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" VARCHAR(1000) NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerNote_authorId_clientRequestId_key" ON "CustomerNote"("authorId", "clientRequestId");
CREATE INDEX "CustomerNote_userId_pinned_createdAt_idx" ON "CustomerNote"("userId", "pinned", "createdAt");

ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
