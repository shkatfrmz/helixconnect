import fs from "fs";
import path from "path";

// Where .guac recording files live on disk — one file per recorded session,
// named "<sessionId>.guac". Configurable because a real deployment will
// want this on a volume with retention/backup policy, not the app's cwd.
export const RECORDINGS_DIR = process.env.HELIX_RECORDINGS_DIR
  ? path.resolve(process.env.HELIX_RECORDINGS_DIR)
  : path.resolve(process.cwd(), "recordings");

export function ensureRecordingsDir() {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

export function recordingFileName(sessionId) {
  return `${sessionId}.guac`;
}

export function recordingFilePath(sessionId) {
  return path.join(RECORDINGS_DIR, recordingFileName(sessionId));
}

export function recordingFileExists(sessionId) {
  return fs.existsSync(recordingFilePath(sessionId));
}

export function recordingFileSize(sessionId) {
  try {
    return fs.statSync(recordingFilePath(sessionId)).size;
  } catch {
    return 0;
  }
}

export function deleteRecordingFile(sessionId) {
  try {
    fs.unlinkSync(recordingFilePath(sessionId));
  } catch {
    /* already gone, or was never written (e.g. a live session that never
       reached guacd) — deleting the metadata row should still succeed. */
  }
}

// Encodes one Guacamole protocol instruction: each element (opcode, then
// each arg) is length-prefixed as "<charLength>.<value>", joined with
// commas, terminated with a semicolon. This is the exact wire format guacd
// itself writes to a .guac recording file, so anything we write here plays
// back in the bundled Guacamole.SessionRecording player identically to a
// real guacd-produced recording.
function encodeInstruction(opcode, args = []) {
  const elements = [String(opcode), ...args.map(String)];
  return elements.map((el) => `${el.length}.${el}`).join(",") + ";";
}

// Demo mode has no real guacd relay behind it, so there is no actual
// remote-desktop video feed to capture — Catalog/Admin just simulate one
// in the browser. Rather than fake a recording (or skip the feature
// entirely in demo mode), we still write a real, valid .guac file: a
// "size" instruction gives the player a canvas, and one "sync" instruction
// per second of session wall-clock time gives it a genuine timeline to
// scrub. The playback UI, storage, and retention all behave exactly as
// they would for a live recording — the only difference is an intentional
// blank picture, since nothing was ever actually drawn.
export function synthesizeDemoRecording(sessionId, durationMs) {
  ensureRecordingsDir();
  const frames = Math.max(1, Math.round(durationMs / 1000));
  let out = encodeInstruction("size", [0, 1280, 720]);
  for (let i = 0; i <= frames; i++) {
    out += encodeInstruction("sync", [i * 1000]);
  }
  fs.writeFileSync(recordingFilePath(sessionId), out, "utf8");
  return recordingFileSize(sessionId);
}
