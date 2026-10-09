import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommanderTheme } from '@/hooks/use-commander-theme';

describe('Commander appearance preference', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('defaults to light and saves either theme across remounts', () => {
    const first = renderHook(useCommanderTheme);
    expect(first.result.current.theme).toBe('light');
    act(() => first.result.current.setTheme('dark'));
    expect(window.localStorage.getItem('cloudoublecmd.theme')).toBe('dark');
    first.unmount();
    const second = renderHook(useCommanderTheme);
    expect(second.result.current.theme).toBe('dark');
    act(() => second.result.current.setTheme('light'));
    second.unmount();
    expect(renderHook(useCommanderTheme).result.current.theme).toBe('light');
  });

  it('ignores invalid stored preferences', () => {
    window.localStorage.setItem('cloudoublecmd.theme', 'invalid');
    expect(renderHook(useCommanderTheme).result.current.theme).toBe('light');
  });

  it('keeps theme switching working when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
    const hook = renderHook(useCommanderTheme);
    act(() => hook.result.current.setTheme('dark'));
    expect(hook.result.current.theme).toBe('dark');
  });

  it('synchronizes appearance changes from another tab', () => {
    const hook = renderHook(useCommanderTheme);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'cloudoublecmd.theme', newValue: 'dark' })));
    expect(hook.result.current.theme).toBe('dark');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'cloudoublecmd.theme', newValue: 'light' })));
    expect(hook.result.current.theme).toBe('light');
  });
});