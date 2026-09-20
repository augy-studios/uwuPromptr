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

/* ---- ICE servers ----

   Two devices on one network reach each other directly and none of this
   matters. Across two networks they often cannot: a mobile carrier usually
   puts a phone behind a symmetric NAT, where STUN learns an address that is
   already wrong by the time the other end tries it, and the data channel never
   opens. That is why a prompter on ethernet and a remote on 5G would not pair
   while two browsers on one wifi did.

   A TURN relay is the only thing that fixes that case, so /api/turn-credentials
   mints short-lived ones. It is fetched rather than hardcoded because a
   permanent username and password in this file would be readable by anybody
   and the relay would be theirs too.

   **Not having a relay is a supported state.** The endpoint answers with an
   empty list when it is not configured, the fetch is allowed to fail, and
   either way pairing carries on with STUN alone, which is all it ever had. */

const FALLBACK_ICE = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

let icePromise = null;

function loadIceServers() {
  // Cached for the life of the page: the credentials outlive any one pairing,
  // and a second fetch on every reconnect would be noise.
  if (icePromise) return icePromise;

  icePromise = fetch("/api/turn-credentials", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      const servers = payload?.data?.iceServers;
      return Array.isArray(servers) && servers.length > 0 ? servers : FALLBACK_ICE;
    })
    .catch(() => FALLBACK_ICE);

  return icePromise;
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
   { type: "bye" }                   remote to prompter, leaving on purpose

   **`bye` is what tells a deliberate exit from an accident.** The channel
   closing looks identical either way, and the prompter retires its code when
   the remote is done with it. Without this it would retire on every dropped
   packet and every page navigation, and somebody who stepped off the remote
   page for two seconds would come back to a code that no longer exists.

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

    // Whether this link ever actually opened. A link that closes without
    // having opened never reached the other end, and saying "the prompter
    // closed the connection" about it is a claim about somebody else's device
    // that is simply untrue: the usual cause is a network that will not carry
    // peer to peer traffic at all.
    let everOpened = false;

    // A link we are tearing down ourselves. Its close handler still fires, and
    // reporting that as the far end going away would be wrong: it is this end
    // hanging up. The difference matters because a drop now retires the code,
    // and a Stop that silently published a new one would be a puzzle.
    const isOurs = () => this.link === link;

    link.on("open", () => {
      everOpened = true;
      this.setStatus("connected");
    });
    link.on("data", (message) => {
      if (!message || typeof message !== "object") return;
      this.dispatchEvent(new CustomEvent("message", { detail: message }));
    });
    link.on("close", () => {
      if (!isOurs()) return;
      this.link = null;
      if (everOpened) this.setStatus("dropped");
      else this.setStatus("unreachable");
    });
    link.on("error", () => {
      if (!isOurs()) return;
      this.link = null;
      if (everOpened) this.setStatus("dropped");
      else this.setStatus("unreachable");
    });
  }

  close() {
    // Cleared before the close, so the handlers above see a link that is no
    // longer the current one and stay quiet. The status this call ends on is
    // idle, and nothing should overwrite it on the way there.
    const link = this.link;
    this.link = null;
    link?.close();
    this.peer?.destroy();
    this.peer = null;
    this.setStatus("idle");
  }
}

// The prompter end: publish a code and accept whoever connects with it.
export class RemoteHost extends Connection {
  // From this end a remote that dropped and a remote that never arrived are the
  // same state: nobody is connected and the code is still live. Both are
  // reported as waiting, so the panel says what to do rather than describing
  // the other device.
  //
  // The code outliving the drop is the point: a remote whose page reloaded or
  // that navigated away is expected back on the same id, and only an explicit
  // `bye` retires it.
  setStatus(status, detail) {
    const mapped = status === "dropped" || status === "unreachable" ? "waiting" : status;
    super.setStatus(mapped, detail);
  }

  async start(code) {
    const [Peer, iceServers] = await Promise.all([loadPeerJs(), loadIceServers()]);
    this.code = code;
    this.setStatus("connecting");

    this.peer = new Peer(PEER_PREFIX + code, { debug: 0, config: { iceServers } });

    this.peer.on("open", () => this.setStatus("waiting"));
    this.peer.on("connection", (link) => {
      // One remote at a time. A second connection replaces the first rather
      // than fighting it for control of the same prompter.
      //
      // Detached before closing, so the outgoing link's close handler sees it
      // is no longer current and does not report the handover as the remote
      // dropping away. That report would retire the code out from under the
      // remote that has this moment arrived on it.
      const previous = this.link;
      this.link = null;
      previous?.close();
      this.bindLink(link);
    });
    this.peer.on("error", (error) => {
      // An id already taken means something else is holding this code: another
      // tab of the prompter, or the broker still releasing the peer from a
      // page that has just reloaded. The code is kept between sessions now, so
      // this is the ordinary collision rather than a rarity, and `taken` lets
      // the panel retry under a fresh one instead of stranding somebody on an
      // error they did not cause.
      this.setStatus("error", {
        message: describePeerError(error),
        taken: error?.type === "unavailable-id",
      });
    });
  }
}

// The remote end: connect to a code somebody read off the prompter.
// How long to wait for the data channel to open before saying so. A WebRTC
// handshake across two networks is usually under a couple of seconds; one that
// has taken fifteen is not slow, it is blocked, and without this the page sits
// on "Connecting" indefinitely because nothing ever errors.
const CONNECT_TIMEOUT_MS = 15000;

export class RemoteClient extends Connection {
  async connect(code) {
    const [Peer, iceServers] = await Promise.all([loadPeerJs(), loadIceServers()]);
    this.setStatus("connecting");

    this.peer = new Peer({ debug: 0, config: { iceServers } });

    const timer = setTimeout(() => {
      if (this.status !== "connected") {
        this.link?.close();
        this.link = null;
        this.setStatus("unreachable");
      }
    }, CONNECT_TIMEOUT_MS);

    this.addEventListener("status", (event) => {
      if (event.detail.status === "connected") clearTimeout(timer);
    });

    this.peer.on("open", () => {
      const link = this.peer.connect(PEER_PREFIX + code, { reliable: true });
      this.bindLink(link);
      link.on("open", () => this.send({ type: "hello" }));
    });

    this.peer.on("error", (error) => {
      // peer-unavailable means the broker has no peer under that code: the
      // prompter is not running, is on a different code, or its panel was
      // closed. That is a different thing from a channel that cannot be
      // opened, and it gets its own message.
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
