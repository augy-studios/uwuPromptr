// Remote control, both ends.
//
// The prompter opens a peer under a short human-typeable id and waits; the
// remote at /remote?id=XXXXXX connects to it and the two exchange state over
// a WebRTC data channel. PeerJS's public broker does the introduction only,
// so nothing about a script ever passes through a server.
//
// This is the one part of the app that needs the network, and it is loaded
// lazily for exactly that reason: the prompter boots, scrolls, saves and
// reads with no connection at all, and only asks for PeerJS when somebody
// opens the remote panel. If it cannot load, the remote is unavailable and
// nothing else changes.

const PEERJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js";

// A namespace on the shared public broker, so our six characters cannot
// collide with somebody else's peer id.
const PEER_PREFIX = "uwupromptr-";

// No vowels and no 0/O/1/I, so a code read aloud off a screen cannot be
// misheard or mistyped, and no code can spell anything.
const CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXYZ23456789";
export const CODE_LENGTH = 6;

export function generateCode() {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function normaliseCode(input) {
  return String(input || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CODE_LENGTH);
}

export function isValidCode(input) {
  const code = normaliseCode(input);
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}

let peerLibrary = null;

function loadPeerJs() {
  if (peerLibrary) return Promise.resolve(peerLibrary);
  if (window.Peer) {
    peerLibrary = window.Peer;
    return Promise.resolve(peerLibrary);
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PEERJS_URL;
    script.async = true;
    script.onload = () => {
      if (!window.Peer) {
        reject(new Error("PeerJS loaded but did not define Peer"));
        return;
      }
      peerLibrary = window.Peer;
      resolve(peerLibrary);
    };
    script.onerror = () => reject(new Error("Could not load the remote control library"));
    document.head.appendChild(script);
  });
}

/* ---- the wire ----

   Five message types, and both ends understand all five.

   { type: "state",   payload }      prompter to remote, the whole visible state
   { type: "command", name, value }  remote to prompter, one action
   { type: "script",  name, body, rev }
                                     prompter to remote, what is on screen
   { type: "edit",    name, body, rev }
                                     remote to prompter, a rewritten script
   { type: "hello" }                 remote to prompter, asking for state

   **`rev` is what stops the two ends fighting.** Both can edit the same
   script, and without a counter the last message to arrive wins: somebody
   typing on the prompter while somebody else types on the remote would watch
   their sentence be replaced mid-word by an older copy of itself.

   The prompter owns the number. It sends the current `rev` with every script,
   the remote echoes back the one it was editing, and an edit carrying a stale
   `rev` is refused rather than applied. A refusal is not an error: the remote
   is told what the script actually says now, and redraws.
*/

class Connection extends EventTarget {
  constructor() {
    super();
    this.peer = null;
    this.link = null;
    this.status = "idle";
  }

  setStatus(status, detail) {
    this.status = status;
    this.dispatchEvent(new CustomEvent("status", { detail: { status, ...detail } }));
  }

  send(message) {
    if (this.link && this.link.open) {
      try {
        this.link.send(message);
      } catch {
        // A channel that closed between the check and the send. The close
        // handler will report it; dropping this one message is correct.
      }
    }
  }

  bindLink(link) {
    this.link = link;

    link.on("open", () => this.setStatus("connected"));
    link.on("data", (message) => {
      if (!message || typeof message !== "object") return;
      this.dispatchEvent(new CustomEvent("message", { detail: message }));
    });
    link.on("close", () => {
      this.link = null;
      this.setStatus("waiting");
    });
    link.on("error", () => {
      this.link = null;
      this.setStatus("waiting");
    });
  }

  close() {
    this.link?.close();
    this.peer?.destroy();
    this.link = null;
    this.peer = null;
    this.setStatus("idle");
  }
}

// The prompter end: publish a code and accept whoever connects with it.
export class RemoteHost extends Connection {
  async start(code) {
    const Peer = await loadPeerJs();
    this.code = code;
    this.setStatus("connecting");

    this.peer = new Peer(PEER_PREFIX + code, { debug: 0 });

    this.peer.on("open", () => this.setStatus("waiting"));
    this.peer.on("connection", (link) => {
      // One remote at a time. A second connection replaces the first rather
      // than fighting it for control of the same prompter.
      this.link?.close();
      this.bindLink(link);
    });
    this.peer.on("error", (error) => {
      // An id already taken means another tab of this prompter is holding
      // the code. Reporting it is more use than silently retrying under a
      // different one the person cannot see.
      this.setStatus("error", { message: describePeerError(error) });
    });
  }
}

// The remote end: connect to a code somebody read off the prompter.
export class RemoteClient extends Connection {
  async connect(code) {
    const Peer = await loadPeerJs();
    this.setStatus("connecting");

    this.peer = new Peer({ debug: 0 });

    this.peer.on("open", () => {
      const link = this.peer.connect(PEER_PREFIX + code, { reliable: true });
      this.bindLink(link);
      link.on("open", () => this.send({ type: "hello" }));
    });

    this.peer.on("error", (error) => {
      this.setStatus("error", { message: describePeerError(error) });
    });
  }
}

function describePeerError(error) {
  switch (error?.type) {
    case "peer-unavailable":
      return "No prompter is using that code. Check the code and try again.";
    case "unavailable-id":
      return "That code is already in use. Generate a new one.";
    case "network":
    case "server-error":
    case "socket-error":
    case "socket-closed":
      return "Cannot reach the pairing service. The prompter still works offline.";
    case "browser-incompatible":
      return "This browser cannot do peer to peer connections.";
    default:
      return "The remote connection failed.";
  }
}
