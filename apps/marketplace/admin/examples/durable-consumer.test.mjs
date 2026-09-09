import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createConsumer, receiverHandler } from "./durable-consumer.mjs";

const resources = [];
afterEach(() => { for (const resource of resources.splice(0).reverse()) resource(); });
function fixture(provider, fetchImpl) {
  const directory = mkdtempSync(join(tmpdir(), "marketplace-consumer-"));
  resources.push(() => rmSync(directory, { recursive: true, force: true }));
  const config = { provider, shopID: "shop_1", clientID: "client_1", clientSecret: "api-secret", accessToken: "access-token", secret: "verify-secret", appKey: "oldest-client", databasePath: join(directory, "inbox.sqlite") };
  const open = () => {
    const consumer = createConsumer(config, fetchImpl);
    let closed = false;
    const close = () => { if (!closed) { closed = true; consumer.close(); } };
    resources.push(close);
    return { consumer, close };
  };
  return { config, open };
}
function delivery(provider, id, payload = { id: "ord_1", status: "UNPAID" }) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const event = provider === "SHOPEE_LIKE"
    ? { request_id: id, response: { event_type: "order_status_update", data: payload } }
    : { tts_notification_id: id, timestamp: Number(timestamp), shop_id: "shop_1", type: 1, data: payload };
  const raw = Buffer.from(JSON.stringify(event));
  const input = provider === "SHOPEE_LIKE" ? `order_status_update${timestamp}${raw}` : `oldest-client${raw}`;
  const signature = createHmac("sha256", "verify-secret").update(input).digest("hex");
  return [raw, provider === "SHOPEE_LIKE" ? { "x-shopee-event": "order_status_update", "x-shopee-event-id": id, "x-shopee-timestamp": timestamp, "x-shopee-signature": signature } : { authorization: signature }];
}
function response(provider, data, headers = {}) {
  return new Response(JSON.stringify(provider === "SHOPEE_LIKE" ? { error: "", response: data } : { code: 0, data }), { headers });
}
for (const provider of ["SHOPEE_LIKE", "TOKOPEDIA_LIKE"]) {
  test(`${provider}: committed inbox survives restart, dedupes and resolves current parent-order state`, async () => {
    const calls = [];
    const fixtureState = fixture(provider, async (url, options) => {
      calls.push([url, options]);
      return response(provider, { order_id: "ord_1", order_status: provider === "SHOPEE_LIKE" ? "RETURNED" : "CANCEL", shipment_list: [{ status: "RETURNED" }] });
    });
    const first = fixtureState.open();
    const rawEvent = delivery(provider, "evt_1");
    assert.equal(first.consumer.accept(...rawEvent).inserted, true);
    assert.equal(first.consumer.status().inbox[0].processed_at, null);
    first.close();
    const { consumer } = fixtureState.open();
    assert.equal(consumer.accept(...rawEvent).inserted, false);
    await consumer.work();
    assert.equal(consumer.status().inbox.length, 1);
    assert.ok(consumer.status().inbox[0].processed_at);
    assert.equal(consumer.status().documents[0].body.shipment_list[0].status, "RETURNED");
    await consumer.work();
    assert.equal(calls.length, 1);
    // A later delivered, previously unseen old shipment event refreshes its parent,
    // never uses the shipment id as an order id or copies the stale payload status.
    consumer.accept(...delivery(provider, "evt_older", { id: "shp_1", order_id: "ord_1", status: "SHIPPED" }));
    await consumer.work();
    assert.ok(String(calls[1][0]).includes("/orders/ord_1"));
    assert.equal(consumer.status().documents[0].body.shipment_list[0].status, "RETURNED");
    assert.equal(calls[0][1].headers[provider === "SHOPEE_LIKE" ? "X-Shopee-Partner-Id" : "x-tts-access-token"], provider === "SHOPEE_LIKE" ? "client_1" : "access-token");
  });

  test(`${provider}: an API outage preserves pending work with an explicit retry`, async () => {
    const { consumer } = fixture(provider, async () => { throw new Error("offline"); }).open();
    consumer.accept(...delivery(provider, "evt_offline"));
    await consumer.work();
    const row = consumer.status().inbox[0];
    assert.equal(row.processed_at, null);
    assert.equal(row.attempts, 1);
    assert.match(row.error, /offline/);
    assert.ok(row.next_at > Date.now());
    assert.equal(consumer.status().documents.length, 0);
  });

  test(`${provider}: traverses all pages and stores full documents`, async () => {
    const listRequests = [];
    const { consumer } = fixture(provider, async (url, options) => {
      if (url.pathname.endsWith("/search") || url.pathname.endsWith("/orders")) {
        listRequests.push([url, options]);
        const second = provider === "SHOPEE_LIKE" ? url.searchParams.get("page_no") === "2" : JSON.parse(options.body).page_token === "opaque+/token=";
        const rows = [{ order_id: second ? "ord_21" : "ord_1" }];
        return response(provider, provider === "SHOPEE_LIKE" ? { order_list: rows, more: !second } : { orders: rows, has_more: !second, next_page_token: second ? "" : "opaque+/token=" });
      }
      return response(provider, { order_id: url.pathname.split("/").at(-1), shipment_list: [] });
    }).open();
    assert.equal(await consumer.reconcile(), 2);
    assert.equal(listRequests.length, 2);
    assert.deepEqual(consumer.status().documents.map(row => row.id).sort(), ["ord_1", "ord_21"]);
    if (provider === "TOKOPEDIA_LIKE") assert.deepEqual(JSON.parse(listRequests[0][1].body), { page_size: 20 });
  });

  test(`${provider}: a lost mutation response reuses durable request/key across restart`, async () => {
    const calls = [];
    const fixtureState = fixture(provider, async (url, options) => {
      calls.push([url, options]);
      if (calls.length === 1) throw new Error("response lost");
      return response(provider, { order_id: "ord_1" }, { "Idempotent-Replayed": "true" });
    });
    const first = fixtureState.open();
    const action = provider === "SHOPEE_LIKE" ? "process" : "pack";
    await assert.rejects(first.consumer.action("ord_1", action, "accept-once"), /response lost/);
    first.close();
    const { consumer } = fixtureState.open();
    const replay = await consumer.action("ord_1", action, "accept-once");
    assert.equal(replay.headers["idempotent-replayed"], "true");
    assert.equal(calls[0][0].pathname, provider === "SHOPEE_LIKE" ? "/api/shopee/v1/orders/ord_1/ship-order" : "/api/tokopedia/v202309/orders/ord_1/pack");
    assert.equal(calls[0][1].headers["Idempotency-Key"], calls[1][1].headers["Idempotency-Key"]);
    await assert.rejects(consumer.action("ord_2", action, "accept-once"), /different inputs/);
    assert.equal(calls.length, 2);
  });
}

test("invalid signatures never enter the durable inbox", () => {
  const { consumer } = fixture("SHOPEE_LIKE", async () => {}).open();
  const [raw, headers] = delivery("SHOPEE_LIKE", "evt_bad");
  assert.throws(() => consumer.accept(Buffer.concat([raw, Buffer.from(" ")]), headers), /Invalid signature/);
  assert.equal(consumer.status().inbox.length, 0);
});

test("HTTP acknowledgement follows successful storage; storage failure cannot return 2xx", async () => {
  const events = [];
  const consumer = { accept: () => { events.push("committed"); } };
  const res = { writeHead: status => { events.push(status); return res; }, end: () => {} };
  const req = () => Object.assign(Readable.from([Buffer.from("body")]), { method: "POST", url: "/webhooks", headers: {} });
  await receiverHandler(consumer)(req(), res);
  assert.deepEqual(events, ["committed", 204]);
  events.length = 0;
  await receiverHandler({ accept: () => { throw new Error("disk full"); } })(req(), res);
  assert.deepEqual(events, [503]);
});
