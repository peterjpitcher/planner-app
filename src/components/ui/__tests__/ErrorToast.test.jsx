import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useErrorToast } from '../ErrorToast';

describe('useErrorToast', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts with no error', () => {
    const { result } = renderHook(() => useErrorToast());
    expect(result.current.error).toBeNull();
  });

  it('surfaces a reported message', () => {
    const { result } = renderHook(() => useErrorToast());
    act(() => { result.current.reportError('Could not save the project.'); });
    expect(result.current.error).toBe('Could not save the project.');
  });

  it('falls back to a generic message when the error has none', () => {
    // apiClient can reject with an error carrying no message; a blank toast
    // would be as uninformative as the silent failure it replaced.
    const { result } = renderHook(() => useErrorToast());
    act(() => { result.current.reportError(undefined); });
    expect(result.current.error).toMatch(/not saved/i);
  });

  it('auto-dismisses after the duration', () => {
    const { result } = renderHook(() => useErrorToast(6000));
    act(() => { result.current.reportError('boom'); });
    act(() => { vi.advanceTimersByTime(5999); });
    expect(result.current.error).toBe('boom');
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.error).toBeNull();
  });

  it('dismisses on demand', () => {
    const { result } = renderHook(() => useErrorToast());
    act(() => { result.current.reportError('boom'); });
    act(() => { result.current.dismiss(); });
    expect(result.current.error).toBeNull();
  });

  it('restarts the countdown when a second failure arrives', () => {
    // Two failures in quick succession must not let the first one's timer cut
    // the second message short.
    const { result } = renderHook(() => useErrorToast(6000));
    act(() => { result.current.reportError('first'); });
    act(() => { vi.advanceTimersByTime(5000); });
    act(() => { result.current.reportError('second'); });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current.error).toBe('second');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.error).toBeNull();
  });

  it('clears its timer on unmount', () => {
    const { result, unmount } = renderHook(() => useErrorToast());
    act(() => { result.current.reportError('boom'); });
    unmount();
    // A surviving timer would call setState on an unmounted component.
    expect(() => vi.runAllTimers()).not.toThrow();
  });
});
