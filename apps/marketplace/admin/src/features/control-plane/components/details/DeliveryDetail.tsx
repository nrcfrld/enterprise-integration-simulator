import type { DetailData } from "./types";

export function DeliveryDetail({ data }: { data: DetailData }) {
  return (
    <>
      <p>
        Status: <b>{data.status}</b> · {data.attempt_count ?? 0} attempts
      </p>
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
