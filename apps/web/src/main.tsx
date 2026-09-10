import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installFrontendVersionGuard } from "./lib/frontend-version";

installFrontendVersionGuard();

createRoot(document.getElementById("root")!).render(<App />);
