import { useRef, type RefObject } from "react";
import type { Shop } from "@/shared/types/controlPlane";
import { AccessibleDialog } from "./AccessibleDialog";
import { CredentialValue } from "./CredentialCreatedDialog";

export function WebhookSecretDialog({ webhook, shop, shopID, onAcknowledge, returnFocusRef }: {
  webhook: { id: string; url: string; secret: string };
  shop?: Shop;
  shopID: string;
  onAcknowledge: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  return <AccessibleDialog ariaLabelledby="webhook-secret-title" initialFocusRef={heading}
    closeOnEscape={false} returnFocusRef={returnFocusRef}
    backdropClassName="modal modal-open credential-dialog-backdrop" className="modal-box credential-dialog">
    <h2 id="webhook-secret-title" ref={heading} tabIndex={-1}>Save your Shopee webhook secret</h2>
    <p>This value is shown only once. Copy it before continuing; it cannot be recovered from the registration.</p>
    <p>Shop: <b>{shop?.name || shopID}</b> · <code>{shopID}</code></p>
    <p>Endpoint: <code>{webhook.url}</code> · <code>{webhook.id}</code></p>
    <CredentialValue label="Webhook secret" value={webhook.secret} />
    <p>Set <code>PROVIDER=SHOPEE_LIKE</code> and save this value as <code>WEBHOOK_SECRET</code> in your receiver environment. Verify HMAC-SHA256 over the event type + timestamp + exact raw request body. This is separate from your API client secret.</p>
    <p>If you lose it, edit this endpoint, set a new secret, and update the receiver together. Pending deliveries will use the replacement secret on their next attempt; in-flight attempts may still use the old one.</p>
    <p>The dialog keeps the secret in memory only. Save your copy outside the browser before reloading.</p>
    <button type="button" className="btn btn-primary" onClick={onAcknowledge}>I saved the webhook secret</button>
  </AccessibleDialog>;
}
