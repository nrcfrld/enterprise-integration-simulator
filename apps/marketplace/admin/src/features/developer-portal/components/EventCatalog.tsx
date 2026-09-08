import { EVENT_CATALOG, eventMapping } from "@/shared/events/catalog";

export function EventCatalog() {
  return <details className="page-hint">
    <summary>Supported events, provider categories, and how to trigger them</summary>
    <p>Admin and shared webhook registrations use canonical event names. Provider subscriptions select a category and receive all events mapped to it. Event Logs shows the canonical payload; delivery attempts show the transformed request. Scenario settings change delivery behavior and do not create domain events by themselves.</p>
    <div className="table-wrap"><table className="records-table"><thead><tr><th>Canonical event</th><th>Shopee category</th><th>Tokopedia topic / body type</th><th>Trigger</th></tr></thead><tbody>{EVENT_CATALOG.map(event => <tr key={event.name}><td><code>{event.name}</code></td><td>{eventMapping(event.name, "SHOPEE_LIKE")}</td><td>{eventMapping(event.name, "TOKOPEDIA_LIKE")}</td><td>{event.trigger}</td></tr>)}</tbody></table></div>
    <p>Subscribe before triggering an event, or use Replay in Event Logs afterward. Inspect its delivery attempts, verify the exact body, deduplicate by event ID, and fetch current resource state before applying an update.</p>
  </details>;
}
