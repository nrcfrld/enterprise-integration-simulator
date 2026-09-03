import { useState } from "react";
import { ENDPOINT_BY_ID, ENDPOINTS } from "./data/endpoints";
import { CodeExamples } from "./components/CodeExamples";
import { ApiReference } from "./components/ApiReference";
import { CredentialPanel } from "./components/CredentialPanel";
import { HttpMethod } from "./components/HttpMethod";
import { RequestSimulator } from "./components/RequestSimulator";
import { Authentication, Errors, QuickStart } from "./sections/Guides";
import type { IntegrationCredentials, PortalSection } from "./types";

interface DeveloperPortalProps {
  api: string;
  onNavigate: (page: string) => void;
}

function TryIt({ api, activeEndpointID, onSelect, credentials, onCredentialsChange, onNavigate }: {
  api: string;
  activeEndpointID: string;
  onSelect: (endpointID: string) => void;
  credentials: IntegrationCredentials;
  onCredentialsChange: (credentials: IntegrationCredentials) => void;
  onNavigate: (page: string) => void;
}) {
  const endpoint = ENDPOINT_BY_ID[activeEndpointID] ?? ENDPOINTS[0];
  const contracts = ["shared", "shopee", "tokopedia"] as const;
  return <><section className="try-heading"><h2>Make a signed request to the provider you are integrating with.</h2><p>Choose a provider contract first. The simulator signs and sends the exact request shape used by the selected Marketplace API.</p></section><div className="contract-switcher" aria-label="Provider contract">{contracts.map((contract) => <button key={contract} type="button" className={endpoint.contract === contract ? "selected" : ""} onClick={() => onSelect(ENDPOINTS.find((item) => item.contract === contract)?.id ?? endpoint.id)}>{contract === "shared" ? "Shared resources" : contract === "shopee" ? "Shopee-like" : "Tokopedia-like"}</button>)}</div><CredentialPanel credentials={credentials} onChange={onCredentialsChange} onClear={() => onCredentialsChange({ clientID: "", secret: "", accessToken: "" })} onNavigate={onNavigate} contract={endpoint.contract} /><section className="operation-picker"><div><h3>Choose an operation</h3><p>Start with a list or search request. It returns ids you can paste into the next lifecycle operation.</p></div><div>{ENDPOINTS.filter((item) => item.contract === endpoint.contract).map((item) => <button type="button" key={item.id} className={item.id === endpoint.id ? "selected" : ""} onClick={() => onSelect(item.id)}><HttpMethod method={item.method} /><span><b>{item.title}</b><small>{item.group}</small></span></button>)}</div></section><RequestSimulator key={endpoint.id} endpoint={endpoint} api={api} credentials={credentials} /><CodeExamples endpoint={endpoint} /></>;
}

export function DeveloperPortal({ api, onNavigate }: DeveloperPortalProps) {
  const [section, setSection] = useState<PortalSection>("quickstart");
  const [activeEndpointID, setActiveEndpointID] = useState("list-warehouses");
  const [credentials, setCredentials] = useState<IntegrationCredentials>({ clientID: "", secret: "", accessToken: "" });
  const openTry = (endpointID: string) => { setActiveEndpointID(endpointID); setSection("try"); };

  let content;
  if (section === "quickstart") content = <QuickStart onNavigate={onNavigate} onTry={openTry} />;
  else if (section === "try") content = <TryIt api={api} activeEndpointID={activeEndpointID} onSelect={setActiveEndpointID} credentials={credentials} onCredentialsChange={setCredentials} onNavigate={onNavigate} />;
  else if (section === "authentication") content = <Authentication api={api} />;
  else if (section === "products") content = <ApiReference title="Products API reference" description="Read the provider catalogue without translating its public field names yourself. Every operation below documents its signing inputs, filters, payload, response envelope, and failure shape." note="Product creation, stock changes, and archival stay in the Admin Control Plane. The public Shopee-like and Tokopedia-like catalogue APIs are intentionally read-only." groups={["Products"]} endpoints={ENDPOINTS} onTry={openTry} />;
  else if (section === "warehouses") content = <ApiReference title="Warehouses API reference" description="Discover fulfillment origins and inspect their physical, reserved, and available inventory through the shared signed contract." note="Create warehouses and adjust stock in the Admin Control Plane. Public warehouse calls only expose data owned by the credential's shop." groups={["Warehouses"]} endpoints={ENDPOINTS} onTry={openTry} />;
  else if (section === "orders") content = <ApiReference title="Orders and fulfilment API reference" description="Follow each provider's order lifecycle from discovery through package allocation and shipment creation, with state prerequisites and provider-shaped responses visible at every step." note="List or search first and reuse the returned ID. Payment verification and physical shipment progression are simulator control-plane actions; merchant processing, packing, handover, package allocation, shipment creation, and eligible cancellation use these public APIs." groups={["Orders", "Fulfillment"]} endpoints={ENDPOINTS} onTry={openTry} />;
  else if (section === "webhooks") content = <ApiReference title="Webhook API reference" description="Register, list, or configure callback destinations using the event vocabulary and signing contract of each provider." note="Deliveries are asynchronous and at-least-once. Store the event or notification ID before processing, verify the signature against the exact raw body, and return a 2xx response only after successful processing." groups={["Webhooks"]} endpoints={ENDPOINTS} onTry={openTry} />;
  else content = <Errors />;

  return <div className="docs-portal">
    <header className="portal-topbar"><div className="portal-wordmark"><span>MARKETPLACE</span><b>Developer</b></div><div className="portal-links"><a href={`${api}/openapi.yaml`} target="_blank" rel="noreferrer">OpenAPI spec</a><a href={`${api}/swagger/index.html`} target="_blank" rel="noreferrer">API explorer</a><button type="button" className="quiet" onClick={() => onNavigate("Dashboard")}>Back to console</button></div></header>
    <div className="portal-frame">
      <aside className="portal-rail" aria-label="Developer documentation">
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
      <main className="portal-main">{content}</main>
    </div>
  </div>;
}
