-- M-52 — migración `v1.67-cuenta-del-cliente` (ARCHITECTURE §11 «v1.67-cuenta-del-cliente», §4.47.4, §4.47.5).
-- DDL ADITIVO + enum + backfill DETERMINISTA. Aditiva y reversible sin ceremonia: el artefacto
-- anterior IGNORA las dos columnas (nullable / con default). El `down` no borra nada.
--
-- M-52a — `Address.recipientName`: quien recibe en ESA dirección (dato de etiqueta, §4.47.4).
-- Nullable, SIN default, SIN backfill: no hay de dónde rellenarlo sin inventar. Las filas viejas
-- quedan NULL y el retiro pide completarlo (422 RECIPIENT_NAME_REQUIRED). ⛔ Prohibido derivarlo de
-- `User.name` aquí o en el servidor: `name` puede ser fabricado (M-52b) y, aunque no lo fuera, el
-- nombre de cuenta y el nombre de quien recibe un paquete son hechos distintos.
ALTER TABLE "Address" ADD COLUMN "recipientName" TEXT;

-- M-52b — `User.nameSource`: de dónde salió `name` (§4.47.5). `NOT NULL DEFAULT 'user'` es correcto
-- para toda fila `local` (registro y alta admin teclean el nombre).
CREATE TYPE "NameSource" AS ENUM ('user', 'google', 'derived');
ALTER TABLE "User" ADD COLUMN "nameSource" "NameSource" NOT NULL DEFAULT 'user';

-- Backfill DETERMINISTA: la regla de auth.service `google()` (`name = identity.name ?? email.split('@')[0]`)
-- aplicada hacia atrás. Las dos sentencias solo tocan `authProvider='google'` ⇒ no pueden marcar como
-- inventado un nombre tecleado en una cuenta local. Idempotente (una 2ª corrida no cambia nada).
-- Falso positivo aceptado (§11): una cuenta Google cuyo nombre real coincida letra por letra con el
-- trozo local de su correo queda `derived`; el único efecto es el aviso «revisa tu nombre».
UPDATE "User" SET "nameSource" = 'derived'
 WHERE "authProvider" = 'google' AND "name" = split_part("email", '@', 1);
UPDATE "User" SET "nameSource" = 'google'
 WHERE "authProvider" = 'google' AND "nameSource" = 'user';

-- Sin índices nuevos (ninguna consulta filtra por estas columnas). Sin seeds.
