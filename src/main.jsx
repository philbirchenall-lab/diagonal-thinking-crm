import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AuthWrapper from "./AuthWrapper.jsx";
import { ThemeBootstrapper } from "./components/ThemeBootstrapper.jsx";
import { DevThemeToggle } from "./components/DevThemeToggle.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeBootstrapper />
    <AuthWrapper>
      <App />
    </AuthWrapper>
    <DevThemeToggle />
  </React.StrictMode>,
);
