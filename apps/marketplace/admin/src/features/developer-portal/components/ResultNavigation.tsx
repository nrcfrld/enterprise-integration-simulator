import type { PortalEndpoint } from "../types";

export function ResultNavigation({ endpoint, body, onNextPage, onSelect }: {
  endpoint: PortalEndpoint;
  body: string;
  onNextPage: (page: number, token?: string) => void;
  onSelect?: (endpointID: string, id: string) => void;
}) {
  try {
    const envelope = JSON.parse(body);
    const data = endpoint.contract === "shopee" ? envelope.response : endpoint.contract === "tokopedia" ? envelope.data : envelope;
    if (!data) return null;
    const next = data.has_more && typeof data.next_page_token === "string" && data.next_page_token
      ? { page: 0, token: data.next_page_token }
      : data.more || data.has_next_page ? { page: Number(data.page_no) + 1, token: undefined }
      : data.pagination?.has_next ? { page: Number(data.pagination.page) + 1, token: undefined } : undefined;
    const target = ({
      "tokopedia-search-orders": ["orders", "order_id", "tokopedia-get-order"],
      "tokopedia-search-products": ["products", "product_id", "tokopedia-get-product"],
      "shopee-list-products": ["item", "item_id", "shopee-get-product"],
      "list-warehouses": ["data", "id", "get-warehouse"],
      "list-webhooks": ["data", "id", "delete-webhook"],
    } as Record<string, string[]>)[endpoint.id];
    const rows: Array<Record<string, unknown>> = target && Array.isArray(data[target[0]]) ? data[target[0]] : [];
    return <section aria-label="Continue from response">
      {next && <button type="button" onClick={() => onNextPage(next.page, next.token)}>Fetch next page</button>}
      {onSelect && target && rows.filter(row => typeof row?.[target[1]] === "string").map(row => {
        const id = String(row[target[1]]);
        return <p key={id}><code>{id}</code> {String(row.name ?? row.order_status ?? row.url ?? "")}
          <button type="button" onClick={() => onSelect(target[2], id)}>Use returned ID: {id}</button></p>;
      })}
    </section>;
  } catch { return null; }
}
