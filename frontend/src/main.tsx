import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/fonts.css";
import "./design/tokens.css";
import "./styles/base.css";
import "./styles/print.css";
import Workbench from "./workbench/Workbench";

const container = document.getElementById("root");
if (!container) throw new Error("missing #root");

createRoot(container).render(
  <StrictMode>
    <Workbench />
  </StrictMode>,
);
