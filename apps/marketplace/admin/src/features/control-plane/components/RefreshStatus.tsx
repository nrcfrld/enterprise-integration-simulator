interface RefreshStatusProps {
  refreshing: boolean;
  updatedAt?: number;
  polling?: boolean;
  onRefresh: () => Promise<void>;
}

export function RefreshStatus({ refreshing, updatedAt, polling, onRefresh }: RefreshStatusProps) {
  return <div className="table-toolbar" aria-label="Data freshness">
    <button className="btn btn-ghost btn-sm" disabled={refreshing} onClick={() => void onRefresh()}>{refreshing ? "Refreshing…" : "Refresh"}</button>
    <span>{updatedAt ? <>Last updated <time dateTime={new Date(updatedAt).toISOString()}>{new Date(updatedAt).toLocaleTimeString()}</time></> : "Not yet loaded"}</span>
    {polling && <span>Checking delivery status every 5 seconds, for up to 12 checks. Refresh to check again afterward.</span>}
  </div>;
}
