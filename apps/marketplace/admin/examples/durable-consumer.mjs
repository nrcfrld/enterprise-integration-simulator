// Node 22.13+ (built-in node:sqlite). One receiver + serial worker per database.
import { DatabaseSync } from "node:sqlite";
import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { verifyWebhook } from "./webhook-receiver.mjs";

export function createConsumer(config, fetchImpl = fetch) {
  const { provider, shopID, clientID, clientSecret, accessToken, secret, appKey } = config;
  if (!["SHOPEE_LIKE", "TOKOPEDIA_LIKE"].includes(provider) || !shopID || !clientID || !clientSecret || !secret ||
      (provider === "TOKOPEDIA_LIKE" && (!accessToken || !appKey))) throw new Error("Set shop, provider and matching API/verification credentials");
  const db = new DatabaseSync(config.databasePath ?? "consumer.sqlite");
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS identity (shop TEXT PRIMARY KEY, provider TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inbox (shop TEXT, event_id TEXT, raw TEXT NOT NULL, received_at INTEGER NOT NULL,
      processed_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, error TEXT,
      PRIMARY KEY (shop,event_id));
    CREATE TABLE IF NOT EXISTS documents (shop TEXT, kind TEXT, id TEXT, body TEXT NOT NULL, fetched_at INTEGER NOT NULL,
      PRIMARY KEY (shop,kind,id));
    CREATE TABLE IF NOT EXISTS operations (shop TEXT, name TEXT, method TEXT NOT NULL, path TEXT NOT NULL, body TEXT NOT NULL,
      retry_key TEXT NOT NULL, response TEXT, PRIMARY KEY (shop,name));`);
  const identity = db.prepare("SELECT * FROM identity").get();
  if (identity && (identity.shop !== shopID || identity.provider !== provider)) { db.close(); throw new Error("Use a separate database for each shop/provider"); }
  db.prepare("INSERT OR IGNORE INTO identity VALUES (?,?)").run(shopID, provider);
  const prefix = provider === "SHOPEE_LIKE" ? "/api/shopee/v1" : "/api/tokopedia/v202309";
  const now = () => Date.now();
  const transaction = action => {
    db.exec("BEGIN IMMEDIATE");
    try { const value = action(); db.exec("COMMIT"); return value; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  const saveDocument = (kind, id, body) => db.prepare(`INSERT INTO documents VALUES (?,?,?,?,?)
    ON CONFLICT(shop,kind,id) DO UPDATE SET body=excluded.body,fetched_at=excluded.fetched_at`)
    .run(shopID, kind, id, JSON.stringify(body), now());

  async function request(method, path, raw = "", retryKey, attempt = 0) {
    const url = new URL(path, config.baseURL ?? "http://localhost:18080");
    const timestamp = String(Math.floor(now() / 1000));
    const headers = {};
    if (raw) headers["Content-Type"] = "application/json";
    if (retryKey) headers["Idempotency-Key"] = retryKey;
    const hmac = input => createHmac("sha256", clientSecret).update(input).digest("hex");
    if (provider === "SHOPEE_LIKE") {
      Object.assign(headers, { "X-Shopee-Partner-Id": clientID, "X-Shopee-Timestamp": timestamp,
        "X-Shopee-Signature": hmac(clientID + url.pathname + timestamp + raw) });
    } else {
      url.searchParams.set("app_key", clientID); url.searchParams.set("timestamp", timestamp);
      const sorted = [...url.searchParams].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      const input = url.pathname + sorted.map(([key, value]) => key + value).join("") + raw;
      url.searchParams.set("sign", hmac(clientSecret + input + clientSecret));
      headers["x-tts-access-token"] = accessToken;
    }
    const response = await fetchImpl(url, { method, headers, body: raw || undefined, signal: AbortSignal.timeout(15000) });
    const text = await response.text();
    let envelope;
    try { envelope = JSON.parse(text); } catch { throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`); }
    if (!response.ok || envelope.error || (provider === "TOKOPEDIA_LIKE" && envelope.code !== 0)) {
      const error = new Error(`HTTP ${response.status}: ${text.slice(0, 500)}; Retry-After=${response.headers.get("retry-after") ?? "not supplied"}`);
      error.status = response.status;
      const retryAfter = response.headers.get("retry-after");
      const quotaReset = response.headers.get(provider === "SHOPEE_LIKE" ? "x-shopee-ratelimit-reset" : "x-tts-ratelimit-reset");
      error.retryMs = retryAfter ? (Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - now()))
        : quotaReset ? Math.max(0, Number(quotaReset) * 1000 - now()) : 0;
      if (response.status === 429 && attempt < 3) {
        await delay(Math.max(1000, error.retryMs || 60000));
        return request(method, path, raw, retryKey, attempt + 1);
      }
      throw error;
    }
    return { data: provider === "SHOPEE_LIKE" ? envelope.response : envelope.data, status: response.status,
      headers: Object.fromEntries(response.headers), request_id: envelope.request_id };
  }

  function accept(raw, headers) {
    let verified;
    try {
      verified = verifyWebhook(raw, headers, { provider, secret, appKey });
      if (provider === "TOKOPEDIA_LIKE" && verified.event.shop_id !== shopID) throw new Error("Unexpected shop");
    } catch (error) { error.status = 400; throw error; }
    // Shopee has no signed shop_id: this endpoint uses one shop's unique webhook secret.
    // Synchronous SQLite commit completes BEFORE the HTTP handler acknowledges.
    const result = db.prepare("INSERT OR IGNORE INTO inbox(shop,event_id,raw,received_at) VALUES(?,?,?,?)")
      .run(shopID, verified.eventID, raw.toString("utf8"), now());
    return { eventID: verified.eventID, inserted: Number(result.changes) === 1 };
  }

  function resource(event) {
    const payload = provider === "SHOPEE_LIKE" ? event.response?.data : event.data;
    const product = provider === "SHOPEE_LIKE" ? event.response?.event_type === "item_update" : event.type === 15;
    // Shipment events use id=shipment ID and order_id=parent order ID.
    const id = product ? payload?.product_id ?? payload?.id : payload?.order_id ?? payload?.id;
    if (typeof id !== "string" || !id) throw new Error("Event lacks a resource ID; inspect the inbox raw body");
    return { kind: product ? "products" : "orders", id };
  }
  async function fetchDocument(kind, id) {
    try { return (await request("GET", `${prefix}/${kind}/${encodeURIComponent(id)}`)).data; }
    catch (error) {
      if (kind === "products" && error.status === 404) return { id, deleted: true };
      throw error;
    }
  }
  let busy = false;
  async function work() {
    if (busy) throw new Error("Wait for the serial worker/reconciliation pass to finish");
    busy = true;
    try {
      const rows = db.prepare("SELECT * FROM inbox WHERE shop=? AND processed_at IS NULL AND next_at<=? ORDER BY received_at,event_id LIMIT 100").all(shopID, now());
      for (const row of rows) {
        try {
          const { kind, id } = resource(JSON.parse(row.raw));
          // A delayed event is only a signal. Never overwrite state using its old payload status.
          const current = await fetchDocument(kind, id);
          transaction(() => {
            saveDocument(kind, id, current);
            db.prepare("UPDATE inbox SET processed_at=?,attempts=attempts+1,error=NULL WHERE shop=? AND event_id=?").run(now(), shopID, row.event_id);
          });
        } catch (error) {
          const delay = Math.max(error.retryMs || 0, Math.min(60000, 1000 * 2 ** Math.min(row.attempts, 6)));
          db.prepare("UPDATE inbox SET attempts=attempts+1,error=?,next_at=? WHERE shop=? AND event_id=?").run(error.message, now() + delay, shopID, row.event_id);
          // Avoid exhausting the quota for every queued event during an outage.
          if (!error.status || error.status === 429 || error.status >= 500) break;
        }
      }
    } finally { busy = false; }
  }

  async function reconcile() {
    if (busy) throw new Error("Wait for the serial worker/reconciliation pass to finish");
    busy = true;
    let count = 0, page = 1, token = "";
    const seenTokens = new Set();
    try {
      while (true) {
        const result = provider === "SHOPEE_LIKE"
          ? await request("GET", `${prefix}/orders?page_no=${page}&page_size=20`)
          : await request("POST", `${prefix}/orders/search`, JSON.stringify({ page_size: 20, ...(token ? { page_token: token } : {}) }));
        const rows = provider === "SHOPEE_LIKE" ? result.data.order_list : result.data.orders;
        if (!Array.isArray(rows)) throw new Error("Expected an order list");
        for (const row of rows) {
          if (typeof row.order_id !== "string" || !row.order_id) throw new Error("Expected order_id, not display order number");
          saveDocument("orders", row.order_id, await fetchDocument("orders", row.order_id)); count++;
        }
        const more = provider === "SHOPEE_LIKE" ? result.data.more : result.data.has_more;
        if (!more) break;
        if (!rows.length) throw new Error("Empty page advertised more records; retry reconciliation later");
        if (provider === "SHOPEE_LIKE") page++;
        else {
          token = result.data.next_page_token;
          if (!token || seenTokens.has(token)) throw new Error("Missing/repeated page token; restart reconciliation");
          seenTokens.add(token);
        }
      }
      return count;
    } finally { busy = false; }
  }

  async function action(orderID, actionName, operationName, body = "") {
    const allowed = provider === "SHOPEE_LIKE" ? ["process", "ready-to-ship", "shipments", "cancel"] : ["pack", "handover", "shipments", "cancel"];
    if (!orderID || !operationName || !allowed.includes(actionName)) throw new Error(`Use action ORDER_ID ${allowed.join("|")} OPERATION_NAME [JSON_BODY]`);
    const routeAction = provider === "SHOPEE_LIKE" && actionName === "process" ? "ship-order" : actionName;
    const path = `${prefix}/orders/${encodeURIComponent(orderID)}/${routeAction}`;
    // Persist intent and retry key before the network call; survive a lost response/restart.
    const operation = transaction(() => {
      db.prepare("INSERT OR IGNORE INTO operations(shop,name,method,path,body,retry_key) VALUES(?,?,?,?,?,?)")
        .run(shopID, operationName, "POST", path, body, randomUUID());
      const saved = db.prepare("SELECT * FROM operations WHERE shop=? AND name=?").get(shopID, operationName);
      if (saved.path !== path || saved.body !== body) throw new Error("Operation name already belongs to different inputs. Reuse identical inputs for retries or choose a new name.");
      return saved;
    });
    const result = await request(operation.method, operation.path, operation.body, operation.retry_key);
    db.prepare("UPDATE operations SET response=? WHERE shop=? AND name=?").run(JSON.stringify(result), shopID, operationName);
    return { retry_key: operation.retry_key, ...result };
  }
  function status() {
    return {
      inbox: db.prepare("SELECT event_id,received_at,processed_at,attempts,next_at,error FROM inbox WHERE shop=? ORDER BY received_at").all(shopID),
      documents: db.prepare("SELECT kind,id,body,fetched_at FROM documents WHERE shop=?").all(shopID).map(row => ({ ...row, body: JSON.parse(row.body) })),
      operations: db.prepare("SELECT name,retry_key,response FROM operations WHERE shop=?").all(shopID),
    };
  }
  return { accept, work, reconcile, action, status, close: () => db.close() };
}

