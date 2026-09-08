// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useBoundedRefresh } from "./useBoundedRefresh";

afterEach(() => vi.useRealTimers());

it("bounds checks, restarts manually, and stops on terminal state or unmount", async () => {
  vi.useFakeTimers();
  const refresh = vi.fn().mockResolvedValue(undefined);
  const { result, rerender, unmount } = renderHook(({ enabled }) => useBoundedRefresh("shop_1", enabled, refresh), { initialProps: { enabled: true } });
  for (let i = 0; i < 12; i++) await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(refresh).toHaveBeenCalledTimes(12);
  expect(result.current.polling).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(refresh).toHaveBeenCalledTimes(12);
  await act(async () => { await result.current.refreshNow(); });
  expect(result.current.polling).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(refresh).toHaveBeenCalledTimes(14);
  rerender({ enabled: false });
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(refresh).toHaveBeenCalledTimes(14);
  rerender({ enabled: true });
  unmount();
  await vi.advanceTimersByTimeAsync(60000);
  expect(refresh).toHaveBeenCalledTimes(14);
});

it("never overlaps slow checks and does not continue a previous shop's timer", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const refresh = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const { rerender } = renderHook(({ scope, enabled }) => useBoundedRefresh(scope, enabled, refresh), { initialProps: { scope: "shop_a", enabled: true } });
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(refresh).toHaveBeenCalledTimes(1);
  rerender({ scope: "shop_b", enabled: false });
  await act(async () => { finish(); await vi.advanceTimersByTimeAsync(60000); });
  expect(refresh).toHaveBeenCalledTimes(1);
});
