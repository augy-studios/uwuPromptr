// Short-lived TURN credentials for the remote control.
//
// Pairing works peer to peer wherever the two devices can reach each other
// directly. They often cannot: a mobile carrier usually puts a phone behind a
// symmetric NAT, where STUN alone cannot open a path, and the connection fails
// with no error beyond a channel that never opens. That is the case this
// exists for, and it is why a prompter on ethernet and a remote on 5G could
// not pair while two browsers on one wifi could.
//
// TURN fixes it by relaying, which means a server that anyone with the
// credentials can push traffic through. So the credentials are minted here,
// per request, and expire within the hour:
//
//   username    <unix expiry>:<label>
//   credential  base64(HMAC-SHA1(TURN_SECRET, username))
//
// This is coturn's `use-auth-secret` scheme. The long-lived secret stays in
// the environment on this side and never reaches a browser; what a reader can
// read out of devtools stops working by itself. Putting a permanent username
// and password in the client instead would hand the relay to anybody who
// looked at the page source.
//
// Environment, set in the Vercel project:
//
//   TURN_SECRET  the same string as static-auth-secret in turnserver.conf
//   TURN_HOST    the VPS hostname, for example turn.uwuapps.org
//   TURN_REALM   optional, defaults to TURN_HOST
//
// See turn-server/README.md at the repository root for the coturn side.

import { createHmac } from "node:crypto";

// Long enough for a rehearsal and a take, short enough that a credential
// copied out of devtools is not worth keeping.
const TTL_SECONDS = 60 * 60;

export default function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ ok: false, error: "Use GET." });
  }

  // Never cached, by a CDN or a service worker. A credential is minted for the
  // moment it is asked for, and a stored copy would be handed out after it had
  // expired, which looks exactly like the relay being broken.
  response.setHeader("Cache-Control", "no-store, private");

  const secret = process.env.TURN_SECRET;
  const host = process.env.TURN_HOST;

  // Not configured is a normal state, not a failure: the app is deployable
  // without a relay and simply pairs only where the devices can reach each
  // other directly. The client treats an empty list as "carry on with STUN".
  if (!secret || !host) {
    return response.status(200).json({
      ok: true,
      data: { iceServers: [], relay: false },
    });
  }

  const expiry = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const username = `${expiry}:uwupromptr`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");

  // Both transports and both ports. 443 over TCP is the one that gets through
  // a restrictive network, because it is indistinguishable from any other
  // outbound TLS connection; UDP is tried first because it is faster when it
  // is allowed at all.
  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: `stun:${host}:3478` },
    {
      urls: [
        `turn:${host}:3478?transport=udp`,
        `turn:${host}:3478?transport=tcp`,
        `turns:${host}:5349?transport=tcp`,
      ],
      username,
      credential,
    },
  ];

  return response.status(200).json({
    ok: true,
    data: { iceServers, relay: true, expiresAt: expiry },
  });
}
