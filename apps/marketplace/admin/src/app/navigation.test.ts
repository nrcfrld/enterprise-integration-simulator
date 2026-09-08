import { describe, expect, it } from "vitest";
import { CONTROL_NAVIGATION, CONTROL_PATHS } from "./navigation";

describe("control-plane navigation", () => {
  it("keeps the requested menu hierarchy and operational destinations", () => {
    expect(
      CONTROL_NAVIGATION.map((section) => [
        section.label,
        section.items.map((item) => item.label),
      ]),
    ).toEqual([
      ["Overview", ["Overview"]],
      ["OPERATIONS", ["Orders", "Products", "Warehouses & Inventory", "Packages", "Shipments"]],
      ["INTEGRATION", ["API Credentials", "Webhooks", "Webhook Deliveries"]],
      ["SIMULATION", ["Scenarios", "Event Logs"]],
      ["DEVELOPER", ["API Documentation", "Integration Guide"]],
    ]);

    const entries = Object.fromEntries(
      CONTROL_NAVIGATION.flatMap((section) =>
        section.items.map((item) => [item.label, item]),
      ),
    );

    expect(entries["Shipments"].page).toBe("Shipments");
    expect(CONTROL_PATHS[entries["Shipments"].page]).toBe("/shipments");
    expect(entries["Shipments"].showActiveState).not.toBe(false);
    expect(CONTROL_PATHS[entries["Warehouses & Inventory"].page]).toBe("/warehouses");
    expect(CONTROL_PATHS[entries["Event Logs"].page]).toBe("/events");
    expect(CONTROL_PATHS[entries["Integration Guide"].page]).toBe("/docs");
  });
});
