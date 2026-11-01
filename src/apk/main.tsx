import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Desk } from "@/components/desk";
import "@/styles.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Desk initial={{ ok: false, message: "正在连接上交所、深交所行情" }} />
    </StrictMode>,
  );
}
