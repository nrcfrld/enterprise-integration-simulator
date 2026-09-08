import { useState } from "react";
import type { DetailData } from "./types";

export function OrderActions({ data, pending, onAction }: {
  data: DetailData;
  pending: boolean;
  onAction: (action: string, body?: Record<string, string>) => Promise<void>;
}) {
  const [actor, setActor] = useState("");
  const [reason, setReason] = useState("");
  const available = data.operations?.available_actions ?? [];
  const cancellations = data.operations?.cancellation_options ?? [];
  const choice = cancellations.find(option => option.actor === actor) ?? cancellations[0];
  const selectedReason = choice?.reasons.includes(reason) ? reason : choice?.reasons[0] ?? "";
  const tokopedia = data.operations?.provider_profile === "TOKOPEDIA_LIKE";
  const prefix = tokopedia ? "/api/tokopedia/v202309" : "/api/shopee/v1";
  return <section aria-label="Legal order actions">
    <h3>Next actions for this order</h3>
    <p>Only actions allowed by the latest loaded state are offered. The server checks again when you submit; refresh if another request or a deadline changes the order.</p>
    {data.operations?.available_actions === undefined && <p>Action eligibility is unavailable. Refresh after updating the API to see legal actions.</p>}
    {available.some(action => ["pay", "payment_failed", "complete"].includes(action)) && <div>
      <h4>Simulate payment or customer confirmation</h4>
      <p>These console actions represent external payment/customer events, not merchant API requests. Payment must be pending and unexpired to succeed; completion requires DELIVERED.</p>
      <div className="action-grid">{[["pay", "Verify payment"], ["payment_failed", "Fail payment"], ["complete", "Complete"]].filter(([action]) => available.includes(action)).map(([action, label]) => <button key={action} disabled={pending} onClick={() => void onAction(action)}>{label}</button>)}</div>
    </div>}
    {available.some(action => ["process", "ready_to_ship"].includes(action)) && <div>
      <h4>Merchant integration work</h4>
      <p>Your integration should call the signed provider API. These buttons simulate the same transition for setup and troubleshooting.</p>
      {available.includes("process") && <p>PAID → PROCESSING: {tokopedia ? "Pack" : "Start seller processing"} via <code>POST {prefix}/orders/{data.id}/{tokopedia ? "pack" : "ship-order"}</code>. Processing does not create a physical package.</p>}
      {available.includes("ready_to_ship") && <p>PROCESSING → READY_TO_SHIP: {tokopedia ? "Handover" : "Ready to ship"} via <code>POST {prefix}/orders/{data.id}/{tokopedia ? "handover" : "ready-to-ship"}</code>. Then allocate packages and create shipments before simulating carrier movement.</p>}
      <div className="action-grid">{available.includes("process") && <button disabled={pending} onClick={() => void onAction("process")}>{tokopedia ? "Simulate pack" : "Simulate seller processing"}</button>}{available.includes("ready_to_ship") && <button disabled={pending} onClick={() => void onAction("ready_to_ship")}>{tokopedia ? "Simulate handover" : "Simulate ready to ship"}</button>}</div>
    </div>}
    {data.status === "READY_TO_SHIP" && <p>Create shipments through the provider API for this order’s packages, then use the carrier simulation below. Allocate and create all package shipments before the first shipment moves.</p>}
    {["SHIPPED", "IN_DELIVERY"].includes(data.status ?? "") && <p>Continue the carrier simulation on each shipment below. Every shipment must arrive before the order becomes DELIVERED.</p>}
    {["COMPLETED", "CANCELLED", "RETURNED"].includes(data.status ?? "") && <p>This order is terminal. Inspect its history or simulate a new order; it has no next order action.</p>}
    {choice && <fieldset disabled={pending}>
      <legend>Simulate cancellation</legend>
      <p>Cancellation releases the order’s remaining inventory reservation and records the selected actor and reason. CUSTOMER and SELLER have different eligibility. SYSTEM outcomes come from payment failure/expiry or the seller deadline worker.</p>
      <label>Cancellation actor<select value={choice.actor} onChange={event => { setActor(event.target.value); setReason(""); }}>{cancellations.map(option => <option key={option.actor}>{option.actor}</option>)}</select></label>
      <label>Cancellation reason<select value={selectedReason} onChange={event => setReason(event.target.value)}>{choice.reasons.map(value => <option key={value}>{value}</option>)}</select></label>
      <p>Submit as <b>{choice.actor}</b> with reason <b>{selectedReason}</b>.</p>
      <button disabled={!selectedReason} onClick={() => void onAction("cancel", { actor: choice.actor, reason: selectedReason })}>Cancel order as {choice.actor.toLowerCase()}</button>
    </fieldset>}
  </section>;
}
