-- §PERSONA AG-25 (DECISIONES §PERSONA punto 7): `SpendAlertKind` += `in_person_with_fee`, AL FINAL.
-- Aditiva (precedente M-72/M-93): ninguna sentencia de este fichero usa el valor nuevo. El valor no se puede quitar: queda inerte.
ALTER TYPE "SpendAlertKind" ADD VALUE IF NOT EXISTS 'in_person_with_fee';
