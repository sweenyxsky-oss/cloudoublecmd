import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Commander } from '@/components/commander';
beforeEach(() => { vi.useFakeTimers(); window.localStorage.clear(); Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('short right click toggles marking and long right hold opens actions', () => {
  render(<Commander />);
  const row = within(screen.getByRole('grid', { name: 'Left files' })).getByRole('row', { name: /README/ });
  fireEvent.mouseDown(row, { button: 2 }); fireEvent.mouseUp(window, { button: 2 });
  expect(row).toHaveAttribute('aria-selected', 'true'); expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.mouseDown(row, { button: 2 }); fireEvent.mouseUp(window, { button: 2 });
  expect(row).toHaveAttribute('aria-selected', 'false');
  fireEvent.mouseDown(row, { button: 2 }); act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByRole('dialog', { name: 'File actions' })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Properties' }));
  expect(screen.getByRole('dialog', { name: 'Properties' })).toBeInTheDocument();
});
it('right drag marks each crossed row once', () => {
  render(<Commander />); const rows = within(screen.getByRole('grid', { name: 'Left files' })).getAllByRole('row');
  if (!rows[1] || !rows[2]) throw new Error('Expected sample rows');
  fireEvent.mouseDown(rows[1], { button: 2 }); fireEvent.mouseEnter(rows[2], { buttons: 2 }); fireEvent.mouseEnter(rows[1], { buttons: 2 }); fireEvent.mouseUp(window);
  expect(rows[1]).toHaveAttribute('aria-selected', 'true'); expect(rows[2]).toHaveAttribute('aria-selected', 'true');
  act(() => vi.advanceTimersByTime(1500)); expect(screen.queryByRole('dialog')).toBeNull();
});
it.each([false, true])('drop uses captured source and shift move=%s', move => {
  render(<Commander />); const left = screen.getByRole('grid', { name: 'Left files' }); const right = screen.getByRole('region', { name: 'Right file pane' });
  const row = within(left).getByRole('row', { name: /README/ });
  const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
  fireEvent.dragStart(row, { dataTransfer }); fireEvent.pointerDown(right); const drop = new Event('drop', { bubbles: true, cancelable: true }); Object.defineProperties(drop, { dataTransfer: { value: dataTransfer }, shiftKey: { value: move } }); fireEvent(right, drop);
  const dialog = screen.getByRole('dialog'); expect(dialog).toHaveTextContent(move ? 'Move 1' : 'Copy 1');
  fireEvent.keyDown(within(dialog).getByRole('textbox'), { key: 'Enter' }); act(() => vi.advanceTimersByTime(9000)); fireEvent.click(screen.getByRole('button', { name: 'Close transfer window' }));
  expect(within(screen.getByRole('grid', { name: 'Right files' })).getByRole('row', { name: /README/ })).toBeInTheDocument();
  expect(within(left).queryByRole('row', { name: /README/ }) !== null).toBe(!move);
});
