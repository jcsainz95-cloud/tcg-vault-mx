-- m112 · §DEMANDA (API_CONTRACT_DEMANDA §4). ADITIVA: solo CREATE TABLE; no toca ninguna tabla existente.
-- REVERSA (documentada, no automática):
--   DROP TABLE "DemandTermMatch"; DROP TABLE "SearchDemandSeen"; DROP TABLE "SearchDemandDaily";
--   y retirar del schema.prisma los tres modelos §DEMANDA. (Los diales demand_* de ConfigSetting son filas opcionales: se pueden dejar o borrar.)

CREATE TABLE "SearchDemandDaily" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "people" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SearchDemandDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SearchDemandDaily_cardId_day_key" ON "SearchDemandDaily"("cardId", "day");
CREATE INDEX "SearchDemandDaily_cardId_idx" ON "SearchDemandDaily"("cardId");

CREATE TABLE "SearchDemandSeen" (
    "cardId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "h" TEXT NOT NULL,

    CONSTRAINT "SearchDemandSeen_pkey" PRIMARY KEY ("cardId","day","h")
);

CREATE TABLE "DemandTermMatch" (
    "termNormalized" TEXT NOT NULL,
    "cardId" TEXT,
    "status" TEXT NOT NULL,
    "matchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemandTermMatch_pkey" PRIMARY KEY ("termNormalized")
);
