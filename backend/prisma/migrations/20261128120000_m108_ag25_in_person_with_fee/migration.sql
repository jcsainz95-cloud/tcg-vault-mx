-- §PERSONA AG-25 (DECISIONES §PERSONA punto 7): `SpendAlertKind` += `in_person_with_fee`, AL FINAL.
-- Aditiva (precedente M-72/M-93): ninguna sentencia de este fichero usa el valor nuevo. El valor no se puede quitar: queda inerte.
-- REVERSIÓN: un valor de enum no se puede quitar de Postgres; queda inerte. Para dejar de usarlo, revertir el código
-- (AG-25) y, si se quiere limpiar, `DELETE FROM "SpendAlert" WHERE kind='in_person_with_fee'` (las filas no tienen dependientes).
ALTER TYPE "SpendAlertKind" ADD VALUE IF NOT EXISTS 'in_person_with_fee';
