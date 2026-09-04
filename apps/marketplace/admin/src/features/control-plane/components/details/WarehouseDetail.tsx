import { useEffect, useState, type FormEvent } from "react";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import type { ListResponse, ProductSummary } from "@/shared/types/controlPlane";
import type { DetailContentProps } from "./types";

export function WarehouseDetail({
  data,
  token,
  onReload,
  onRefresh,
  onNotice,
  onError,
}: DetailContentProps) {
  const [catalogProducts, setCatalogProducts] = useState<ProductSummary[]>([]);
  const [inventoryDrafts, setInventoryDrafts] = useState<Record<string, number>>({});
  const [newInventory, setNewInventory] = useState<{
    product_id: string;
    on_hand_quantity: number | string;
  }>({ product_id: "", on_hand_quantity: 0 });

  useEffect(() => {
    if (!data.shop_id) return;
    let active = true;
    controlPlaneRequest<ListResponse<ProductSummary>>(
      `/control/v1/shops/${data.shop_id}/products?limit=100`,
      token,
    )
      .then((result) => {
        if (active) setCatalogProducts(result.data || []);
      })
      .catch((error: unknown) => {
        if (active) onError(error instanceof Error ? error.message : "Request failed");
      });
    return () => {
      active = false;
    };
  }, [data.shop_id, onError, token]);

  const saveInventory = async (productID: string, onHandQuantity: unknown) => {
    const quantity = Number(onHandQuantity);
    if (!productID) {
      onError("Choose a product before adding inventory.");
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      onError("On-hand quantity must be a whole number of zero or more.");
      return;
    }

    onError("");
    try {
      await controlPlaneRequest<unknown>(
        `/control/v1/warehouses/${data.id}/inventory/${productID}`,
        token,
        {
          method: "PUT",
          body: JSON.stringify({ on_hand_quantity: quantity }),
        },
      );
      await onReload();
      setInventoryDrafts((current) => ({ ...current, [productID]: quantity }));
      setNewInventory((current) =>
        current.product_id === productID
          ? { product_id: "", on_hand_quantity: 0 }
          : current,
      );
      await onRefresh();
      onNotice("Warehouse inventory updated");
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : "Request failed");
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
                          inventoryDrafts[item.product_id] ?? item.on_hand_quantity,
                        );
                      }}
                    >
                      <input
                        aria-label={`On hand quantity for ${item.product_name}`}
                        type="number"
                        min={item.reserved_quantity}
                        value={inventoryDrafts[item.product_id] ?? item.on_hand_quantity}
                        onChange={(event) =>
                          setInventoryDrafts((current) => ({
                            ...current,
                            [item.product_id]: Number(event.target.value),
                          }))
                        }
                      />
                      <button>Save</button>
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
        <label>
          Add a product to this warehouse
          <select
            required
            value={newInventory.product_id}
            onChange={(event) =>
              setNewInventory((current) => ({
                ...current,
                product_id: event.target.value,
              }))
            }
          >
            <option value="">Choose product</option>
            {availableProducts.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} · {product.sku}
              </option>
            ))}
          </select>
        </label>
        <label>
          On-hand quantity
          <input
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
        <button disabled={!newInventory.product_id}>Add inventory</button>
      </form>
    </>
  );
}
