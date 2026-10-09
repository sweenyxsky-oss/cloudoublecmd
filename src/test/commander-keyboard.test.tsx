import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Commander } from '@/components/commander';

describe('Commander Shift arrow marking', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  });
  afterEach(cleanup);
  const grid = (side = 'Left') => screen.getByRole('grid', { name: `${side} files` });
  const row = (name: string, side = 'Left') => within(grid(side)).getByRole('row', { name: new RegExp(`\\[${name}\\]`) });
  const key = (name: string, shiftKey = false) => fireEvent.keyDown(grid(), { key: name, shiftKey });

  it('toggles the current row then moves down and up', () => {
    render(<Commander />);
    fireEvent.click(row('Downloads'));
    key('ArrowDown', true);
    expect(row('Downloads')).toHaveAttribute('aria-selected', 'true');
    expect(row('Movies')).toHaveClass('focused');
    key('ArrowUp');
    key('ArrowDown', true);
    expect(row('Downloads')).toHaveAttribute('aria-selected', 'false');
    key('ArrowUp', true);
    expect(row('Movies')).toHaveAttribute('aria-selected', 'true');
    expect(row('Downloads')).toHaveClass('focused');
  });

  it('marks consecutive rows and keeps ordinary arrows selection-neutral', () => {
    render(<Commander />);
    fireEvent.click(row('Downloads'));
    key('ArrowDown', true);
    key('ArrowDown', true);
    expect(within(grid()).getAllByRole('row', { selected: true })).toHaveLength(2);
    key('ArrowDown');
    expect(within(grid()).getAllByRole('row', { selected: true })).toHaveLength(2);
  });

  it('never marks the parent directory and clamps the cursor at edges', () => {
    render(<Commander />);
    key('Home');
    key('ArrowUp', true);
    key('ArrowDown', true);
    expect(within(grid()).getAllByRole('row', { selected: false })).toHaveLength(within(grid()).getAllByRole('row').length);
    expect(row('Downloads')).toHaveClass('focused');
    key('End');
    const last = within(grid()).getAllByRole('row').at(-1);
    key('ArrowDown', true);
    expect(last).toHaveClass('focused');
    expect(last).toHaveAttribute('aria-selected', 'true');
  });

  it('only changes the active pane', () => {
    render(<Commander />);
    fireEvent.click(row('Archives', 'Right'));
    key('ArrowDown', true);
    expect(row('Archives', 'Right')).toHaveAttribute('aria-selected', 'true');
    expect(within(grid()).queryAllByRole('row', { selected: true })).toHaveLength(0);
  });

  it('leaves Shift arrows in text inputs alone', () => {
    render(<Commander />);
    fireEvent.click(row('Downloads'));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Command line' }), { key: 'ArrowDown', shiftKey: true });
    expect(row('Downloads')).toHaveAttribute('aria-selected', 'false');
    expect(row('Downloads')).toHaveClass('focused');
  });
});