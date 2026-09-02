import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ControlPlaneApp } from "../features/control-plane/ControlPlaneApp";
import "../styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("The Marketplace admin root element is missing.");
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <ControlPlaneApp />
    </BrowserRouter>
  </StrictMode>,
);
