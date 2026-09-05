import { describe, expect, it, vi } from "vitest";
import { runMassOrders } from "./massOrders";

describe("runMassOrders", () => {
  it("bounds concurrent work and reports successful and rejected orders", async () => {
    let active = 0;
    let peak = 0;
    const progress = vi.fn();

    const result = await runMassOrders({
      total: 8,
      concurrency: 3,
      onProgress: progress,
      createOrder: async (index) => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        if (index >= 5) throw new Error("insufficient inventory");
      },
    });

    expect(peak).toBe(3);
    expect(result).toEqual({
      created: 5,
      rejected: 3,
      errors: [
        "insufficient inventory",
        "insufficient inventory",
        "insufficient inventory",
      ],
    });
    expect(progress).toHaveBeenLastCalledWith({
      completed: 8,
      created: 5,
      rejected: 3,
      total: 8,
    });
  });

  it.each([
    [0, 1, "Order count must be a positive integer."],
    [1, 0, "Concurrency must be a positive integer."],
  ])("rejects invalid limits", async (total, concurrency, message) => {
    await expect(runMassOrders({ total, concurrency, createOrder: vi.fn() }))
      .rejects.toThrow(message);
  });
});
