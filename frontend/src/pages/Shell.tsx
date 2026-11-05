import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export default function Shell() {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  return (
    <div className="app-shell">
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
