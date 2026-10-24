-- ===============================================================================================================================
-- M-91 · v1.109.1⟨envio-v2⟩ (API_CONTRACT §4-G.12 punto 3) — SOLO DATOS, sin DDL. Propiedad: backend.
--
-- Qué hace: siembra los TRES diales del envío directo con su default de código (`SETTING_DEFAULTS`, idénticos: candado ENV-8),
-- todos EXHIBIDOS (IVA dentro; P-ENV-1 cerrada por el dueño 2026-10-24): `direct_ship_cards_fee_cents` 10000 (MX$100),
-- `direct_ship_sealed_fee_cents` 17500 (MX$175), `direct_ship_free_from_cents` 400000 (MX$4,000).
-- ⛔ NO copia `shipping_fee_cents`: ese dial es NETO (retiro desde bóveda, el cliente ve MX$203) y estos son exhibidos; copiarlo
--   cobraría el sellado directo a la convención equivocada. Al desplegar, el sellado directo pasa de MX$203 a MX$175 (decisión
--   del dueño). Idempotente (`ON CONFLICT DO NOTHING`): no pisa un valor ya escrito por `PUT /admin/settings` ni por el seed.
-- Comprobación (antes y después, quien despliega):
--   SELECT key, "valueJson", "updatedBy" FROM "ConfigSetting"
--    WHERE key IN ('shipping_fee_cents','direct_ship_cards_fee_cents','direct_ship_sealed_fee_cents','direct_ship_free_from_cents');
--
-- Reversa (manual, contrato §4-G.12 punto 3: «borrar las tres filas nuevas»):
--   DELETE FROM "ConfigSetting" WHERE key IN ('direct_ship_cards_fee_cents','direct_ship_sealed_fee_cents','direct_ship_free_from_cents');
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261108120000_m91_envio_v2_dials';
-- ===============================================================================================================================

INSERT INTO "ConfigSetting" ("key", "valueJson", "updatedBy", "updatedAt")
VALUES ('direct_ship_cards_fee_cents', '10000'::jsonb, 'migration:m91-envio-v2', CURRENT_TIMESTAMP),
       ('direct_ship_sealed_fee_cents', '17500'::jsonb, 'migration:m91-envio-v2', CURRENT_TIMESTAMP),
       ('direct_ship_free_from_cents', '400000'::jsonb, 'migration:m91-envio-v2', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
