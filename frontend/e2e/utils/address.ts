import { expect, type Locator, type Page } from '@playwright/test';
import { t } from './i18n';

/**
 * v1.81 (`API_CONTRACT §M4-SHIP.19.5`, criterio 235): la colonia se ELIGE de la lista del CP
 * (`GET /geo/postal-codes/:cp`), no se teclea. Se espera a que la opción exista —la lista llega por
 * red tras teclear el CP— y se elige. Los CP que usan los specs están en el catálogo del arnés
 * (`backend/prisma/e2e-fixtures.ts`, `E2E_POSTAL_CODES`) y en el doble del modo mock
 * (`src/lib/mock/skydropx.ts`, `POSTAL_CODES`).
 */
export async function chooseNeighborhood(scope: Page | Locator, neighborhood: string): Promise<void> {
  const select = scope.getByRole('combobox', { name: t('es', 'addresses.neighborhood'), exact: true });
  await expect(select.locator('option', { hasText: neighborhood })).toHaveCount(1);
  await select.selectOption({ label: neighborhood });
}
