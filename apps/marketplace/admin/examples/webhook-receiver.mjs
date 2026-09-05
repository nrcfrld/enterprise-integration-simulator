import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

// Keep the original bytes: JSON.parse + JSON.stringify changes the signature.
export function verifyWebhook(raw, headers, { provider, secret, appKey }, now = Date.now() / 1000) {
  if (!secret) throw new Error("Configure the provider's verification secret");
  let input, signature, timestamp, event;
  if (provider === "SHOPEE_LIKE") {
    const type = headers["x-shopee-event"];
    timestamp = headers["x-shopee-timestamp"];
    if (!type || !timestamp) throw new Error("Missing Shopee delivery headers");
    input = Buffer.concat([Buffer.from(type + timestamp), raw]);
    signature = headers["x-shopee-signature"];
  } else if (provider === "TOKOPEDIA_LIKE") {
    if (!appKey) throw new Error("Configure the oldest ACTIVE credential's Client ID as APP_KEY");
    input = Buffer.concat([Buffer.from(appKey), raw]);
    signature = headers.authorization;
  } else throw new Error("Choose SHOPEE_LIKE or TOKOPEDIA_LIKE");
  const expected = createHmac("sha256", secret).update(input).digest();
  if (typeof signature !== "string" || !/^[a-fA-F0-9]{64}$/.test(signature) ||
      !timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw new Error("Invalid signature");
  event = JSON.parse(raw.toString("utf8"));
  timestamp = Number(timestamp ?? event.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 300) throw new Error("Stale timestamp");
  const eventID = provider === "SHOPEE_LIKE" ? headers["x-shopee-event-id"] : event.tts_notification_id;
  if (typeof eventID !== "string" || !eventID) throw new Error("Missing event ID");
  if (provider === "SHOPEE_LIKE" && eventID !== event.request_id) throw new Error("Event ID mismatch");
  return { eventID, event };
}

// Local learning receiver. Its in-memory inbox is cleared when the process stops.
// In your application, atomically insert a unique (shop, eventID) into a durable
// inbox, acknowledge after commit, and let a worker fetch current provider state.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const provider = process.env.PROVIDER;
  const secret = provider === "SHOPEE_LIKE" ? process.env.WEBHOOK_SECRET : process.env.APP_SECRET;
  const appKey = process.env.APP_KEY;
  if (!secret || !["SHOPEE_LIKE", "TOKOPEDIA_LIKE"].includes(provider) ||
      (provider === "TOKOPEDIA_LIKE" && !appKey)) throw new Error("Set PROVIDER and its verification credentials first");
  const inbox = new Map();
  createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/webhooks") { res.writeHead(404).end(); return; }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const { eventID, event } = verifyWebhook(Buffer.concat(chunks), req.headers, { provider, secret, appKey });
      if (!inbox.has(eventID)) {
        inbox.set(eventID, event);
        console.log("New event; fetch current provider state before acting:", eventID, event);
      }
      res.writeHead(204).end(); // Duplicate verified deliveries also succeed.
    } catch (error) {
      console.error(error.message);
      res.writeHead(400).end("Webhook verification failed");
    }
  }).listen(Number(process.env.PORT || 9000), "0.0.0.0", () => console.log("Listening on :9000/webhooks"));
}
