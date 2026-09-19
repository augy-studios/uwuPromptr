# TURN server

A [coturn](https://github.com/coturn/coturn) relay on a Debian VPS, so the
remote control pairs across networks.

Not part of the deployed site. `main-site/` goes to Vercel; this goes on a
machine you run.

## Why this exists

The remote is peer to peer. Two devices on one wifi find each other directly
and none of this is needed, which is why testing on a single network looks
like everything works.

Across two networks it usually fails. A mobile carrier puts a phone behind a
**symmetric NAT**, which assigns a different external port per destination, so
the address STUN reports is already wrong by the time the other end tries it.
There is no error to see: the data channel simply never opens. A prompter on
ethernet and a remote on 5G is exactly that case.

TURN is the only fix. Instead of the two devices reaching each other, both
connect out to a relay, and it passes the traffic along. That needs a server
with a public address, which is what this is. PeerJS's free cloud provides
signalling and STUN but **no TURN**, which is why one has to be run.

Vercel cannot host it: TURN relays raw UDP over a range of ports and needs a
long-lived process, and a serverless function is a short-lived HTTP handler.

## What talks to what

```text
  phone on 5G                            laptop on ethernet
       |                                         |
       |  1. both fetch short-lived credentials  |
       +----------> cue.uwuapps.org/api/turn-credentials <------+
       |                                         |
       |  2. both register with the PeerJS broker (signalling)  |
       |                                         |
       +--------> 3. media relayed through <-----+
                     turn.cue.uwuapps.org:3478
                     (this VPS, coturn)
```

The long-lived secret is shared between coturn and the Vercel function only.
The function signs credentials that expire within the hour, so what a reader
can pull out of devtools stops working by itself. A fixed username and
password in the client would hand the relay to anyone who read the page.

## Setting it up

You need a VPS with a public IP and a hostname pointing at it, for example
`turn.cue.uwuapps.org`.

```bash
git clone https://github.com/augy-studios/uwuPromptr.git
cd uwuPromptr/turn-server
sudo bash setup.sh
```

`setup.sh` is a convenience for the install only, and it is not required: it
runs `apt install coturn`, copies `turnserver.conf` to `/etc/turnserver.conf`,
sets `TURNSERVER_ENABLED=1` in `/etc/default/coturn`, opens the ports in `ufw`,
and enables the service. [SETUP-VPS.md](SETUP-VPS.md) spells out each of those
as its own command if you would rather type them.

It stops short of starting anything, because two lines need editing first:

| Line | What to put |
| --- | --- |
| `external-ip` | the VPS's public IP, from `curl -4 ifconfig.me` |
| `static-auth-secret` | `openssl rand -hex 32` |

The `realm` and the certificate paths are already set to
`turn.cue.uwuapps.org`.

For the certificate, if there is not one already:

```bash
sudo apt install certbot
sudo certbot certonly --standalone -d turn.cue.uwuapps.org
```

Then:

```bash
sudo systemctl restart coturn
sudo systemctl status coturn
```

### The Vercel side

Project, Settings, Environment Variables. See `main-site/.env.example`.

| Name | Value |
| --- | --- |
| `TURN_SECRET` | the same string as `static-auth-secret` |
| `TURN_HOST` | the realm hostname |

Redeploy afterwards, or the function keeps the old environment.

## Running it by hand, under tmux

There is no run script here on purpose: it is one command, and wrapping it
would only hide which flags are in play.

The two ways do not conflict, and the service is the better default:
`systemctl enable coturn` brings it back after a reboot, which a tmux session
does not.

**To watch it while the service runs it**, which is what you want most of the
time:

```bash
tmux new -s turn
journalctl -u coturn -f
```

**To run it in the foreground yourself**, for changing the config and seeing
immediately what happens, stop the service first or the two will fight over
port 3478:

```bash
sudo systemctl stop coturn
tmux new -s turn
sudo turnserver -c /etc/turnserver.conf -v
```

`-v` names every allocation and every refused credential, which is the whole
reason to run it this way. `-V` is heavier still if `-v` is not saying enough.

Detach with `ctrl+b d`, come back with `tmux attach -t turn`, stop it with
`ctrl+c`.

**Hand it back to the service when you are done**, or the relay is gone at the
next reboot:

```bash
sudo systemctl start coturn
```

Check which is in charge at any point:

```bash
systemctl is-active coturn     # active, or inactive if you are running it yourself
sudo ss -lnup | grep 3478      # something is listening either way
```

## Checking it works

Reading the config proves nothing. Two checks:

**1. The credentials endpoint.** From anywhere:

```bash
curl -s https://cue.uwuapps.org/api/turn-credentials | python3 -m json.tool
```

`relay` should be `true` and `iceServers` should hold a `turn:` entry. If
`relay` is `false`, the environment variables are missing or the deploy that
would pick them up has not happened.

**2. The relay itself**, which is the one that matters. Open
[Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/),
remove the default server, and add the `turn:` URL with the username and
credential from that curl. Press Gather candidates.

A line of type **`relay`** means it works. Only `host` and `srflx` lines means
the relay is not reachable: check the firewall, and that `external-ip` is the
address the internet sees rather than a private one.

Then the real check: the prompter on one network, the remote on another, on
mobile data rather than the same wifi. That is the case the whole thing exists
for, and it is the only one that proves it.

## When it goes wrong

- **`relay: false` from the endpoint.** `TURN_SECRET` or `TURN_HOST` is unset
  in Vercel, or the project has not been redeployed since they were set.
- **Trickle ICE shows no relay line.** The ports are closed, or `external-ip`
  is wrong. `sudo ss -lnup | grep 3478` shows whether coturn is listening at
  all.
- **coturn logs `check_stun_auth: Cannot find credentials`.** The secret in
  `/etc/turnserver.conf` and the one in Vercel do not match.
- **It worked and then stopped.** The certificate expired. `certbot renew`
  does not restart coturn on its own; add a deploy hook, or restart it after
  renewal.
- **Same network works, different networks do not, and there is no relay
  line.** That is the original bug, unfixed: nothing is using TURN yet.
