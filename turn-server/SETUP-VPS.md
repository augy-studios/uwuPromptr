# Setting up the TURN server, step by step

Written to be followed from top to bottom at a terminal on the Debian VPS,
with the DNS provider and the Vercel dashboard open in a browser. About twenty
minutes, most of it waiting for DNS.

Throughout, the hostname is **`turn.cue.uwuapps.org`** and the site is
**`cue.uwuapps.org`**. Commands are meant to be copied as they are; where a
block shows what came back, that is labelled.

For what this is and why it is needed, see [README.md](README.md).

---

## Before you start

You need:

- A Debian VPS with a **public IP** and root or sudo.
- Access to DNS for `uwuapps.org`.
- Access to the Vercel project for `cue.uwuapps.org`.
- Ports **3478** (UDP and TCP), **5349** (TCP), and **49160-49200** (UDP) not
  blocked by your provider's own firewall. Most VPS providers have a firewall
  in their control panel that is separate from the machine's; check it now,
  because a blocked port there looks exactly like a broken config here.

Find the public IP if you do not know it:

```bash
curl -4 ifconfig.me
```

Write it down. It is used twice below.

---

## 1. Point the hostname at the VPS

In your DNS provider, add an **A record**:

| Field | Value |
| --- | --- |
| Type | `A` |
| Name | `turn.cue` (or `turn.cue.uwuapps.org`, depending on the provider) |
| Value | the public IP from above |
| TTL | leave the default |
| Proxy | **off**, if the provider has one |

The proxy matters. On Cloudflare the orange cloud must be **grey**: a proxied
record hides the real IP and Cloudflare does not forward TURN, so the relay
would be unreachable and the certificate step would fail.

Wait for it to take effect, then check from the VPS:

```bash
dig +short turn.cue.uwuapps.org
```

It should print your VPS's IP and nothing else:

```text
203.0.113.10
```

**Do not continue until that prints your VPS's IP.** Every step below depends
on it, and certbot in particular will fail in a way that reads like a
certificate problem rather than a DNS one.

---

## 2. Install coturn

```bash
git clone https://github.com/augy-studios/uwuPromptr.git
cd uwuPromptr/turn-server
sudo bash setup.sh
```

This installs the package, copies `turnserver.conf` to `/etc/turnserver.conf`,
opens the firewall if `ufw` is running, and enables the service. It
deliberately does **not** start it: the config still has a placeholder secret.

### Or do it by hand

`setup.sh` is a convenience, not a requirement. The same thing, one command at
a time:

```bash
sudo apt update
sudo apt install -y coturn

# Debian ships it disabled behind this flag.
sudo sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn

# The config from this repository.
sudo cp turnserver.conf /etc/turnserver.conf
sudo chmod 640 /etc/turnserver.conf
sudo chgrp turnserver /etc/turnserver.conf

# The ports, if ufw is what you use.
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 5349/tcp
sudo ufw allow 49160:49200/udp

# Start on boot. Not started yet: the secret is still a placeholder.
sudo systemctl enable coturn
```

---

## 3. Get a certificate

