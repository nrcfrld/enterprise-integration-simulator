import { describe, expect, it } from "vitest";
import accepted from "../../../../internal/webhooks/events.go?raw";
import openapi from "../../../../openapi/openapi.yaml?raw";
import { EVENT_CATALOG, eventMapping } from "./catalog";

describe("event catalog contract", () => {
  it("exposes every accepted event in the shared OpenAPI subscription enums and UI catalog", () => {
    const backend = [...accepted.matchAll(/"([a-z_]+\.[a-z_]+)": true/g)].map(match => match[1]).sort();
    const catalog = EVENT_CATALOG.map(event => event.name).sort();
    expect(catalog).toEqual(backend);
    const enums = [...openapi.matchAll(/subscribed_events:.*?enum: \[([^\]]+)\]/g)];
    expect(enums).toHaveLength(2);
    for (const match of enums) expect(match[1].split(", ").sort()).toEqual(catalog);
    expect(EVENT_CATALOG.every(event => event.trigger.length > 20)).toBe(true);
  });

  it("teaches failure, expiry and return categories distinctly", () => {
    for (const event of ["shipment.delivery_failed", "shipment.returning", "shipment.returned"]) {
      expect(eventMapping(event, "SHOPEE_LIKE")).toBe("logistics_status_update");
      expect(eventMapping(event, "TOKOPEDIA_LIKE")).toBe("PACKAGE_UPDATE · type 4");
    }
    for (const event of ["order.payment_failed", "order.payment_expired", "order.sla_expired"]) {
      expect(eventMapping(event, "SHOPEE_LIKE")).toBe("order_status_update");
      expect(eventMapping(event, "TOKOPEDIA_LIKE")).toBe("ORDER_STATUS_CHANGE · type 1");
    }
  });
});
