-- M-98 — `m98_stamp_event_promo` (P-PROMOS C). Contrato: API_CONTRACT §2 «P-PROMOS»; ARCHITECTURE §5.12. Va DESPUÉS de M-97.
-- 100% ADITIVA: el enum `StampType` gana `event_promo` («Promo de evento»). Sin IF NOT EXISTS no sería re-ejecutable; se usa para
-- que el re-deploy tras una reversa (Postgres no quita valores) no falle con 42710. Ninguna sentencia usa el valor en esta tx.
ALTER TYPE "StampType" ADD VALUE IF NOT EXISTS 'event_promo';
