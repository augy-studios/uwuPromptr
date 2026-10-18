// The offline remote: phone to phone over Bluetooth and Wi-Fi, through the
// Android app's Nearby Connections, with no router and no mobile data.
//
// App only, and only when the app lists the "nearby" feature (it needs Google
// Play services). Both phones need the app.
//
// The two classes here behave like RemoteHost and RemoteClient in remote.js:
// the same events ("status" and "message"), the same statuses, send() and
// close(), and the same messages on the wire, so the prompter and the remote
// page treat either link the same way.
//
// **How the right prompter is found without the code going out over the air.**
// The prompter advertises under a name made from a hash of its remote id. The
// remote, given the id, works out the same name and connects to whoever has
// it. The id itself is only ever sent inside the encrypted connection, as the
// first message, and the prompter drops a remote that gets it wrong.

import { AppBridge } from "./app-bridge.js";

// Long enough to find a phone across a room and agree a connection, which
// Nearby can take ten seconds or more to do on Bluetooth alone.
const FIND_TIMEOUT_MS = 30000;
// A connected phone that has not said the right code by now is not ours.
const AUTH_TIMEOUT_MS = 8000;

export function nearbyAvailable() {
  return AppBridge.has("nearby");
}

/** The name a prompter advertises under for `code`. */
export async function nearbyName(code) {
  const bytes = new TextEncoder().encode(`uwupromptr-nearby:${code}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return "cue-" + Array.from(hash.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A refusal from the app, in a sentence that says what to do. */
export function describeNearbyRefusal(state) {
  switch (state) {
    case "denied":
      return "Connecting without wifi needs the Nearby devices permission. Allow it in Android's settings for uwuPromptr.";
    case "location-off":
      return "Turn on location to connect without wifi. This version of Android needs it for Bluetooth.";
    case "unavailable":
      return "Connecting without wifi needs Google Play services, which this phone does not have.";
    default:
      return "Could not start connecting without wifi.";
  }
}

class NearbyLink extends EventTarget {
  constructor() {
    super();
    this.status = "idle";
    this.listener = null;
    this.ready = false;
  }

  setStatus(status, detail = {}) {
    this.status = status;
    this.dispatchEvent(new CustomEvent("status", { detail: { status, ...detail } }));
  }

  listen() {
    this.listener?.remove();
    this.listener = AppBridge.on("Cue", "nearby", (event) => this.onNative(event));
  }

  // Only once the link is ready for the page's messages: the code checked on
  // the prompter's side, the code sent on the remote's.
  send(message) {
    if (!this.ready) return;
    AppBridge.call("Cue", "nearbySend", { data: JSON.stringify(message) }).catch(() => {});
  }

  emitMessage(data) {
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return null;
    }
    return message && typeof message === "object" ? message : null;
  }

  close() {
    this.ready = false;
    this.listener?.remove();
    this.listener = null;
    AppBridge.call("Cue", "nearbyStop").catch(() => {});
    this.setStatus("idle");
  }
}

/** The prompter end: findable under its code, one remote at a time. */
export class NearbyHost extends NearbyLink {
  async start(code) {
    this.code = code;
    this.ready = false;
    this.listen();
    this.setStatus("connecting");

    let answer;
    try {
      answer = await AppBridge.call("Cue", "nearbyAdvertise", { name: await nearbyName(code) });
    } catch {
      answer = { state: "failed" };
    }
    if (answer?.state !== "granted") {
      this.close();
      this.setStatus("error", { message: describeNearbyRefusal(answer?.state), state: answer?.state });
    }
    return answer?.state;
  }

  onNative(event) {
    if (event.event === "message") {
      const message = this.emitMessage(event.data);
      if (!message) return;

      if (!this.ready) {
        // The first thing a remote says is the code. Anything else, or the
        // wrong code, and it is dropped.
        clearTimeout(this.authTimer);
        if (message.type === "auth" && message.code === this.code) {
          this.ready = true;
          this.setStatus("connected");
        } else {
          AppBridge.call("Cue", "nearbyDisconnect").catch(() => {});
        }
        return;
      }

      this.dispatchEvent(new CustomEvent("message", { detail: message }));
      return;
    }

    if (event.event !== "status") return;
    switch (event.status) {
      case "waiting":
        this.ready = false;
        this.setStatus("waiting");
        break;
      case "connected":
        // Linked, but not trusted until the code arrives.
        clearTimeout(this.authTimer);
        this.authTimer = setTimeout(() => {
          if (!this.ready) AppBridge.call("Cue", "nearbyDisconnect").catch(() => {});
        }, AUTH_TIMEOUT_MS);
        break;
      case "dropped":
        // The code outlives the drop, as on the web remote: the phone may be
        // coming back, and the prompter stays findable for it.
        this.ready = false;
        this.setStatus("waiting");
        break;
      case "error":
        if (!this.ready) this.setStatus("error", { message: "Connecting without wifi failed. Check Bluetooth is on." });
        break;
      default:
        break;
    }
  }

  close() {
    clearTimeout(this.authTimer);
    super.close();
  }
}

/** The remote end: find the prompter showing `code` and connect to it. */
export class NearbyClient extends NearbyLink {
  async connect(code) {
    this.code = code;
    this.ready = false;
    this.listen();
    this.setStatus("connecting");

    let answer;
    try {
      answer = await AppBridge.call("Cue", "nearbyDiscover", { name: await nearbyName(code) });
    } catch {
      answer = { state: "failed" };
    }
    if (answer?.state !== "granted") {
      this.close();
      this.setStatus("error", { message: describeNearbyRefusal(answer?.state) });
      return;
    }

    this.findTimer = setTimeout(() => {
      if (this.ready) return;
      this.close();
      this.setStatus("error", {
        message:
          "Could not find that prompter nearby. Check its remote panel says it is waiting for a nearby phone, " +
          "that the code is the one on screen, and that Bluetooth is on on both phones.",
      });
    }, FIND_TIMEOUT_MS);
  }

  onNative(event) {
    if (event.event === "message") {
      const message = this.emitMessage(event.data);
      if (message && this.ready) this.dispatchEvent(new CustomEvent("message", { detail: message }));
      return;
    }

    if (event.event !== "status") return;
    switch (event.status) {
      case "connected":
        clearTimeout(this.findTimer);
        this.ready = true;
        // The code first, then the same hello the web remote opens with.
        this.send({ type: "auth", code: this.code });
        this.send({ type: "hello" });
        this.setStatus("connected");
        break;
      case "dropped":
        this.ready = false;
        this.setStatus("dropped");
        break;
      case "error":
        if (!this.ready) break; // Still searching: the timer reports it.
        this.setStatus("error", { message: "The nearby connection failed." });
        break;
      default:
        break;
    }
  }

  close() {
    clearTimeout(this.findTimer);
    super.close();
  }
}
