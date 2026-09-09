import { Pagination } from "./ResourcePage";
import { useState } from "react";
import { WebhookVerification } from "@/features/developer-portal/components/WebhookVerification";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import type {
  Shop,
  ControlPlaneData,
  FormRequest,
  WebhookRegistration,
} from "@/shared/types/controlPlane";

const request = <T,>(...args: Parameters<typeof controlPlaneRequest>) =>
  controlPlaneRequest<T>(...args);

interface WebhookSettingsProps {
  listPage?: number;
  onPageChange?: (page: number) => void;
  shop?: Shop;
  data: ControlPlaneData | null;
  shopID: string;
  token: string | null | undefined;
  onForm: (form: FormRequest) => void;
  onRefresh: () => Promise<void>;
  onNotice: (text: string) => void;
}

export function WebhookSettings({ listPage = 1, onPageChange, shop, data, shopID, token, onForm, onRefresh, onNotice }: WebhookSettingsProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const mutate = async (action: () => Promise<void>) => {
    setPending(true); setError("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : "Could not update webhook. Try again."); }
    finally { setPending(false); }
  };
  const hooks = (Array.isArray(data?.data) ? data.data : []) as WebhookRegistration[];
  const provider = data?.delivery_contract?.provider_profile ?? shop?.provider_profile;
  const enabledHooks = hooks.filter((hook) => hook.enabled).length;
  const providerName = provider === "TOKOPEDIA_LIKE" ? "Tokopedia-like" : "Shopee-like";
  const remove = async (id: string) => {
    if (
      !window.confirm(
        "Delete this webhook registration? Delivery history remains in Deliveries. Pending deliveries will be cancelled. An attempt already in flight may still finish.",
      )
    )
      return;
    await request<unknown>(`/control/v1/shops/${shopID}/webhooks/${id}`, token, {
      method: "DELETE",
    });
    await onRefresh();
    onNotice("Webhook registration deleted");
  };
  const toggle = async (hook: WebhookRegistration) => {
    await request<unknown>(`/control/v1/shops/${shopID}/webhooks/${hook.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({
        url: hook.url,
        subscribed_events: hook.subscribed_events,
        enabled: !hook.enabled,
      }),
    });
    await onRefresh();
    onNotice(`Webhook ${hook.enabled ? "disabled" : "enabled"}`);
  };
  if (!shopID)
    return (
      <p className="empty">
        Choose a shop first. A webhook belongs to one shop and only receives
        that shop’s events.
      </p>
    );
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <section className="webhook-overview" aria-labelledby="webhook-overview-title">
        <div>
          <h2 id="webhook-overview-title">Route events to your endpoint</h2>
          <p>Register a callback, choose its events, then enable delivery.</p>
        </div>
        <div className="webhook-overview-actions">
          <span>{enabledHooks} of {hooks.length} endpoints on this page enabled</span>
          <button className="btn btn-primary" onClick={() => onForm({ kind: "webhook" })}>
            Register endpoint
          </button>
        </div>
      </section>
      {provider && <details className="webhook-help-disclosure">
        <summary>
          <span>
            <strong>{providerName} verification guide</strong>
            <small>Signature inputs, credentials, payload, and retries</small>
          </span>
          <span className="disclosure-action">View guide</span>
        </summary>
        <div className="webhook-help-content">
          <WebhookVerification provider={provider} signingClientID={data?.delivery_contract?.signing_client_id} />
        </div>
      </details>}
      <div className="webhook-list-heading">
        <h2>Your endpoints</h2>
        <span>{data?.pagination?.total ?? hooks.length} registered</span>
      </div>
      {onPageChange && <Pagination pagination={data?.pagination} page={listPage} onChange={onPageChange} />}
      <div className="webhook-list">
        {hooks.length ? (
          hooks.map((hook) => (
            <article key={hook.id} className={`card bg-base-100 ${!hook.enabled ? "disabled" : ""}`}>
              <div className="webhook-head">
                <div>
                  <span className={`state badge ${hook.enabled ? "on badge-success" : "off badge-ghost"}`}>
                    {hook.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <h3>{hook.url}</h3>
                  <small>{hook.id}</small>
                </div>
                <div className="row-actions">
                  <button
                    className="quiet btn btn-ghost btn-sm"
                    disabled={pending} onClick={() => onForm({ kind: "webhook", initial: hook })}
                  >
                    Edit
                  </button>
                  <button className="quiet btn btn-ghost btn-sm" disabled={pending} onClick={() => void mutate(() => toggle(hook))}>
                    {hook.enabled ? "Disable" : "Enable"}
                  </button>
                  <button className="danger btn btn-error btn-soft btn-sm" disabled={pending} onClick={() => void mutate(() => remove(hook.id))}>
                    Delete
                  </button>
                </div>
              </div>
              <p className="subscription-label">
                Subscribed events
              </p>
              <div className="event-chips">
                {(Array.isArray(hook.subscribed_events) ? hook.subscribed_events : []).map((event: string) => (
                  <span key={event}>{event}</span>
                ))}
              </div>
            </article>
          ))
        ) : (
          <p className="empty">
            No endpoints on this page. Register one before triggering an event, or return to the previous page.
          </p>
        )}
      </div>
    </>
  );
}
