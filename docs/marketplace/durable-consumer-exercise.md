# Durable external consumer exercise

The complete [runnable lesson](../../apps/marketplace/admin/examples/durable-consumer-README.md) is available in **Developer Portal → Durable consumer exercise**, with downloads for both JavaScript files.

It covers both providers from fresh UNPAID order creation through payment, merchant fulfillment, verified SQLite inbox acceptance, current-state persistence, pagination, durable mutation keys, duplicate/restart/out-of-order recovery, and return-to-sender evidence.

Use Node 22.13+ and one processing worker per shop database. The [consumer](../../apps/marketplace/admin/examples/durable-consumer.mjs) reuses the [raw-body verifier](../../apps/marketplace/admin/examples/webhook-receiver.mjs). The original standalone receiver remains an in-memory starter; the durable exercise persists acceptance before 204 and records processing separately.
