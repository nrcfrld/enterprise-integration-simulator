import type { DetailData } from "./types";

export function DeliveryDetail({ data }: { data: DetailData }) {
  return (
    <>
      <p>
        Status: <b>{data.status}</b> · {data.attempt_count ?? 0} attempts
      </p>
      {data.webhook_deleted === true && <p>Webhook deleted. History is retained and pending deliveries are cancelled. To deliver again, register a new callback and replay the event from Order Detail.</p>}
      {data.attempts?.length ? (
        data.attempts.map((attempt) => (
          <div className="timeline" key={attempt.id}>
            <span>
              Attempt {attempt.attempt}: {attempt.status}
            </span>
            <small>
              {attempt.response_status || "network failure"} · {attempt.duration_ms}ms
            </small>
            <pre>{attempt.response_body || "No response body"}</pre>
          </div>
        ))
      ) : (
        <p className="empty compact">No delivery attempts recorded.</p>
      )}
    </>
  );
}
