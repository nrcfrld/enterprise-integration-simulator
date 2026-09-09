import { useEffect, useRef, useState, type FormEvent } from "react";
import { controlPlaneCollection } from "@/shared/api/controlPlaneCollection";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import type { ProductSummary } from "@/shared/types/controlPlane";
import type { DetailContentProps } from "./types";

export function WarehouseDetail({
  data,
  token,
  onReload,
  onRefresh,
  onNotice,
  onError,
}: DetailContentProps) {
  const [productFilter, setProductFilter] = useState("");
  const [catalogProducts, setCatalogProducts] = useState<ProductSummary[]>([]);
  const [inventoryDrafts, setInventoryDrafts] = useState<Record<string, { value: string; baseline: number; version?: string }>>({});
  const pendingRef = useRef(false);
  const [saving, setSaving] = useState<string>();
  const discardDraft = (id: string) => setInventoryDrafts(current => { const next = { ...current }; delete next[id]; return next; });
  const [newInventory, setNewInventory] = useState<{
    product_id: string;
    on_hand_quantity: number | string;
  }>({ product_id: "", on_hand_quantity: 0 });

  useEffect(() => {
    if (!data.shop_id) return;
    let active = true;
    controlPlaneCollection<ProductSummary>(
      `/control/v1/shops/${data.shop_id}/products?limit=100`,
      token,
    )
      .then((result) => {
        if (active) setCatalogProducts(result);
      })
      .catch((error: unknown) => {
        if (active) onError(error instanceof Error ? error.message : "Request failed");
      });
    return () => {
      active = false;
    };
  }, [data.shop_id, onError, token]);

  const saveInventory = async (productID: string, onHandQuantity: unknown) => {
    if (pendingRef.current) return;
    const draft = inventoryDrafts[productID];
    const currentItem = data.inventory?.find(item => item.product_id === productID);
    if (draft && currentItem && (draft.baseline !== currentItem.on_hand_quantity || draft.version !== currentItem.updated_at)) {
      onError("Stock changed while you were editing. Use the latest count, then re-enter your adjustment.");
      return;
    }
    const quantity = onHandQuantity === "" ? NaN : Number(onHandQuantity);
    if (!productID) {
      onError("Choose a product before adding inventory.");
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      onError("On-hand quantity must be a whole number of zero or more.");
      return;
    }

    onError("");
    pendingRef.current = true;
    setSaving(productID);
    try {
      await controlPlaneRequest<unknown>(
        `/control/v1/warehouses/${data.id}/inventory/${productID}`,
        token,
        {
          method: "PUT",
          body: JSON.stringify({ on_hand_quantity: quantity, expected_updated_at: draft?.version ?? currentItem?.updated_at ?? "" }),
        },
      );
      discardDraft(productID);
      await onReload();
      setNewInventory((current) =>
        current.product_id === productID
          ? { product_id: "", on_hand_quantity: 0 }
          : current,
      );
      await onRefresh();
      onNotice("Warehouse inventory updated");
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === "INVENTORY_CONFLICT") {
        try { await onReload(); } catch { /* Keep the conflict and unsaved count visible. */ }
      }
      onError(error instanceof Error ? error.message : "Request failed");
    } finally {
      pendingRef.current = false;
      setSaving(undefined);
    }
  };

  const submitNewInventory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void saveInventory(newInventory.product_id, newInventory.on_hand_quantity);
  };

  const availableProducts = catalogProducts.filter(
    (product) => !data.inventory?.some((item) => item.product_id === product.id),
  );

  return (
    <>
      <p>
        Status: <b>{data.status}</b> · Priority <b>{data.priority}</b>
      </p>
      <div className="order-detail-grid">
        <section>
          <p className="eyebrow">Warehouse</p>
          <h3>{data.name}</h3>
          <p>{data.code}</p>
        </section>
        <section>
          <p className="eyebrow">Address</p>
          <h3>{data.address?.address_line || "Not supplied"}</h3>
          <p>
            {[data.address?.city, data.address?.postal_code]
              .filter(Boolean)
              .join(" · ") || "—"}
          </p>
        </section>
      </div>
      <h3>Inventory</h3>
      <p>Available = on hand − reserved. Saving on-hand quantity replaces the physical count; it does not add a delta. For example, to add 5 to 10 on hand, enter 15. The count cannot be less than reserved stock. Saves check the loaded inventory version; if stock changes before Save, refresh and review the count before trying again.</p>
      <p>Only ACTIVE warehouses receive new orders. Larger priority wins among warehouses that can fulfill every order line; ties use warehouse code alphabetically.</p>
      {data.inventory?.length ? (
        <div className="table-wrap">
          <table className="records-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>On hand</th>
                <th>Reserved</th>
                <th>Available</th>
                <th>Adjust</th>
              </tr>
            </thead>
            <tbody>
              {data.inventory.map((item) => (
                <tr key={item.product_id}>
                  <td>{item.sku}</td>
                  <td>{item.product_name}</td>
                  <td>{item.on_hand_quantity}</td>
                  <td>{item.reserved_quantity}</td>
                  <td>{item.available_quantity}</td>
                  <td>
                    <form
                      className="inventory-adjustment"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveInventory(
                          item.product_id,
                          inventoryDrafts[item.product_id]?.value ?? item.on_hand_quantity,
                        );
                      }}
                    >
                      <input
                        aria-label={`On hand quantity for ${item.product_name}`}
                        disabled={Boolean(saving)}
                        required
                        type="number"
                        min={item.reserved_quantity}
                        value={inventoryDrafts[item.product_id]?.value ?? item.on_hand_quantity}
                        onChange={(event) =>
                          setInventoryDrafts((current) => ({
                            ...current,
                            [item.product_id]: { value: event.target.value, baseline: current[item.product_id]?.baseline ?? item.on_hand_quantity, version: current[item.product_id]?.version ?? item.updated_at },
                          }))
                        }
                      />
                      <button disabled={Boolean(saving) || Boolean(inventoryDrafts[item.product_id] && (inventoryDrafts[item.product_id].baseline !== item.on_hand_quantity || inventoryDrafts[item.product_id].version !== item.updated_at))}>{saving === item.product_id ? "Saving…" : "Save"}</button>
                      {inventoryDrafts[item.product_id] && <span role="status">
                        {(inventoryDrafts[item.product_id].baseline !== item.on_hand_quantity || inventoryDrafts[item.product_id].version !== item.updated_at) ? `Stock changed from ${inventoryDrafts[item.product_id].baseline} to ${item.on_hand_quantity}. Review your unsaved count.` : "Unsaved count"}
                        <button type="button" disabled={Boolean(saving)} onClick={() => discardDraft(item.product_id)}>Use latest count</button>
                      </span>}
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty compact">No product inventory is assigned to this warehouse.</p>
      )}
      <form className="inventory-addition" onSubmit={submitNewInventory}>
        {availableProducts.length > 20 && <label>Filter inventory products<input type="search" value={productFilter} onChange={event => setProductFilter(event.target.value)} /></label>}
        <label>
          Add a product to this warehouse
          <select
            required
            disabled={Boolean(saving)}
            value={newInventory.product_id}
            onChange={(event) =>
              setNewInventory((current) => ({
                ...current,
                product_id: event.target.value,
              }))
            }
          >
            <option value="">Choose product</option>
            {availableProducts.filter(product => product.id === newInventory.product_id || `${product.name} ${product.sku} ${product.id}`.toLowerCase().includes(productFilter.toLowerCase())).map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} · {product.sku}
              </option>
            ))}
          </select>
        </label>
        <label>
          On-hand quantity
          <input
            disabled={Boolean(saving)}
            aria-label="New inventory on-hand quantity"
            type="number"
            min="0"
            required
            value={newInventory.on_hand_quantity}
            onChange={(event) =>
              setNewInventory((current) => ({
                ...current,
                on_hand_quantity: event.target.value,
              }))
            }
          />
        </label>
        <button disabled={!newInventory.product_id || Boolean(saving)}>Add inventory</button>
      </form>
    </>
  );
}