For the `turns:` endpoint on 5349, which is the one that gets through
restrictive networks because it is indistinguishable from ordinary HTTPS.

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d turn.cue.uwuapps.org
```

`--standalone` binds port 80 briefly to prove you control the name. If
something is already using port 80 on this machine, stop it for the minute
this takes, or use the DNS challenge instead:

```bash
sudo certbot certonly --manual --preferred-challenges dns -d turn.cue.uwuapps.org
```

Check the files landed:

```bash
sudo ls -l /etc/letsencrypt/live/turn.cue.uwuapps.org/
```

`fullchain.pem` and `privkey.pem` should be there.

### Let coturn read them

certbot's directories are root-only, and coturn drops to its own user.

```bash
sudo groupadd -f ssl-cert
sudo usermod -aG ssl-cert turnserver
sudo chgrp -R ssl-cert /etc/letsencrypt/live /etc/letsencrypt/archive
sudo chmod -R g+rX /etc/letsencrypt/live /etc/letsencrypt/archive
```

Skipping this gives a coturn that starts, listens on 3478, and silently fails
on 5349, which is the hardest version of this to diagnose.

---

## 4. Generate the secret

```bash
openssl rand -hex 32
```

Something like:

```text
4f3c8a91be2d47a6905e1cf7b3d82064a5e9f1c0d7b4832e6a195cf0e2d7b843
```

Keep that terminal open. The same string goes in two places and **must match
exactly**, or every credential is rejected.

---

## 5. Edit the config

```bash
sudo nano /etc/turnserver.conf
```

Two lines to change. The realm and the certificate paths are already correct
for this hostname.

```conf
external-ip=203.0.113.10                 # your public IP, from before
static-auth-secret=4f3c8a91be2d47a6...   # the string from step 4
```

If your provider gives the machine a **private** address and NATs it (AWS, GCP,
Oracle Cloud), use both, public first:

```conf
external-ip=203.0.113.10/10.0.0.5
```

Check which you have:

```bash
ip -4 addr show | grep inet
```

An address starting `10.`, `172.16-31.`, or `192.168.` is private, and you need
the two-part form.

Save with `ctrl+o`, `enter`, `ctrl+x`.

---

## 6. Start it

```bash
sudo systemctl restart coturn
sudo systemctl status coturn
```

Look for `active (running)`. If it is not:

```bash
sudo journalctl -u coturn -n 50 --no-pager
```

Confirm it is listening:

```bash
sudo ss -lnup | grep 3478
sudo ss -lntp | grep -E '3478|5349'
```

You want 3478 on both UDP and TCP, and 5349 on TCP. **5349 missing is the
certificate permissions from step 3.**

---

## 7. Tell Vercel

In the Vercel dashboard: your project, **Settings**, **Environment Variables**.
Add both, for Production, Preview and Development:

| Name | Value |
| --- | --- |
| `TURN_SECRET` | the string from step 4, exactly |
| `TURN_HOST` | `turn.cue.uwuapps.org` |

Then **redeploy**. Environment variables are read at deploy time, so an
existing deployment keeps the old, empty ones and nothing changes until you do.

Deployments, the most recent one, the menu on the right, Redeploy.

---

## 8. Check it, in three stages

Each one narrows down where a fault is, so do them in order.

### The endpoint answers

```bash
curl -s https://cue.uwuapps.org/api/turn-credentials | python3 -m json.tool
```

```json
{
  "ok": true,
  "data": {
    "iceServers": [ ... ],
    "relay": true,
    "expiresAt": 1789859999
  }
}
```

`"relay": false` means the environment variables are missing or the redeploy
has not happened. Nothing below will work until this says `true`.

### The relay actually relays

The one that matters, and the only check that proves the VPS is reachable from
the outside. Copy the `username` and `credential` from that curl, then open
[Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/):

1. Remove the default STUN server from the list.
2. Add: `turn:turn.cue.uwuapps.org:3478?transport=udp`, with the username and
   credential you copied.
3. **Gather candidates**.

You are looking for a row whose Type is **`relay`**.

| What you see | What it means |
| --- | --- |
| a `relay` row | it works, go to the next stage |
| only `host` and `srflx` | the relay is unreachable: firewall, or `external-ip` is wrong |
| nothing at all, or an error | the credential is wrong, or coturn is not running |

Credentials expire after an hour. If this fails, re-run the curl for fresh ones
before assuming anything is broken.

### The real test

Prompter on the laptop, remote on the phone **on mobile data, not the wifi**.
That is the case this entire directory exists for, and the only one that proves
it end to end.

Watch it happen while you try, from a tmux pane:

```bash
sudo journalctl -u coturn -f
```

A successful relay logs an allocation with the username in it.

---

## Keeping it running

### It survives reboots already

`setup.sh` ran `systemctl enable coturn`, so it starts itself. Confirm:

```bash
systemctl is-enabled coturn
```

It should say `enabled`.

### Certificate renewal

certbot renews automatically, but **coturn keeps holding the old certificate**
until it is restarted, so it fails about ninety days after setup. Add a hook:

```bash
sudo mkdir -p /etc/letsencrypt/renewal-hooks/deploy
sudo tee /etc/letsencrypt/renewal-hooks/deploy/coturn.sh >/dev/null <<'EOF'
#!/bin/sh
chgrp -R ssl-cert /etc/letsencrypt/live /etc/letsencrypt/archive
chmod -R g+rX /etc/letsencrypt/live /etc/letsencrypt/archive
systemctl restart coturn
EOF
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/coturn.sh
```

Test it without waiting ninety days:

```bash
sudo certbot renew --dry-run
```

### Rotating the secret

If the secret is ever exposed, change it in `/etc/turnserver.conf`, restart
coturn, update `TURN_SECRET` in Vercel, and redeploy. Credentials already
issued stop working immediately, which is the point.

---

## Common problems

**`relay: false` from the endpoint.**
The variables are unset in Vercel, or the project has not been redeployed since
they were set. Redeploying is the step people miss.

**Trickle ICE shows no relay row.**
Three usual causes, in order of likelihood: the provider's own firewall in
their control panel; `external-ip` set to a private address; the UDP relay
range 49160-49200 not open.

```bash
sudo ss -lnup | grep 3478       # is it listening?
curl -4 ifconfig.me             # does this match external-ip?
```

**coturn logs `check_stun_auth: Cannot find credentials`.**
The secret in `/etc/turnserver.conf` and `TURN_SECRET` in Vercel differ. A
trailing space or newline counts as different.

**5349 is not listening, 3478 is.**
The certificate permissions in step 3. `journalctl -u coturn` will have a line
about not being able to read the key.

**It worked, then stopped about three months later.**
The certificate renewed and coturn was not restarted. The hook above prevents
it.

**Still only works on one network.**
Check in this order: does the endpoint say `relay: true`; does Trickle ICE show
a `relay` row; does `journalctl -u coturn -f` show anything at all while the
phone tries to pair. The first of those three that fails is where the problem
is.
