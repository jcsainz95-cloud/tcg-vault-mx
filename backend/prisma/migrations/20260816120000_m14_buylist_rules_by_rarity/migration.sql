-- M-14 (v1.3.1): Precio de buylist por RAREZA OFICIAL.
-- Reemplaza el esquema de 3 categorías (BuylistCategory) por una regla por rareza.
-- SellRequestItem snapshotea la regla aplicada; `category` queda NULLABLE (retención legacy).

-- Nuevo enum de naturaleza de regla (fixed = MX$ centavos; pct = % de la referencia).
CREATE TYPE "BuylistRuleMode" AS ENUM ('fixed', 'pct');

-- `category` deja de ser obligatorio (la cotización v1.3.1 ya no lo escribe; se conserva
-- solo por retención de filas históricas). NO se borran datos.
ALTER TABLE "SellRequestItem" ALTER COLUMN "category" DROP NOT NULL;

-- Snapshot de la regla por rareza aplicada al cotizar (auditoría).
ALTER TABLE "SellRequestItem" ADD COLUMN "rarity" TEXT;
ALTER TABLE "SellRequestItem" ADD COLUMN "ruleMode" "BuylistRuleMode";
ALTER TABLE "SellRequestItem" ADD COLUMN "ruleValue" INTEGER;
ALTER TABLE "SellRequestItem" ADD COLUMN "ruleSource" TEXT;
