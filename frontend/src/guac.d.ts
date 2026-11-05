export {};

declare global {
  const Guacamole: {
    Client: new (tunnel: unknown) => GuacClient;
    WebSocketTunnel: new (url: string) => unknown;
    Mouse: new (el: HTMLElement) => GuacMouse;
    Keyboard: new (el: Document | HTMLElement) => GuacKeyboard;
    StringReader: new (stream: unknown) => { ontext: ((t: string) => void) | null; onend: (() => void) | null };
    StringWriter: new (stream: unknown) => { sendText: (t: string) => void; sendEnd: () => void };
  };
}

type GuacClient = {
  connect: (data?: string) => void;
  disconnect: () => void;
  getDisplay: () => {
    getElement: () => HTMLElement;
    scale: (n: number) => void;
    getWidth: () => number;
    getHeight: () => number;
    getScale: () => number;
    showCursor: (show: boolean) => void;
  };
  sendMouseState: (state: unknown, applyScale?: boolean) => void;
  sendKeyEvent: (pressed: boolean | number, keysym: number) => void;
  reset?: () => void;
  createClipboardStream: (mimetype: string) => unknown;
  onerror: ((err: { message?: string } | string) => void) | null;
  onstatechange: ((state: number) => void) | null;
  onclipboard: ((stream: unknown, mimetype: string) => void) | null;
  onname: ((name: string) => void) | null;
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
