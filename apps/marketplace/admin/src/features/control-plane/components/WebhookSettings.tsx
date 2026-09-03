import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import type {
  ControlPlaneData,
  FormRequest,
  WebhookRegistration,
} from "@/shared/types/controlPlane";

const request = <T,>(...args: Parameters<typeof controlPlaneRequest>) =>
  controlPlaneRequest<T>(...args);

interface WebhookSettingsProps {
  data: ControlPlaneData | null;
  shopID: string;
  token: string | null | undefined;
  onForm: (form: FormRequest) => void;
  onRefresh: () => Promise<void>;
  onNotice: (text: string) => void;
}

export function WebhookSettings({ data, shopID, token, onForm, onRefresh, onNotice }: WebhookSettingsProps) {
  const hooks = (data?.data ?? []) as WebhookRegistration[];
  const remove = async (id: string) => {
    if (
      !window.confirm(
        "Delete this webhook registration? Existing delivery history remains.",
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
      <section className="webhook-explainer">
        <p className="eyebrow">Registration settings</p>
        <h2>Tell the simulator where to send matching events.</h2>
        <p>
          Creating a webhook does not create an event. An order transition
          creates an event; this registration decides whether it is delivered to
          your endpoint.
        </p>
        <button onClick={() => onForm({ kind: "webhook" })}>
          + Register webhook <span>→</span>
        </button>
      </section>
      <div className="webhook-list">
        {hooks.length ? (
          hooks.map((hook) => (
            <article key={hook.id} className={!hook.enabled ? "disabled" : ""}>
              <div className="webhook-head">
                <div>
                  <span className={`state ${hook.enabled ? "on" : "off"}`}>
                    {hook.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <h3>{hook.url}</h3>
                  <small>{hook.id}</small>
                </div>
                <div className="row-actions">
                  <button
                    className="quiet"
                    onClick={() => onForm({ kind: "webhook", initial: hook })}
                  >
                    Edit
                  </button>
                  <button className="quiet" onClick={() => toggle(hook)}>
                    {hook.enabled ? "Disable" : "Enable"}
                  </button>
                  <button className="danger" onClick={() => remove(hook.id)}>
                    Delete
                  </button>
                </div>
              </div>
              <p className="subscription-label">
                Subscribed order/product events
              </p>
              <div className="event-chips">
                {hook.subscribed_events?.map((event: string) => (
                  <span key={event}>{event}</span>
                ))}
              </div>
            </article>
          ))
        ) : (
          <p className="empty">
            No webhook is registered yet. Use the runbook to add a destination
            before triggering an order.
          </p>
        )}
      </div>
    </>
  );
}
