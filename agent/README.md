# HelixConnect agent

For a host HelixConnect can't reach directly — a laptop behind NAT, a
workstation with no inbound RDP/VNC/SSH port opened in its firewall. Instead
of HelixConnect dialing in, this small script dials **out** to your
HelixConnect server and waits for it to ask for a remote-desktop tunnel.
Nothing needs to be opened inbound on the agent's machine.

It talks to the exact same `guacd` relay every other HelixConnect
connection uses — from guacd's point of view, an agent-backed connection
looks identical to a directly-reachable one. The agent is just a relay for
the bytes.

## 1. Create the agent in HelixConnect

In the admin console, go to **Agents** → **Enroll new agent**, give it a
name (e.g. the machine's hostname), and HelixConnect will show you:

- a server URL (`HELIX_SERVER`)
- an agent id (`HELIX_AGENT_ID`)
- a one-time enrollment token (`HELIX_ENROLL_TOKEN`) — valid for 30 minutes,
  and only usable once. If it expires or gets used already, enroll again
  for a fresh one.

## 2. Install and run on the target machine

Requires [Node.js](https://nodejs.org) 18 or newer.

```bat
cd agent
npm install

set HELIX_SERVER=wss://your-helix-server.example.com
set HELIX_AGENT_ID=agent-xxxxxxxx
set HELIX_ENROLL_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

node windows-agent.js
```

On success you'll see `enrolled — secret saved to ...agent-config.json`.
The agent should now show **online** on the Agents tab. From then on you
only need `HELIX_SERVER` and `HELIX_AGENT_ID` — the saved secret in
`agent-config.json` takes care of authenticating; `HELIX_ENROLL_TOKEN`
isn't needed again (and is ignored if left set).

**Keep `agent-config.json` private** — it holds this agent's persistent
credential. It's created next to `windows-agent.js` by default; point
`HELIX_AGENT_CONFIG` at a different path if you'd rather keep it elsewhere.

## 3. Point a connection at it

Back in the admin console, when adding or editing a host, choose transport
**Agent** instead of **Direct**, pick this agent from the list, and set the
local port to relay (3389 for RDP, 5900 for VNC, 22 for SSH — whatever the
real service on that machine is listening on). Operators then open a session
exactly like any other host.

## Running it as a Windows service

Running `node windows-agent.js` in a terminal only lasts as long as that
terminal is open. To have it start automatically and survive logoff/reboot,
either:

- **NSSM** (simplest): [download NSSM](https://nssm.cc/), then
  ```bat
  nssm install HelixConnectAgent "C:\Program Files\nodejs\node.exe" "C:\path\to\agent\windows-agent.js"
  nssm set HelixConnectAgent AppEnvironmentExtra HELIX_SERVER=wss://your-helix-server.example.com HELIX_AGENT_ID=agent-xxxxxxxx
  nssm start HelixConnectAgent
  ```
  (Enroll once interactively first with `HELIX_ENROLL_TOKEN` set, so
  `agent-config.json` already has a secret before the service starts — a
  service account usually isn't a great place to type a one-time token.)

- **node-windows**: `npm install -g node-windows`, then use its
  [service installer API](https://github.com/coreybutler/node-windows) to
  wrap `windows-agent.js`.

## Troubleshooting

- `no saved secret ... and no HELIX_ENROLL_TOKEN set` — either set
  `HELIX_ENROLL_TOKEN` (first run) or confirm `agent-config.json` exists
  and matches this `HELIX_AGENT_ID`.
- Control connection keeps closing and retrying — check `HELIX_SERVER` is
  reachable from this machine (it's the agent dialing out, so this
  machine's own network/proxy rules are what matter, not the target's).
- A session opens in HelixConnect but the screen never loads — check that
  the configured local port is actually the right one for this host's
  RDP/VNC/SSH service, and that nothing on this machine (a personal
  firewall, antivirus) blocks a loopback connection to it.
