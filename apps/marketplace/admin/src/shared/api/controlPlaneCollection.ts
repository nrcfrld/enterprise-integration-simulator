import { controlPlaneRequest } from "./controlPlaneClient";

/** Exhaust the control-plane page contract; never silently return a partial picker. */
export async function controlPlaneCollection<T>(path: string, token?: string | null): Promise<T[]> {
  const records: T[] = [];
  let page = 1;
  let next = path;
  while (true) {
    const result = await controlPlaneRequest<import("@/shared/types/controlPlane").ListResponse<T>>(next, token);
    if (result.pagination && result.pagination.page !== page) throw new Error("The collection changed while loading. Refresh to load all choices.");
    records.push(...(result.data || []));
    if (!result.pagination || page >= result.pagination.total_pages) return records;
    if (!result.data?.length) throw new Error("The collection changed while loading. Refresh to load all choices.");
    const url = new URL(path, "http://control.local");
    url.searchParams.set("page", String(++page));
    url.searchParams.set("limit", String(result.pagination.limit));
    next = url.pathname + url.search;
  }
}
