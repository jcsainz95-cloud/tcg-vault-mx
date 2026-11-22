import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M5View } from './M5View';
import * as api from '@/lib/api';

vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'vault_operator', setRole: () => {}, isSuperAdmin: false, canSwitchRole: false }),
}));
const params = { value: 'userId=u-777' };
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useSearchParams: () => new URLSearchParams(params.value),
}));

describe('§FICHA-CLIENTE · ?userId= en M5', () => {
  it('lee userId de la URL, filtra la lista y se quita con su ✕', async () => {
    const spy = vi.spyOn(api, 'getAdminBuylist');
    renderWithProviders(<M5View />, 'es');
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-777' })));
    fireEvent.click(await screen.findByTestId('m5-user-filter').then((el) => el.querySelector('button') as HTMLElement));
    await waitFor(() => expect(screen.queryByTestId('m5-user-filter')).not.toBeInTheDocument());
  });
});
