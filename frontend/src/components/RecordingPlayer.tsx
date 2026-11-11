import { useEffect, useRef, useState } from "react";
import { apiBlob } from "../api";

type Props = {
  recordingId: string;
  onClose: () => void;
};

function fmt(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function RecordingPlayer({ recordingId, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<GuacSessionRecording | null>(null);
  const [status, setStatus] = useState("Loading recording…");
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let cancelled = false;

    // The Guacamole.Display element sizes itself in real pixels from the
    // recording's "size" instruction (1280x720 for our synthetic demo
    // recordings, whatever the host's resolution was for a real one) — it
    // doesn't respond to CSS max-width, so it has to be scaled down to fit
    // the modal explicitly, same as DisplayStage does for a live session.
    function fit() {
      const recording = recRef.current;
      const host = hostRef.current;
      if (!recording || !host) return;
      const display = recording.getDisplay();
      const w = display.getWidth();
      const h = display.getHeight();
      if (!w || !h) return;
      const rect = host.getBoundingClientRect();
      const s = Math.min(rect.width / w, rect.height / h, 1);
      display.scale(Math.max(0.1, s));
    }

    apiBlob(`/api/recordings/${recordingId}/stream`)
      .then((blob) => {
        if (cancelled || typeof Guacamole === "undefined") return;
        const recording = new Guacamole.SessionRecording(blob);
        recRef.current = recording;

        recording.onload = () => {
          setDuration(recording.getDuration());
          setStatus("");
          // The display's real pixel size isn't known until its first frame
          // is actually loaded (the "size" instruction lives inside that
          // frame's byte range) — seeking to 0 loads it immediately so the
          // player can size itself before the person presses Play.
          recording.seek(0, fit);
        };
        recording.onerror = (message) => setStatus(message || "Playback error");
        recording.onplay = () => setPlaying(true);
        recording.onpause = () => setPlaying(false);
        recording.onprogress = (total) => setDuration(total);
        recording.onseek = (pos) => setPosition(pos);

        const host = hostRef.current;
        if (host) {
          host.innerHTML = "";
          const el = recording.getDisplay().getElement();
          el.className = "display-surface";
          host.appendChild(el);
        }
      })
      .catch((err) => setStatus(err instanceof Error ? err.message : "Failed to load recording"));

    const timer = setInterval(() => {
      const rec = recRef.current;
      if (rec && rec.isPlaying()) setPosition(rec.getPosition());
      fit();
    }, 250);

    return () => {
      cancelled = true;
      clearInterval(timer);
      recRef.current?.pause();
      recRef.current = null;
    };
  }, [recordingId]);

  function toggle() {
    const rec = recRef.current;
    if (!rec) return;
    if (rec.isPlaying()) rec.pause();
    else rec.play();
  }

  function seek(ms: number) {
    setPosition(ms);
    recRef.current?.seek(ms);
  }

  return (
    <div className="recording-player">
      <div className="recording-stage" ref={hostRef} />
      {status && <p className="tiny">{status}</p>}
      <div className="recording-controls">
        <button type="button" className="ghost" onClick={toggle} disabled={!duration}>
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={duration || 0}
          value={position}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={!duration}
        />
        <span className="tiny recording-time">
          {fmt(position)} / {fmt(duration)}
        </span>
        <button type="button" className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
