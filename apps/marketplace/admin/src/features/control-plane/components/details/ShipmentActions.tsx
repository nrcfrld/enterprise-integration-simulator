import { useState } from "react";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";

const actionsByStatus: Record<string, ReadonlyArray<readonly [string, string]>> = {
  CREATED: [["ship", "Mark as shipped"]],
  SHIPPED: [["in_delivery", "Start delivery"]],
  IN_DELIVERY: [
    ["deliver", "Mark as delivered"],
    ["delivery_failed", "Report delivery failure"],
  ],
  DELIVERY_FAILED: [["return_to_sender", "Start return to seller"]],
  RETURNING: [["complete_return", "Mark as returned"]],
};

interface ShipmentActionsProps {
  shipmentID?: string;
  status?: string;
  token: string | null | undefined;
  onReload: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
  showFinalState?: boolean;
}

export function ShipmentActions({
  shipmentID,
  status,
  token,
  onReload,
  onRefresh,
  onNotice,
  onError,
  showFinalState = false,
}: ShipmentActionsProps) {
  const [pending, setPending] = useState(false);
  const actions = status ? actionsByStatus[status] : undefined;

  if (!shipmentID) return null;
  if (!actions) {
    return showFinalState ? (
      <p className="page-hint">This shipment has reached its final delivery state.</p>
    ) : null;
  }

  const transition = async (action: string) => {
    if (pending) return;
    onError("");
    let reason = "";
    if (action === "delivery_failed") {
      const entered = window.prompt("Why did this delivery fail?");
      if (entered === null) return;
      reason = entered.trim();
      if (!reason) {
        onError("A delivery failure reason is required.");
        return;
      }
    }

    setPending(true);
    try {
      await controlPlaneRequest<unknown>(
        `/control/v1/shipments/${shipmentID}/actions/${action}`,
        token,
        {
          method: "POST",
          body: JSON.stringify(reason ? { reason } : {}),
        },
      );
      await onReload();
      await onRefresh();
      onNotice(`Shipment ${action} complete`);
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : "Request failed");
    } finally { setPending(false); }
  };

  return (
    <section aria-label="Carrier simulation"><p>Carrier simulation: update this shipment’s physical movement. These are console actions, not merchant API calls.</p><div className="action-grid">
      {actions.map(([action, label]) => (
        <button key={action} disabled={pending} onClick={() => void transition(action)}>
          {label}
        </button>
      ))}
    </div></section>
  );
}
