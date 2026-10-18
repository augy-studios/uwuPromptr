// GitHub webhook: a new Android release, pushed to everybody who turned on
// New version alerts in the app.
//
//   POST /api/push/release   (GitHub: Releases events, application/json)
//
// A web-standard handler, so the signature is checked against the raw body,
// byte for byte, before anything is parsed.
//
// Only `released` (a published, non-pre-release release), only android-v*
// tags with the APK finished uploading, and never for a version older than the
// newest: re-publishing an old release must not tell every phone to "update"
// to it. Answers GitHub's ping with { ok: true, pong: true }.
//
// Environment, set in the Vercel project (see android/FIREBASE-SETUP.md):
//
//   GITHUB_WEBHOOK_SECRET      the secret typed into the webhook on GitHub
//   FIREBASE_SERVICE_ACCOUNT   see api/_push/fcm.js

import { createHmac, timingSafeEqual } from "node:crypto";
import { describeRelease, isNewer, latestRelease } from "../_lib/release.js";
import { sendToTopic } from "../_push/fcm.js";

// The app joins this topic (js/app-native.js) and shows it on its "New
// versions" channel (Notifications.java).
const TOPIC = "cue-releases";
const CHANNEL = "updates";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function signedByGitHub(raw, signature, secret) {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`);
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function POST(request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return json({ ok: false, error: "Not configured." }, 503);

  const raw = Buffer.from(await request.arrayBuffer());
  if (!signedByGitHub(raw, request.headers.get("x-hub-signature-256"), secret)) {
    return json({ ok: false, error: "Bad signature." }, 401);
  }

  const event = request.headers.get("x-github-event");
  if (event === "ping") return json({ ok: true, pong: true });
  if (event !== "release") return json({ ok: true, skipped: "not a release event" });

  const payload = JSON.parse(raw.toString("utf8"));
  if (payload.action !== "released") return json({ ok: true, skipped: `action ${payload.action}` });

  const offer = describeRelease(payload.release);
  if (!offer) return json({ ok: true, skipped: "not an Android release with its APK" });

  // GitHub's list can lag the event by a moment, so only a strictly newer
  // release elsewhere stops this one.
  try {
    const newest = await latestRelease();
    if (newest && isNewer(newest.version, offer.version)) {
      return json({ ok: true, skipped: `${offer.version} is older than ${newest.version}` });
    }
  } catch {
    // GitHub's list unavailable: the event itself is enough to go on.
  }

  try {
    await sendToTopic(TOPIC, {
      title: `uwuPromptr ${offer.version} is out`,
      body: "Tap to update the app.",
      data: { type: "update", version: offer.version },
      channelId: CHANNEL,
      tag: "update",
    });
  } catch (cause) {
    console.warn("release push:", cause?.message ?? cause);
    return json({ ok: false, error: "Could not send the notification." }, 502);
  }

  return json({ ok: true, sent: offer.version });
}
