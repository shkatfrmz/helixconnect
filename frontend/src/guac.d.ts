export {};

declare global {
  const Guacamole: {
    Client: new (tunnel: unknown) => GuacClient;
    WebSocketTunnel: new (url: string) => unknown;
    Mouse: new (el: HTMLElement) => GuacMouse;
    Keyboard: new (el: Document | HTMLElement) => GuacKeyboard;
    StringReader: new (stream: unknown) => { ontext: ((t: string) => void) | null; onend: (() => void) | null };
    StringWriter: new (stream: unknown) => { sendText: (t: string) => void; sendEnd: () => void };
    SessionRecording: new (blob: Blob) => GuacSessionRecording;
  };

  type GuacDisplay = {
    getElement: () => HTMLElement;
    scale: (n: number) => void;
    getWidth: () => number;
    getHeight: () => number;
    getScale: () => number;
    showCursor: (show: boolean) => void;
  };

  type GuacClient = {
    connect: (data?: string) => void;
    disconnect: () => void;
    getDisplay: () => GuacDisplay;
    sendMouseState: (state: unknown, applyScale?: boolean) => void;
    sendKeyEvent: (pressed: boolean | number, keysym: number) => void;
    reset?: () => void;
    createClipboardStream: (mimetype: string) => unknown;
    onerror: ((err: { message?: string } | string) => void) | null;
    onstatechange: ((state: number) => void) | null;
    onclipboard: ((stream: unknown, mimetype: string) => void) | null;
    onname: ((name: string) => void) | null;
  };

  // The official recording-playback engine from guacamole-common-js, bundled
  // in public/vendor/display.js alongside Guacamole.Client. It parses a .guac
  // file (the exact format guacd itself writes server-side when a connection
  // has recording-path set) and replays it into a normal Guacamole.Display,
  // so play/pause/seek work over a real session timeline.
  type GuacSessionRecording = {
    connect: (data?: string) => void;
    disconnect: () => void;
    getDisplay: () => GuacDisplay;
    play: () => void;
    pause: () => void;
    seek: (position: number, callback?: () => void) => void;
    cancel: () => void;
    isPlaying: () => boolean;
    getPosition: () => number;
    getDuration: () => number;
    onplay: (() => void) | null;
    onpause: (() => void) | null;
    onseek: ((position: number) => void) | null;
    onprogress: ((duration: number, current: number) => void) | null;
    onload: (() => void) | null;
    onerror: ((message: string) => void) | null;
  };

  type GuacMouse = {
    onEach: (events: string[], handler: (e: { state: unknown }) => void) => void;
    on: (event: string, handler: () => void) => void;
  };

  type GuacKeyboard = {
    onkeydown: ((keysym: number) => boolean | void) | null;
    onkeyup: ((keysym: number) => void) | null;
    reset: () => void;
  };
}
