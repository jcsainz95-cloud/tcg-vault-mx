import { isLegalStandardNow } from './standard-legality';

/**
 * DECKS-META §2.3 (Fase 0) — casos de `isLegalStandardNow`. La legalidad es DERIVADA y money-safe:
 * cualquier duda cae a NO legal. Estos casos fijan el contrato exacto del helper.
 */
describe('isLegalStandardNow (DECKS-META §2.3) — legalidad Standard derivada, money-safe', () => {
  const cfg = { activeMarks: ['G', 'H', 'I'], banlistCardIds: ['sv1-25'] };

  it('marca ACTIVA + no baneada + no en banlist ⇒ LEGAL', () => {
    expect(
      isLegalStandardNow(
        { regulationMark: 'H', legalStandardRaw: 'Legal', externalId: 'sv8-1' },
        cfg,
      ),
    ).toBe(true);
  });

  it('marca ACTIVA con legalStandardRaw null (proveedor no lo trae) ⇒ LEGAL (la banda es solo para "Banned")', () => {
    expect(
      isLegalStandardNow(
        { regulationMark: 'G', legalStandardRaw: null, externalId: 'sv1-1' },
        cfg,
      ),
    ).toBe(true);
  });

  it('marca VIEJA (rotó fuera de la ventana) ⇒ NO legal', () => {
    expect(
      isLegalStandardNow(
        { regulationMark: 'F', legalStandardRaw: 'Legal', externalId: 'swsh-1' },
        cfg,
      ),
    ).toBe(false);
  });

  it('regulationMark null (no re-sincronizada / promo sin marca) ⇒ NO legal (conservador)', () => {
    expect(
      isLegalStandardNow(
        { regulationMark: null, legalStandardRaw: 'Legal', externalId: 'promo-1' },
        cfg,
      ),
    ).toBe(false);
  });

  it('regulationMark cadena vacía ⇒ NO legal (falsy, no probable)', () => {
    expect(
      isLegalStandardNow(
        { regulationMark: '', legalStandardRaw: 'Legal', externalId: 'promo-2' },
        cfg,
      ),
    ).toBe(false);
  });

  it('marca activa pero legalStandardRaw = "Banned" ⇒ NO legal (ban del proveedor)', () => {
    expect(
      isLegalStandardNow(
        { regulationMark: 'H', legalStandardRaw: 'Banned', externalId: 'sv8-9' },
        cfg,
      ),
    ).toBe(false);
  });

  it('marca activa pero externalId en banlist de operación ⇒ NO legal (override)', () => {
    expect(
      isLegalStandardNow(
        { regulationMark: 'G', legalStandardRaw: 'Legal', externalId: 'sv1-25' },
        cfg,
      ),
    ).toBe(false);
  });

  it('ventana vacía ⇒ nada es legal (rotación no configurada aún)', () => {
    expect(
      isLegalStandardNow(
        { regulationMark: 'H', legalStandardRaw: 'Legal', externalId: 'sv8-1' },
        { activeMarks: [], banlistCardIds: [] },
      ),
    ).toBe(false);
  });
});
