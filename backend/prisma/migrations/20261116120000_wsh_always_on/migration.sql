-- wsh_always_on (HECHOS 2026-11-08; ARCHITECTURE §5.14): la lista de deseos queda siempre activa; el dial deja de existir.
-- Idempotente. No toca WishlistItem/WishlistNotice ni los demás diales. (M-74 no se edita.)
DELETE FROM "ConfigSetting" WHERE key = 'wishlist_enabled';
