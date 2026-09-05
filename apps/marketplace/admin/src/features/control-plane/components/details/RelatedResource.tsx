import type { DetailRequest } from "@/shared/types/controlPlane";
export function RelatedResource({ type, id, label, onOpen }: { type: "order" | "package" | "shipment" | "warehouse"; id?: string; label?: string; onOpen?: (detail: DetailRequest) => void }) {
  if (!id) return <span>{label || "Not recorded"}</span>;
  return onOpen ? <button type="button" className="link-button" onClick={() => onOpen({ type, id })} aria-label={`Open ${type} ${label || id}`}>{label || id}</button> : <span>{label || id}</span>;
}
