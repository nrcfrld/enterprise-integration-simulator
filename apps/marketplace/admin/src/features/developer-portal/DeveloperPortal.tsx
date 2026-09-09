import { InventoryGuide } from "./components/InventoryGuide";
import { LifecycleGuide } from "./components/LifecycleGuide";
import { FulfillmentGuide } from "./components/FulfillmentGuide";
import type { Shop, CredentialHandoff } from "@/shared/types/controlPlane";
import { useEffect, useState } from "react";
import type { ControlPage } from "@/app/navigation";
import { ENDPOINT_BY_ID, ENDPOINTS } from "./data/endpoints";
import { CodeExamples } from "./components/CodeExamples";
import { ApiReference } from "./components/ApiReference";
import { CredentialPanel } from "./components/CredentialPanel";
import { HttpMethod } from "./components/HttpMethod";
import { RequestSimulator } from "./components/RequestSimulator";
import { Authentication, Errors, QuickStart, Webhooks } from "./sections/Guides";
import type { IntegrationCredentials, PortalSection } from "./types";

interface DeveloperPortalProps {
  shop?: Shop;
  credentialHandoff?: CredentialHandoff;
  onHandoffConsumed?: () => void;
  api: string;
  onNavigate: (page: ControlPage) => void;
}

function TryIt({ shop, knownCredential, api, activeEndpointID, onSelect, credentials, onCredentialsChange, onNavigate }: {
  shop?: Shop;
  knownCredential?: CredentialHandoff;
  api: string;
  activeEndpointID: string;
  onSelect: (endpointID: string) => void;
  credentials: IntegrationCredentials;
  onCredentialsChange: (credentials: IntegrationCredentials) => void;
  onNavigate: (page: ControlPage) => void;
}) {
  const endpoint = ENDPOINT_BY_ID[activeEndpointID] ?? ENDPOINTS[0];
  const expectedContract = shop?.provider_profile === "TOKOPEDIA_LIKE" ? "tokopedia" : "shopee";
  const mismatch = shop && endpoint.contract !== "shared" && endpoint.contract !== expectedContract
    ? `This endpoint uses ${endpoint.contract}, but ${shop.name} uses ${expectedContract}. Choose the matching provider or change shops.` : "";
  const known = knownCredential?.credential.client_id === credentials.clientID ? knownCredential : undefined;
  const contracts = ["shared", "shopee", "tokopedia"] as const;
  const [selectedPackageID, setSelectedPackageID] = useState("");
  const [selectedOrderID, setSelectedOrderID] = useState("");
  const selectEndpoint = (id: string) => {
    setSelectedPackageID("");
    setSelectedOrderID("");
    onSelect(id);
  };
  const selectOrder = (orderID: string) => {
    setSelectedPackageID("");
    setSelectedOrderID(orderID);
    onSelect("shopee-get-order");
  };
  return <><section className="try-heading"><h2>Make a signed request to the provider you are integrating with.</h2><p>Choose a provider contract first. The simulator signs and sends the exact request shape used by the selected Marketplace API.</p></section><div className="contract-switcher join" aria-label="Provider contract">{contracts.map((contract) => <button key={contract} type="button" className={`btn btn-sm join-item ${endpoint.contract === contract ? "selected btn-primary" : "btn-ghost"}`} onClick={() => selectEndpoint(ENDPOINTS.find((item) => item.contract === contract)?.id ?? endpoint.id)}>{contract === "shared" ? "Shared resources" : contract === "shopee" ? "Shopee-like" : "Tokopedia-like"}</button>)}</div><CredentialPanel shop={shop} knownCredential={known} credentials={credentials} onChange={onCredentialsChange} onClear={() => onCredentialsChange({ clientID: "", secret: "", accessToken: "" })} onNavigate={onNavigate} contract={endpoint.contract} /><section className="operation-picker card bg-base-100"><div><h3>Choose an operation</h3><p>Start with a list or search request. It returns ids you can paste into the next lifecycle operation.</p></div><div>{ENDPOINTS.filter((item) => item.contract === endpoint.contract).map((item) => <button type="button" key={item.id} className={`btn ${item.id === endpoint.id ? "selected btn-primary" : "btn-ghost"}`} onClick={() => selectEndpoint(item.id)}><HttpMethod method={item.method} /><span><b>{item.title}</b><small>{item.group}</small></span></button>)}</div></section><RequestSimulator blockedReason={mismatch} shopProvider={shop?.provider_profile} key={endpoint.id} endpoint={endpoint} api={api} credentials={credentials} initialPathParams={selectedOrderID ? { id: selectedOrderID } : undefined} onSelectOrder={selectOrder} initialPackageID={selectedPackageID || undefined} onSelectPackage={(orderID, packageID) => { setSelectedOrderID(orderID); setSelectedPackageID(packageID); onSelect("shopee-create-shipment"); }} /><CodeExamples endpoint={endpoint} /></>;
}

