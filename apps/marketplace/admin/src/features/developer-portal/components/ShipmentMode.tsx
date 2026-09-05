export function ShipmentMode({ body, onChange }: { body: string; onChange: (body: string) => void }) {
  let input: Record<string, unknown>;
  try { const parsed: unknown = JSON.parse(body); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null; input = parsed as Record<string, unknown>; } catch { return null; }
  const existing = Object.hasOwn(input, "package_id");
  return <fieldset><legend>Which items should this shipment carry?</legend>
    <label>Package selection<select value={existing ? "existing" : "automatic"} onChange={event => {
      const next = { ...input }; if (event.target.value === "existing") next.package_id = ""; else delete next.package_id;
      onChange(JSON.stringify(next, null, 2));
    }}><option value="existing">Ship an existing package</option><option value="automatic">Automatically package remaining items</option></select></label>
    {existing ? <label>Package ID<input required value={typeof input.package_id === "string" ? input.package_id : ""} onChange={event => onChange(JSON.stringify({ ...input, package_id: event.target.value }, null, 2))} /><small>Use the returned package.id from allocation, package_list[].package_id from order detail, or the ID in Admin Packages. It must belong to this order and have no shipment yet.</small></label> : <p>Omitting package_id creates a new package containing only unallocated quantities. If all items are already allocated, choose “Ship an existing package”.</p>}
    <p>Create all package shipments before advancing shipment movement; creation requires READY_TO_SHIP (Tokopedia: AWAITING_COLLECTION). A shipment request returns one shipment. Read order detail for the full shipment_list.</p>
  </fieldset>;
}
