import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, Session } from "../api";

export default function Join() {
  const { code } = useParams();
  const nav = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!code) return;
    api<Session>("/api/join", {
      method: "POST",
      body: JSON.stringify({ code })
    })
      .then((sess) => nav(`/session/${sess.connectionId}?sid=${sess.id}`, { replace: true }))
      .catch((err) => setError(err instanceof Error ? err.message : "Join failed"));
  }, [code, nav]);

  return (
    <div className="page">
      <div className="join-status">
        <div className="join-status-photo" />
        <div className="join-status-body">
          <p className="eyebrow">Share join</p>
          <h1>{error || `Joining ${code}…`}</h1>
          {error && <p className="muted">Check the code and try again, or ask the host for a new share link.</p>}
        </div>
      </div>
    </div>
  );
}
