import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { DatacenterArt } from "../components/DatacenterArt";

const THEME_KEY = "helix.theme";

export default function Shell() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [theme, setTheme] = useState<"dark" | "light">(() => (localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark"));

  useEffect(() => {
    if (theme === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return (
    <div className="app-shell">
      <DatacenterArt variant="mark" className="shell-dc" />
      <header className="topbar">
        <div className="brand-lockup" onClick={() => nav("/")}>
          <span className="glyph">H</span>
          <div>
            <strong>Helix Remote</strong>
            <small>console</small>
          </div>
        </div>
        <nav>
          <NavLink to="/" end>
            Connections
          </NavLink>
          <NavLink to="/live">Live</NavLink>
          <NavLink to="/admin">Gateway</NavLink>
        </nav>
        <div className="who">
          <button
            className="ghost theme-toggle"
            type="button"
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <span className="avatar">{user?.avatar}</span>
          <div>
            <strong>{user?.displayName}</strong>
            <small>{user?.role}</small>
          </div>
          <button
            className="ghost"
            onClick={() => {
              logout();
              nav("/login");
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
