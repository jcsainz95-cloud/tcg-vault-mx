import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import type { SealedPriceStatusResponse } from '@/types/contract';
import { SealedPriceStatusSection } from './SealedPriceStatusSection';

const roleState = vi.hoisted(() => ({ role: 'super_admin' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: roleState.role,
    setRole: () => {},
    isSuperAdmin: roleState.role === 'super_admin',
    canSwitchRole: true,
  }),
}));

function ref(id: string, name: string) {
  return { id, name };
}

const RESPONSE: SealedPriceStatusResponse = {
  sealedPriceSource: 'off',
  page: 1,
  pageSize: 20,
  total: 3,
  data: [
    {
      set: ref('s-priced', 'Chaos Rising'),
      setMainGroupId: 100,
      linkedGroupIds: [100],
      productCount: 4,
      priced: 4,
      mappedUnpriced: 0,
      unmapped: 0,
      state: 'priced',
    },
    {
      set: ref('s-mapped', 'Pitch Black'),
      setMainGroupId: 200,
      linkedGroupIds: [200],
      productCount: 3,
      priced: 0,
      mappedUnpriced: 3,
      unmapped: 0,
      state: 'mapped_unpriced',
      reason: 'dial_off',
    },
    {
      set: ref('s-unmapped', 'Silver Tempest'),
      setMainGroupId: null,
      linkedGroupIds: [],
      productCount: 2,
      priced: 0,
      mappedUnpriced: 0,
      unmapped: 2,
      state: 'unmapped',
      reason: 'no_group',
    },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.role = 'super_admin';
  vi.spyOn(api, 'getSealedPriceStatus').mockResolvedValue(RESPONSE);
});

describe('SealedPriceStatusSection · estado por set (§diseño §10)', () => {
  it('M11-status-three-states: pinta los tres estados y sus motivos', async () => {
    renderWithProviders(<SealedPriceStatusSection />, 'es');
    expect(await screen.findByText('Con precio')).toBeInTheDocument();
    expect(screen.getByText('Emparejado sin precio')).toBeInTheDocument();
    expect(screen.getByText('SIN emparejar')).toBeInTheDocument();
    // El motivo del set mapeado sin precio se lee (dial apagado).
    expect(screen.getByText(/la fuente automática está apagada/i)).toBeInTheDocument();
  });

  it('super_admin puede abrir el mapeo manual desde una fila', async () => {
    renderWithProviders(<SealedPriceStatusSection />, 'es');
    // El set SIN emparejar ofrece «Emparejar grupo».
    fireEvent.click(await screen.findByRole('button', { name: /Emparejar grupo/ }));
    expect(await screen.findByRole('dialog', { name: /Mapeo manual del grupo TCGCSV/ })).toBeInTheDocument();
  });

  it('vault_operator NO ve el botón de mapeo (dinero/curación es super_admin)', async () => {
    roleState.role = 'vault_operator';
    renderWithProviders(<SealedPriceStatusSection />, 'es');
    await screen.findByText('Con precio');
    expect(screen.queryByRole('button', { name: /Emparejar grupo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Corregir grupo/ })).not.toBeInTheDocument();
  });
});
