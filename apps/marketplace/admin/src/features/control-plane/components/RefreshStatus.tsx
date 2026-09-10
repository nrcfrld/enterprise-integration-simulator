interface RefreshStatusProps {
  refreshing: boolean;
  updatedAt?: number;
  polling?: boolean;
  onRefresh: () => Promise<void>;
}

export function RefreshStatus({ refreshing, updatedAt, polling, onRefresh }: RefreshStatusProps) {
  return <div className="data-freshness" aria-label="Data freshness">
    <span className="data-freshness-time">{updatedAt ? <>Updated <time dateTime={new Date(updatedAt).toISOString()}>{new Date(updatedAt).toLocaleTimeString()}</time></> : "Not yet loaded"}</span>
    {polling && <span className="data-freshness-polling">Checking delivery status every 5 seconds, for up to 12 checks.</span>}
    <button className="btn btn-ghost btn-sm" disabled={refreshing} onClick={() => void onRefresh()}>
      <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16"><path d="M15.4 6.2A6 6 0 1 0 16 12m-.6-5.8V2.8m0 3.4H12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {refreshing ? "Refreshing…" : "Refresh"}
    </button>
  </div>;
}
