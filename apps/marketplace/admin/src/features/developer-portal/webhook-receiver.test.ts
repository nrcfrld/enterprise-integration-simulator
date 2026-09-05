// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
// @ts-expect-error The runnable JavaScript example deliberately requires no build step.
import { verifyWebhook } from "../../../examples/webhook-receiver.mjs";

const now = 1788566400;
const sign = (input: string, secret: string) => createHmac("sha256", secret).update(input).digest("hex");

describe("runnable webhook receiver", () => {
  for (const provider of ["SHOPEE_LIKE", "TOKOPEDIA_LIKE"]) {
    it(`verifies ${provider} raw bytes, identity, freshness and key ownership`, () => {
      const shopee = provider === "SHOPEE_LIKE";
      const raw = Buffer.from(JSON.stringify(shopee
        ? { code: 0, message: "success", request_id: "evt_1", response: { event_type: "order_status_update", data: { order_id: "ord_1", status: "PAID" } } }
        : { type: 1, tts_notification_id: "evt_1", shop_id: "shop_1", timestamp: now, data: { order_id: "ord_1", status: "PAID" } }));
      const config = { provider, secret: shopee ? "webhook-secret" : "app-secret", appKey: "client_oldest" };
      const headers: Record<string, string> = shopee ? {
        "x-shopee-event": "order_status_update", "x-shopee-event-id": "evt_1", "x-shopee-timestamp": String(now),
        "x-shopee-signature": sign(`order_status_update${now}${raw}`, config.secret),
      } : { authorization: sign(`client_oldest${raw}`, config.secret) };
      expect(verifyWebhook(raw, headers, config, now).eventID).toBe("evt_1");
      expect(() => verifyWebhook(Buffer.concat([raw, Buffer.from(" ")]), headers, config, now)).toThrow("Invalid signature");
      expect(() => verifyWebhook(raw, headers, { ...config, secret: "wrong-key" }, now)).toThrow("Invalid signature");
      expect(() => verifyWebhook(raw, headers, config, now + 301)).toThrow("Stale timestamp");
      expect(() => verifyWebhook(raw, {}, config, now)).toThrow();
      const signatureHeader = shopee ? "x-shopee-signature" : "authorization";
      expect(() => verifyWebhook(raw, { ...headers, [signatureHeader]: "malformed" }, config, now)).toThrow("Invalid signature");
      if (!shopee) expect(() => verifyWebhook(raw, headers, { ...config, appKey: "newer-client" }, now)).toThrow("Invalid signature");
    });
  }
});
