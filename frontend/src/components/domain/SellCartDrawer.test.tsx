import { describe, it, expect, vi } from 'vitest';
import { useRef, useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SellCartDrawer } from './SellCartDrawer';

/** Props mínimas del drawer (el copy real viene de BuylistView; aquí es literal). */
const BASE = {
  ariaLabel: 'Carrito de venta (2)',
  title: 'Carrito de venta',
  countLabel: '2 carta(s)',
  closeLabel: 'Cerrar carrito',
};

describe('SellCartDrawer (§18.4b) · drawer flotante del carrito', () => {
  it('cerrado: no renderiza nada (ni overlay ni diálogo)', () => {
    render(
      <SellCartDrawer open={false} onClose={vi.fn()} {...BASE}>
        <p>contenido</p>
      </SellCartDrawer>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('contenido')).not.toBeInTheDocument();
  });

  it('abierto: dialog con aria-modal + aria-label, encabezado (título + conteo), contenido y cierre 44px', () => {
    render(
      <SellCartDrawer open onClose={vi.fn()} {...BASE}>
        <p>contenido</p>
      </SellCartDrawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Carrito de venta (2)' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Carrito de venta')).toBeInTheDocument();
    expect(screen.getByText('2 carta(s)')).toBeInTheDocument();
    expect(screen.getByText('contenido')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar carrito' })).toBeInTheDocument();
    // Foco inicial en el panel del diálogo.
    expect(dialog).toHaveFocus();
  });

  it('cierra con Esc, con clic en el overlay y con el botón cerrar (no con clic dentro)', () => {
    const onClose = vi.fn();
    render(
      <SellCartDrawer open onClose={onClose} {...BASE}>
        <p>contenido</p>
      </SellCartDrawer>,
    );

    fireEvent.click(screen.getByText('contenido'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('sell-cart-overlay'));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar carrito' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('focus trap: Tab desde el último focusable regresa al primero (cerrar) y Shift+Tab al revés', () => {
    render(
      <SellCartDrawer open onClose={vi.fn()} {...BASE}>
        <button type="button">Vaciar carrito</button>
      </SellCartDrawer>,
    );
    const dialog = screen.getByRole('dialog');
    const closeBtn = screen.getByRole('button', { name: 'Cerrar carrito' });
    const lastBtn = screen.getByRole('button', { name: 'Vaciar carrito' });

    lastBtn.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(closeBtn).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(lastBtn).toHaveFocus();
  });

  it('al cerrar, el foco REGRESA al elemento de returnFocusRef (el FAB)', () => {
    function Harness() {
      const fabRef = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" ref={fabRef}>
            FAB
          </button>
          <SellCartDrawer
            open={open}
            onClose={() => setOpen(false)}
            returnFocusRef={fabRef}
            {...BASE}
          >
            <p>contenido</p>
          </SellCartDrawer>
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByRole('dialog')).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar carrito' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'FAB' })).toHaveFocus();
  });
});