export function DeveloperPortal({ shop, api, onNavigate, credentialHandoff, onHandoffConsumed }: DeveloperPortalProps) {
  const [section, setSection] = useState<PortalSection>("quickstart");
  const [activeEndpointID, setActiveEndpointID] = useState(shop?.provider_profile === "TOKOPEDIA_LIKE" ? "tokopedia-search-products" : shop ? "shopee-list-products" : "list-warehouses");
  const [credentials, setCredentials] = useState<IntegrationCredentials>({ clientID: "", secret: "", accessToken: "" });
  const [knownCredential, setKnownCredential] = useState<CredentialHandoff>();
  useEffect(() => {
    if (!credentialHandoff || credentialHandoff.shop.id !== shop?.id) return;
    const value = credentialHandoff.credential;
    setCredentials({ clientID: value.client_id, secret: value.client_secret, accessToken: value.access_token ?? "" });
    setKnownCredential({ ...credentialHandoff, credential: { ...value, client_secret: "", access_token: undefined } });
    setSection("try");
    onHandoffConsumed?.();
  }, [credentialHandoff, shop?.id, onHandoffConsumed]);
  const openTry = (endpointID: string) => { setActiveEndpointID(endpointID); setSection("try"); };

  let content;
  if (section === "quickstart") content = <QuickStart provider={shop?.provider_profile} onNavigate={onNavigate} onTry={openTry} onOpenSection={setSection} />;
  else if (section === "try") content = <TryIt shop={shop} knownCredential={knownCredential} api={api} activeEndpointID={activeEndpointID} onSelect={setActiveEndpointID} credentials={credentials} onCredentialsChange={value => { setCredentials(value); if (!value.clientID) setKnownCredential(undefined); }} onNavigate={onNavigate} />;
  else if (section === "authentication") content = <Authentication api={api} />;
  else if (section === "products") content = <ApiReference title="Products API reference" description="Read the provider catalogue without translating its public field names yourself. Every operation below documents its signing inputs, filters, payload, response envelope, and failure shape." note="Product creation, stock changes, and archival stay in the Admin Control Plane. The public Shopee-like and Tokopedia-like catalogue APIs are intentionally read-only." groups={["Products"]} endpoints={ENDPOINTS} onTry={openTry} />;
  else if (section === "warehouses") content = <><InventoryGuide /><ApiReference title="Warehouses API reference" description="Discover fulfillment origins and inspect their physical, reserved, and available inventory through the shared signed contract." note="Create warehouses and adjust stock in the Admin Control Plane. Public warehouse calls only expose data owned by the credential's shop." groups={["Warehouses"]} endpoints={ENDPOINTS} onTry={openTry} /></>;
  else if (section === "orders") content = <><LifecycleGuide /><FulfillmentGuide /><ApiReference title="Orders and fulfilment API reference" description="Follow each provider's order lifecycle from discovery through package allocation and shipment creation, with state prerequisites and provider-shaped responses visible at every step." note="List or search first and reuse the returned ID. Payment verification and physical shipment progression are simulator control-plane actions; merchant processing, packing, handover, package allocation, shipment creation, and eligible cancellation use these public APIs." groups={["Orders", "Fulfillment"]} endpoints={ENDPOINTS} onTry={openTry} /></>;
  else if (section === "webhooks") content = <><Webhooks onTry={openTry} /><ApiReference title="Webhook API reference" description="Register, list, or configure callback destinations using the event vocabulary and signing contract of each provider." note="Deliveries are asynchronous and at-least-once. Verify the exact raw bytes, then durably deduplicate and accept the event before returning 2xx." groups={["Webhooks"]} endpoints={ENDPOINTS} onTry={openTry} /></>;
  else content = <Errors />;

  return <div className="docs-portal">
    <header className="portal-topbar navbar"><div className="portal-wordmark"><span>MARKETPLACE</span><b>Developer</b></div><div className="portal-links"><a className="btn btn-ghost btn-sm" href={`${api}/openapi.yaml`} target="_blank" rel="noreferrer">OpenAPI spec</a><a className="btn btn-ghost btn-sm" href={`${api}/swagger/index.html`} target="_blank" rel="noreferrer">API explorer</a><button type="button" className="quiet btn btn-primary btn-sm" onClick={() => onNavigate("Dashboard")}>Back to console</button></div></header>
    <div className="portal-frame">
      <aside className="portal-rail menu" aria-label="Developer documentation">
        <button type="button" className={section === "quickstart" ? "selected" : ""} onClick={() => setSection("quickstart")}>Start here</button>
        <button type="button" className={section === "try" ? "selected" : ""} onClick={() => setSection("try")}>Request simulator</button>
        <p>CONCEPTS</p>
        <button type="button" className={section === "authentication" ? "selected" : ""} onClick={() => setSection("authentication")}>Request signing</button>
        <p>REFERENCE</p>
        <button type="button" className={section === "products" ? "selected" : ""} onClick={() => setSection("products")}>Products</button>
        <button type="button" className={section === "warehouses" ? "selected" : ""} onClick={() => setSection("warehouses")}>Warehouses</button>
        <button type="button" className={section === "orders" ? "selected" : ""} onClick={() => setSection("orders")}>Orders &amp; fulfilment</button>
        <button type="button" className={section === "webhooks" ? "selected" : ""} onClick={() => setSection("webhooks")}>Webhooks</button>
        <button type="button" className={section === "errors" ? "selected" : ""} onClick={() => setSection("errors")}>Errors &amp; limits</button>
        <p>SIMULATOR</p>
        <button type="button" onClick={() => onNavigate("Shops")}>Manage shops</button>
        <button type="button" onClick={() => onNavigate("Scenarios")}>Failure scenarios</button>
      </aside>
      <main className="portal-main">
        {shop ? <div className="portal-context" aria-label="Selected shop context">
          <span>Current shop</span>
          <strong>{shop.name}</strong>
          <span>{shop.provider_profile === "TOKOPEDIA_LIKE" ? "Tokopedia-like API" : "Shopee-like API"}</span>
          <code>{shop.id}</code>
        </div> : <div className="portal-context portal-context-empty"><span>No shop selected</span><button type="button" onClick={() => onNavigate("Shops")}>Choose a shop</button></div>}
        {content}
      </main>
    </div>
  </div>;
}
