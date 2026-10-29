import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./styles/v2.css";
import "./styles/performance.css";
import "./styles/organization.css";
import "./styles/select.css";
import "./styles/loading.css";

const App = lazy(() => import('./App').then(module => ({default: module.App})));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<div className="app-loading" role="status"><div><strong>亿觅成长 OS</strong><p>正在准备你的工作台…</p><span className="app-loading-track" aria-hidden="true"><i/></span></div></div>}>
      <App />
    </Suspense>
  </StrictMode>,
);