export function receiverHandler(consumer) {
  return async (req, res) => {
    if (req.method !== "POST" || req.url !== "/webhooks") { res.writeHead(404).end(); return; }
    const chunks = []; let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      consumer.accept(Buffer.concat(chunks), req.headers);
      res.writeHead(204).end();
    } catch (error) {
      console.error(error.message);
      // Storage failure must NOT be acknowledged; the marketplace must retry.
      res.writeHead(error.status === 400 ? 400 : 503).end("Event not accepted; inspect receiver logs");
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const provider = process.env.PROVIDER;
  const consumer = createConsumer({ provider, shopID: process.env.SHOP_ID, databasePath: process.env.CONSUMER_DB,
    baseURL: process.env.MARKETPLACE_BASE_URL, clientID: process.env.MARKETPLACE_CLIENT_ID,
    clientSecret: process.env.MARKETPLACE_CLIENT_SECRET, accessToken: process.env.MARKETPLACE_ACCESS_TOKEN,
    secret: provider === "SHOPEE_LIKE" ? process.env.WEBHOOK_SECRET : process.env.APP_SECRET, appKey: process.env.APP_KEY });
  const command = process.argv[2] ?? "serve";
  if (command === "serve") {
    const server = createServer(receiverHandler(consumer));
    server.listen(Number(process.env.PORT || 9000), "0.0.0.0", () => console.log("Durable receiver listening on :9000/webhooks"));
    let running = false;
    const timer = setInterval(async () => {
      if (running || process.env.PAUSE_WORKER === "1") return;
      running = true;
      try { await consumer.work(); } catch (error) { console.error(error.message); } finally { running = false; }
    }, 1000);
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { clearInterval(timer); server.close(() => process.exit(0)); });
  } else {
    try {
      if (command === "work") await consumer.work();
      else if (command === "reconcile") console.log("Reconciled orders:", await consumer.reconcile());
      else if (command === "action") console.log(await consumer.action(...process.argv.slice(3)));
      else if (command !== "status") throw new Error("Choose serve, work, reconcile, action, or status");
      if (command !== "action") console.log(JSON.stringify(consumer.status(), null, 2));
    } finally { consumer.close(); }
  }
}
