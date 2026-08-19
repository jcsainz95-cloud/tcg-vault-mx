-- M-25b (v1.21.2, D6): el CHECK que faltaba de los cinco invariantes de API_CONTRACT §4-G.10.
--
-- `InventoryItem.ownerType='customer' ⇒ ownerUserId IS NOT NULL`. Es el invariante que §4-G.0-1
-- llama literalmente «lo que hace segura la nulabilidad de `Order.userId`»: sin él, un bug futuro
-- que escriba `ownerType='customer'` con `ownerUserId=null` deja una pieza en el limbo — no sale
-- en la bóveda de nadie (todas las consultas filtran por `ownerUserId`), no es vendible
-- (`ownerType≠platform`) y no es ajustable en M1: una carta desaparecida en silencio.
--
-- ⚠️ `InventoryItem` es tabla del stream «Inventario y vault»: el orquestador serializa esta
-- migración. NO añade columnas ni valores de enum; solo un constraint.
--
-- PRECONDICIÓN (ARCHITECTURE §11, M-25b) — verificada contra Postgres real antes de escribirla:
--   SELECT count(*) FROM "InventoryItem" WHERE "ownerType"='customer' AND "ownerUserId" IS NULL;
--   → 0. Debe seguir siendo 0 en cada entorno ANTES de aplicar (hoy nada escribe esa combinación:
--   la reserva de bóveda siempre pone ownerUserId, y la de invitado nunca toca ownerType).
--   Si en algún entorno diera > 0, se corrige el dato ANTES de aplicar; el constraint no se fuerza.

ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_customer_has_owner_chk"
  CHECK ("ownerType" <> 'customer' OR "ownerUserId" IS NOT NULL);
