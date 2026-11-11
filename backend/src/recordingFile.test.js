import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

// synthesizeDemoRecording/recordingFile* all resolve RECORDINGS_DIR from the
// HELIX_RECORDINGS_DIR env var at import time, so point it at a scratch
// directory before importing — these are the real file-writing paths used
// by the running server, just pointed somewhere disposable for the test.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "helix-rec-test-"));
process.env.HELIX_RECORDINGS_DIR = scratch;

const {
  RECORDINGS_DIR,
  recordingFilePath,
  recordingFileExists,
  recordingFileSize,
  deleteRecordingFile,
  synthesizeDemoRecording
} = await import("./recordingFile.js");

test("RECORDINGS_DIR resolves to the configured scratch directory", () => {
  assert.equal(RECORDINGS_DIR, path.resolve(scratch));
});

test("synthesizeDemoRecording writes a valid, non-empty .guac file", () => {
  const size = synthesizeDemoRecording("sess-demo-1", 5000);
  assert.ok(size > 0);
  assert.equal(recordingFileExists("sess-demo-1"), true);
  assert.equal(recordingFileSize("sess-demo-1"), size);

  const raw = fs.readFileSync(recordingFilePath("sess-demo-1"), "utf8");
  // Every instruction must be a comma-separated list of length-prefixed
  // elements terminated by a semicolon — this is the exact wire format the
  // bundled Guacamole.SessionRecording player parses.
  const instructions = raw.split(";").filter(Boolean);
  assert.ok(instructions.length >= 2); // at least "size" + one "sync"
  for (const instr of instructions) {
    const elements = instr.split(",");
    for (const el of elements) {
      const [lenPart, ...rest] = el.split(".");
      const value = rest.join(".");
      assert.equal(Number(lenPart), value.length, `malformed element "${el}" in instruction "${instr}"`);
    }
  }
  assert.ok(raw.startsWith("4.size,"));
});

test("synthesizeDemoRecording always produces at least one frame, even for a zero-length session", () => {
  const size = synthesizeDemoRecording("sess-demo-zero", 0);
  assert.ok(size > 0);
  const raw = fs.readFileSync(recordingFilePath("sess-demo-zero"), "utf8");
  assert.ok(raw.includes("4.sync"));
});

test("deleteRecordingFile removes the file and is safe to call again", () => {
  synthesizeDemoRecording("sess-demo-2", 1000);
  assert.equal(recordingFileExists("sess-demo-2"), true);
  deleteRecordingFile("sess-demo-2");
  assert.equal(recordingFileExists("sess-demo-2"), false);
  assert.doesNotThrow(() => deleteRecordingFile("sess-demo-2"));
});
