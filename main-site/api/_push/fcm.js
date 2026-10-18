// Firebase Cloud Messaging, HTTP v1, with no SDK.
//
// The OAuth token is a JWT signed with the service account's key by
// node:crypto, traded at Google for an access token, and cached until five
// minutes before it expires. A 401 drops the cache and tries once more.
//
// Environment, set in the Vercel project (see android/FIREBASE-SETUP.md):
//
//   FIREBASE_SERVICE_ACCOUNT   the service account's JSON key, as it was
//                              downloaded or base64 encoded
//
// Not a function itself: Vercel skips files under a folder that starts with an
// underscore.

import { createSign } from "node:crypto";

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

let cached = null; // { token, expiresAt }

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set");
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const account = JSON.parse(text);
  if (!account.client_email || !account.private_key || !account.project_id) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not a service account key");
  }
  return account;
}

const base64url = (value) => Buffer.from(value).toString("base64url");

async function accessToken(account) {
  if (cached && cached.expiresAt - 5 * 60 * 1000 > Date.now()) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(account.private_key).toString("base64url");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!response.ok) throw new Error(`Google refused the service account (${response.status})`);
  const answer = await response.json();
  cached = { token: answer.access_token, expiresAt: Date.now() + answer.expires_in * 1000 };
  return cached.token;
}

/**
 * Send to everybody on `topic`.
 *
 * The message carries `notification`, which Android shows itself while the app
 * is in the background, and the same as `data` (strings only) for the page
 * when the app is in front, and for the tap that opens it.
 */
export async function sendToTopic(topic, { title, body, data = {}, channelId, tag }) {
  const account = serviceAccount();
  const message = {
    topic,
    notification: { title, body },
    data: Object.fromEntries(Object.entries({ title, body, ...data }).map(([k, v]) => [k, String(v)])),
    android: {
      notification: {
        channel_id: channelId,
        tag,
        icon: "ic_notification_icon",
      },
    },
  };

  const url = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await accessToken(account)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    });
    if (response.status === 401 && attempt === 0) {
      cached = null;
      continue;
    }
    if (!response.ok) {
      throw new Error(`FCM answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    return response.json();
  }
  throw new Error("FCM refused the token twice");
}
