export const EVENT_CATALOG = [
  { name: "product.created", trigger: "Create a product in Products." },
  { name: "product.updated", trigger: "Edit product catalog fields in Products." },
  { name: "product.deleted", trigger: "Archive a product with no active reservations." },
  { name: "order.created", trigger: "Simulate a fresh order with available inventory." },
  { name: "order.paid", trigger: "Verify payment in order simulation controls." },
  { name: "order.processing", trigger: "After payment, call ship-order (Shopee) or pack (Tokopedia)." },
  { name: "order.ready_to_ship", trigger: "Call ready-to-ship (Shopee) or handover (Tokopedia)." },
  { name: "order.shipped", trigger: "Mark a shipment shipped in shipment simulation controls." },
  { name: "order.in_delivery", trigger: "Advance a shipped shipment to in delivery." },
  { name: "order.delivered", trigger: "Mark a shipment delivered; order state follows all packages." },
  { name: "order.completed", trigger: "Complete a delivered order in simulation controls." },
  { name: "order.cancelled", trigger: "Cancel an eligible order with a valid actor and reason." },
  { name: "order.payment_failed", trigger: "Fail payment on an UNPAID order in simulation controls." },
  { name: "order.payment_expired", trigger: "Leave an UNPAID order until its payment deadline; the worker expires it." },
  { name: "order.sla_expired", trigger: "Let a paid order pass its seller deadline; the worker cancels it." },
  { name: "shipment.delivery_failed", trigger: "From IN_DELIVERY, report delivery failure with a reason." },
  { name: "shipment.returning", trigger: "Start return to sender after delivery failure." },
  { name: "shipment.returned", trigger: "Mark a returning shipment returned to sender." },
];

export function eventMapping(name: string, provider?: string) {
  const product = name.startsWith("product.");
  const logistics = name.startsWith("shipment.") || ["order.shipped", "order.in_delivery", "order.delivered"].includes(name);
  if (provider === "SHOPEE_LIKE") return product ? "item_update" : logistics ? "logistics_status_update" : "order_status_update";
  if (provider === "TOKOPEDIA_LIKE") return product ? "PRODUCT_INFORMATION_CHANGE · type 15" : logistics ? "PACKAGE_UPDATE · type 4" : "ORDER_STATUS_CHANGE · type 1";
  return name;
}
