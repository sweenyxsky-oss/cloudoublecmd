import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Commander } from '@/components/commander';

describe('sample copy/move background workflow', () => {
  beforeEach(() => {
    vi.useFakeTimers(); window.localStorage.clear();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  function startMove() {
    render(<Commander />);
    fireEvent.click(within(screen.getByRole('grid', { name: 'Left files' })).getByRole('row', { name: /\[Downloads\]/ }));
    fireEvent.keyDown(screen.getByRole('grid', { name: 'Left files' }), { key: 'F6' });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Move' }));
  }
  it('pauses, minimizes and completes without deleting source early', () => {
    startMove();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0');
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0');
    fireEvent.click(screen.getByRole('button', { name: 'Background' }));
    expect(within(screen.getByRole('grid', { name: 'Left files' })).getByRole('row', { name: /\[Downloads\]/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore move transfer 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    fireEvent.click(screen.getByRole('button', { name: 'Background' }));
    act(() => vi.advanceTimersByTime(10000));
    expect(within(screen.getByRole('grid', { name: 'Left files' })).queryByRole('row', { name: /\[Downloads\]/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole('grid', { name: 'Right files' })).getByRole('row', { name: /\[Downloads\]/ })).toBeInTheDocument();
  });
  it('cancels without changing either directory', () => {
    startMove();
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel transfer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close transfer window' }));
    act(() => vi.advanceTimersByTime(10000));
    expect(within(screen.getByRole('grid', { name: 'Left files' })).getByRole('row', { name: /\[Downloads\]/ })).toBeInTheDocument();
    expect(within(screen.getByRole('grid', { name: 'Right files' })).queryByRole('row', { name: /\[Downloads\]/ })).not.toBeInTheDocument();
  });
});
describe('Enter and duplicate actions', () => {
  beforeEach(() => { vi.useFakeTimers(); window.localStorage.clear(); Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() }); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  it('confirms with Enter, shows details, skips all and hides completed minimized jobs', () => {
    render(<Commander />);
    const left = screen.getByRole('grid', { name: 'Left files' });
    fireEvent.click(within(left).getByRole('row', { name: /README/ }));
    fireEvent.keyDown(left, { key: 'F5' });
    fireEvent.keyDown(within(screen.getByRole('dialog')).getByRole('textbox'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Background' }));
    expect(screen.getByRole('progressbar', { name: 'Transfer 1 progress' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(9000));
    expect(screen.queryByLabelText('Background transfers')).not.toBeInTheDocument();
    fireEvent.click(within(left).getByRole('row', { name: /README/ }));
    fireEvent.keyDown(left, { key: 'F5' });
    fireEvent.keyDown(within(screen.getByRole('dialog')).getByRole('textbox'), { key: 'Enter' });
    expect(screen.getByText('Incoming file')).toBeInTheDocument();
    expect(screen.getByText('Existing file')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip all' }));
    act(() => vi.advanceTimersByTime(9000));
    fireEvent.click(screen.getByRole('button', { name: 'Close transfer window' }));
    expect(within(screen.getByRole('grid', { name: 'Right files' })).getAllByRole('row', { name: /README/ })).toHaveLength(1);
  });
});
