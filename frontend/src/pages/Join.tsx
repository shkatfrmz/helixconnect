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
      <p className="eyebrow">Share join</p>
      <h1>{error || `Joining ${code}…`}</h1>
    </div>
  );
}
