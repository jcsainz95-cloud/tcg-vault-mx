-- §DECKS-TOP-FUENTE.12: contador de corridas válidas en que un deck de Limitless no aparece en el top N. Aditiva, sin backfill.
-- Reversa: ALTER TABLE "MetaDeck" DROP COLUMN "missedRuns";
ALTER TABLE "MetaDeck" ADD COLUMN "missedRuns" INTEGER NOT NULL DEFAULT 0;
