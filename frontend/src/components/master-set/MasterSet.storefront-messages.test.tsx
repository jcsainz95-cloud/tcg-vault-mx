import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import es from '../../../messages/es.json';
import { storefrontMessages } from '@/i18n/message-scopes';
import { MasterSetPanel } from './MasterSetPanel';
import type { MasterSetViewMode } from './mode';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * TL-DYN3-1 (§DYN.3) · la tienda recibe `storefrontMessages()` (sin `admin`). `MasterSetPanel` es compartido y sus
 * piezas con textos `admin.*` (`VariantPricingCompact` de `MasterSetBinder`, `VariantPriceConsole`, `QuickAddSection`
 * de `CellDrawer`) solo se pintan en modo plataforma. Montado como lo montan la tienda (`VaultView`: `user_vault_self`;
 * `BuylistView`: `quoter`), con el binder abierto y el drawer de una carta abierto ⇒ 0 `MISSING_MESSAGE`.
 * El modo `platform` con los mismos mensajes es el control: ahí SÍ faltan (si no faltaran, la prueba no vería nada).
 */
async function missingIn(mode: MasterSetViewMode): Promise<{ missing: string[]; dialog: boolean }> {
  const errors: string[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="es"
        timeZone="America/Mexico_City"
        messages={storefrontMessages(es)}
        onError={(e) => errors.push(`${e.code}: ${e.message}`)}
        getMessageFallback={({ key }) => key}
      >
        <MasterSetPanel mode={mode} onBuyMissing={() => undefined} onAddToSellCart={() => undefined} isInCart={() => false} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  fireEvent.change(await screen.findByLabelText('Buscar set'), { target: { value: 'Base' } });
  fireEvent.click(await screen.findByRole('button', { name: /Base Set/ }));
  await screen.findByRole('heading', { level: 2, name: 'Base Set' });
  await screen.findAllByText('#4');
  const tiles = await screen.findAllByRole('button', { name: /Charizard/ });
  fireEvent.click(tiles[0]);
  const dialog = await screen.findByRole('dialog').then(() => true, () => false);
  return { missing: errors.filter((e) => e.startsWith('MISSING_MESSAGE')), dialog };
}

describe('TL-DYN3-1 · MasterSetPanel con los mensajes de la tienda', () => {
  it('user_vault_self (Mi bóveda): 0 MISSING_MESSAGE con el binder y el drawer abiertos', async () => {
    const { missing, dialog } = await missingIn('user_vault_self');
    expect(dialog).toBe(true);
    expect(missing).toEqual([]);
  });

  it('quoter (Vender / buylist): 0 MISSING_MESSAGE con el binder y una carta pulsada', async () => {
    const { missing, dialog } = await missingIn('quoter');
    expect(dialog).toBe(true);
    expect(missing).toEqual([]);
  });

  it('control: en modo platform con los mismos mensajes SÍ faltan textos admin.* (la sonda ve)', async () => {
    const { missing, dialog } = await missingIn('platform');
    expect(dialog).toBe(true);
    expect(missing.some((e) => /admin\./.test(e))).toBe(true);
  });
});
