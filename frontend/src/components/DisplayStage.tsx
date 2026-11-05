import { useEffect, useRef, useState } from "react";
import { Connection } from "../api";

type Props = {
  conn: Connection;
  mode: "live" | "demo";
  token?: string | null;
  readOnly?: boolean;
  onClipboard?: (text: string) => void;
  onState?: (state: string) => void;
  onKey?: (label: string) => void;
  scaleMode: "fit" | "1:1";
  sendClipboard?: string;
  injectKey?: { keysym: number; pressed: boolean; n: number } | null;
  reconnectNonce: number;
};

export default function DisplayStage({
  conn,
  mode,
  token,
  readOnly,
  onClipboard,
  onState,
  onKey,
  scaleMode,
  sendClipboard,
  injectKey,
  reconnectNonce
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clientRef = useRef<{
    connect: (data?: string) => void;
    disconnect: () => void;
    getDisplay: () => {
      getElement: () => HTMLElement;
      scale: (n: number) => void;
      getWidth: () => number;
      getHeight: () => number;
      showCursor: (show: boolean) => void;
    };
    sendMouseState: (state: unknown, applyScale?: boolean) => void;
    sendKeyEvent: (pressed: number | boolean, keysym: number) => void;
    createClipboardStream: (mimetype: string) => unknown;
    onerror: ((err: { message?: string } | string) => void) | null;
    onstatechange: ((state: number) => void) | null;
    onclipboard: ((stream: unknown, mimetype: string) => void) | null;
  } | null>(null);
  const [liveReady, setLiveReady] = useState(false);

  useEffect(() => {
    if (mode !== "live" || !token || typeof Guacamole === "undefined") {
      setLiveReady(false);
      onState?.(mode === "live" ? "waiting" : "preview");
      return;
    }

    const host = hostRef.current;
    if (!host) return;

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/ws/display/?token=${encodeURIComponent(token)}`;
    const tunnel = new Guacamole.WebSocketTunnel(url);
    const client = new Guacamole.Client(tunnel);
    clientRef.current = client;

    host.innerHTML = "";
    const displayEl = client.getDisplay().getElement();
    displayEl.className = "display-surface";
    host.appendChild(displayEl);

    client.onstatechange = (state) => {
      const labels = ["idle", "connecting", "waiting", "connected", "disconnecting", "disconnected"];
      onState?.(labels[state] || String(state));
      if (state === 3) setLiveReady(true);
      if (state === 5) setLiveReady(false);
    };
    client.onerror = (err) => {
      onState?.(typeof err === "string" ? err : err?.message || "tunnel error");
    };
    client.onclipboard = (stream) => {
      const reader = new Guacamole.StringReader(stream);
      let buf = "";
      reader.ontext = (t) => {
        buf += t;
      };
      reader.onend = () => onClipboard?.(buf);
    };

    if (!readOnly) {
      const mouse = new Guacamole.Mouse(displayEl);
      mouse.onEach(["mousedown", "mousemove", "mouseup"], (e) => {
        client.sendMouseState(e.state, true);
      });
      mouse.on("mouseout", () => client.getDisplay().showCursor(true));

      const keyboard = new Guacamole.Keyboard(document);
      keyboard.onkeydown = (keysym) => {
        client.sendKeyEvent(1, keysym);
        onKey?.(`↓ ${keysym.toString(16)}`);
        return false;
      };
      keyboard.onkeyup = (keysym) => {
        client.sendKeyEvent(0, keysym);
      };
      client.connect();
      return () => {
        keyboard.onkeydown = null;
        keyboard.onkeyup = null;
        keyboard.reset();
        client.disconnect();
        clientRef.current = null;
      };
    }

    client.connect();
    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [mode, token, reconnectNonce, readOnly]);

  useEffect(() => {
    const client = clientRef.current;
    const host = hostRef.current;
    if (!client || !host || !liveReady) return;

    function fit() {
      const display = client!.getDisplay();
      const w = display.getWidth();
      const h = display.getHeight();
      if (!w || !h) return;
      if (scaleMode === "1:1") {
        display.scale(1);
        return;
      }
      const rect = host!.parentElement?.getBoundingClientRect();
      if (!rect) return;
      const s = Math.min(rect.width / w, rect.height / h);
      display.scale(Math.max(0.2, Math.min(s, 2)));
    }
    fit();
    const ro = new ResizeObserver(fit);
    if (host.parentElement) ro.observe(host.parentElement);
    return () => ro.disconnect();
  }, [liveReady, scaleMode]);

  useEffect(() => {
    if (!sendClipboard || !clientRef.current) return;
    const stream = clientRef.current.createClipboardStream("text/plain");
    const writer = new Guacamole.StringWriter(stream);
    writer.sendText(sendClipboard);
    writer.sendEnd();
  }, [sendClipboard]);

  useEffect(() => {
    if (!injectKey || !clientRef.current) return;
    clientRef.current.sendKeyEvent(injectKey.pressed ? 1 : 0, injectKey.keysym);
  }, [injectKey]);

  useEffect(() => {
    if (mode === "live" && token) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const surface = canvas;
    const gfx = ctx;
    let raf = 0;
    let t = 0;
    function draw() {
      const w = surface.width;
      const h = surface.height;
      t += 0.016;
      gfx.fillStyle = "#120e14";
      gfx.fillRect(0, 0, w, h);
      if (conn.protocol === "ssh") drawTerminal(gfx, w, h, t);
      else drawDesktop(gfx, w, h, t, conn.protocol);
      gfx.fillStyle = "rgba(216, 148, 88, 0.05)";
      for (let y = 0; y < h; y += 3) gfx.fillRect(0, y, w, 1);
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [mode, token, conn]);

  const showDemo = mode !== "live" || !token || !liveReady;

  return (
    <>
      <div ref={hostRef} className={`display-host ${showDemo ? "hidden" : ""}`} />
      {showDemo && <canvas ref={canvasRef} width={1280} height={720} />}
    </>
  );
}

function drawDesktop(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, protocol: string) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#2a1c28");
  g.addColorStop(1, "#3a2a22");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#1a141c";
  ctx.fillRect(0, h - 42, w, 42);
  ctx.fillStyle = "#d89458";
  ctx.fillRect(8, h - 34, 86, 26);
  ctx.fillStyle = "#f4e6d4";
  ctx.font = "500 22px Fraunces, serif";
  ctx.fillText(protocol === "vnc" ? "Remote framebuffer" : "Remote desktop session", 24, 48);
  ctx.font = "14px IBM Plex Mono, monospace";
  ctx.fillStyle = "#b59a82";
  ctx.fillText("Helix display · preview", 24, 72);
  for (let i = 0; i < 6; i++) {
    const x = 40 + (i % 3) * 240;
    const y = 120 + Math.floor(i / 3) * 200;
    ctx.fillStyle = "rgba(38, 29, 36, 0.92)";
    ctx.fillRect(x, y, 210, 160);
    ctx.strokeStyle = "rgba(216, 148, 88, 0.4)";
    ctx.strokeRect(x, y, 210, 160);
    ctx.fillStyle = "#d89458";
    ctx.fillRect(x + 16, y + 16, 28, 28);
    ctx.fillStyle = "#f4e6d4";
    ctx.font = "16px Fraunces, serif";
    ctx.fillText(["Files", "Terminal", "Browser", "Notes", "Mail", "Settings"][i], x + 54, y + 36);
    ctx.fillStyle = "#b59a82";
    ctx.font = "12px IBM Plex Mono, monospace";
    ctx.fillText("preview window", x + 16, y + 80);
  }
  const mx = w * 0.55 + Math.sin(t) * 80;
  const my = h * 0.42 + Math.cos(t * 0.8) * 40;
  ctx.fillStyle = "#f4e6d4";
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(mx + 14, my + 22);
  ctx.lineTo(mx + 6, my + 20);
  ctx.lineTo(mx, my + 32);
  ctx.closePath();
  ctx.fill();
}

function drawTerminal(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  ctx.fillStyle = "#120e14";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#d89458";
  ctx.font = "15px IBM Plex Mono, monospace";
  const lines = [
    "helix@devbox:~$",
    "display client ready",
    "protocol=ssh  cols=140  rows=40",
    "",
    "preview mode",
    "local pty until the host is attached",
    "",
    " $ helix status",
    "display    ready",
    "control    ready",
    "share      ready",
    "idle       15m",
    "",
    `load average: ${(1.1 + Math.sin(t) * 0.2).toFixed(2)}`
  ];
  lines.forEach((line, i) => ctx.fillText(line, 28, 40 + i * 28));
  if (Math.floor(t * 2) % 2 === 0) ctx.fillRect(28, 40 + 14 * 28, 10, 16);
}
