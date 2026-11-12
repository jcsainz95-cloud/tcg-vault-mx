-- §PROV F1 (correcciones de gate): motivo de cancelación del acuerdo (all_returned | none_received | pickup_expired). Aditiva.
ALTER TABLE "SupplyPurchase" ADD COLUMN "cancelReason" TEXT;
