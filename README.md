# SignalK ntfy Notifications Plugin

Reliable push notifications and bidirectional communication for your boat: from automatic SignalK alerts to interactive mobile controls.

## What does this plugin do?

This plugin offers two levels of integration between your SignalK server and [ntfy](https://ntfy.sh):

- Basic Mode (ready to use):  
  Automatically sends SignalK alerts (alarm, warn, etc.) to an ntfy topic of your choice.  
  You only need to:  
  - Create a topic (on ntfy.sh or your local server),  
  - Install the free ntfy mobile app (no account required),  
  - Enable the plugin and select your alert levels.  
  That’s it! If you just want reliable boat notifications on your phone — even when offline onboard — you already have a complete solution.

- Advanced Mode (requires additional setup):  
  Enables bidirectional communication:  
  - Send custom notifications with interactive buttons ("Ok"/"Cancel").  
  - Listen to two configurable ntfy topics: one for commands and one for responses.  
  - Publish any received messages to two predefined SignalK paths:  
    - communications.ntfy.commands  
    - communications.ntfy.responses  

This second level does not include processing logic: the plugin acts only as a bridge. You decide what to do with those messages (via Node-RED, scripts, another plugin, etc.).

### What this plugin does NOT do

- It does not interpret or execute the commands it receives. It only publishes them in SignalK for other tools to handle.  
- It does not configure your mobile devices. You choose how to send commands to your server (e.g., with HTTP Shortcuts, the ntfy app itself, or any HTTP client).  
- It does not manage security beyond what ntfy and SignalK already provide. The responsibility for using secure topic names, tokens, and best practices rests entirely with you.

### In summary

- Just want automatic notifications? → Install, set your topic, and you’re done.  
- Want interactive control from your phone? → The plugin gives you the channels; you build the logic on top.


---

## Why ntfy (pronounced "notify")?

ntfy is a lightweight, secure, self-hostable, and dependency-free alternative to services like Telegram or Pushover:

| Feature               | ntfy                              | Common Alternatives        |
|-----------------------|-----------------------------------|----------------------------|
| Self-hostable         |  Yes (100% offline possible)    |  Usually not             |
| No account required   |  Use topics like “passwords”    |  Registration required   |
| Bidirectional         |  WebSockets + interactive buttons | Limited or non-native  |
| Open Source           |  Apache 2.0 / GPLv2             |  Closed or partial       |
| Network-friendly      |  Small messages, low bandwidth  | Often heavier           |

Ideal for marine environments: works on local networks, doesn’t rely on external services, and uses minimal resources.

---

## Two usage modes

The plugin is designed for all skill levels:

### 1. Basic Mode – Automatic notifications (ready in 2 minutes!)

Perfect for receiving SignalK alerts (alarm, warn, etc.) on your mobile device with minimal setup.  
You only need:  
- A topic on ntfy.sh (or your local server)  
- Enable the plugin and select alert levels  
- The ntfy mobile app

#### Anti-Spam Filtering (v0.0.8+)

High-frequency SignalK paths - an anchor alarm republishing the same state at 1 Hz, for example - can flood your phone. The plugin can throttle them, keeping at most one notification per path and cooldown:

- **Filter duplicate notifications**: off by default. When off, every delta that passes the level filter is sent, exactly as in previous versions.
- **Minimum interval (minutes)**: cooldown for each SignalK path (default: 5 minutes).

With the filter enabled, a notification for a given path is sent when:

1. the **state changes** from the last state sent for that path (for example `alert` to `alarm`, or back to `normal`), or
2. at least **minIntervalMinutes** have elapsed since the last notification sent for that path.

Everything else is dropped locally, before the HTTP request, so nothing reaches ntfy or your phone.

**Safety rule: a severity escalation is never silenced.** Severity order is `normal` < `alert` < `warn` < `alarm` < `emergency`. If the new state is more severe than the last one sent, the notification goes out immediately, even if that path is still inside its cooldown.

The registry lives in memory, keyed by SignalK path; entries older than 24 hours are discarded, and a failed delivery does not consume the cooldown (the next delta for that path is tried again).

Example use case:  
“Engine overheating” → Instant push notification on your phone.

#### Delivery retries (v0.0.9+)

A notification used to be lost for good if the HTTP request to ntfy failed. Now a failed delivery is retried after **5, 15 and 45 seconds** (about 65 seconds in total); if every attempt fails, a final error is logged.

Only failures that can heal on their own are retried:

| Failure                                        | Retried |
|------------------------------------------------|---------|
| Network error, DNS failure, connection reset    | Yes     |
| Request timeout                                 | Yes     |
| HTTP 5xx (server error)                         | Yes     |
| HTTP 429 (rate limited)                         | Yes     |
| HTTP 4xx (401, 403...)                          | No — a rejected token or topic is a configuration problem, not a transient one |

Every request also carries a **10-second timeout**: a server that accepts the connection and never answers no longer leaves the delivery hanging. It fails and enters the retry queue like any other network failure.

The queue is keyed by Signal K path: a **new notification for the same path replaces the pending retry** for that path, so a producer that repeats every few seconds during an outage does not pile up stale messages — only the latest one is delivered.

With `filterDuplicates` enabled, the per-path mark only counts once the delivery succeeds: if all retries are exhausted, the mark is rolled back and the next notification for that path is not silenced.

Retries apply to the automatic notifications from `notifications.*`. The `POST /plugins/signalk-ntfy/send` API endpoint stays a **single attempt**: it returns the error to the caller instead of retrying in the background, so the client keeps control of its own retries.

#### Click URL per notification path (`clickUrls`)

Tapping a notification normally opens the ntfy app and nothing else. `clickUrls` maps notification paths to a URL that opens instead — the anchor alarm webapp, a dashboard, a camera page. It is an array of `pathPrefix` / `url` pairs, empty by default, so an installation that does not use it behaves exactly as before.

- The prefix may be written with or without the leading `notifications.`: `navigation.anchor` becomes `notifications.navigation.anchor`.
- Matching is by **whole path segments**: a prefix matches when the path is equal to it or continues with a dot, so `notifications.navigation.anchor` matches `notifications.navigation.anchor` and `notifications.navigation.anchor.drag`, but not `notifications.navigation.anchorage`.
- The **longest matching prefix wins**. A prefix of `*` (or an empty prefix) is a catch-all, used only when no specific prefix matches.
- No match, no click: the notification opens the ntfy app as before.
- The URL must start with `http://` or `https://`, and has to be reachable from the phone (a VPN or a public hostname — the plugin cannot derive it). A trailing slash is trimmed. An entry with a missing or non-http(s) URL is reported in the log at startup and ignored; the plugin keeps running.

Example:

| Path prefix | URL |
|---|---|
| `notifications.navigation.anchor` | `https://signalk.example/hoekens-anchor-alarm` |
| `*` | `https://signalk.example/dashboard` |

Notifications sent through `POST /plugins/signalk-ntfy/send` accept an explicit `click` field in the body, for messages that do not come from a `notifications.*` path.

#### Notify when an alert clears (`notifyOnClear`)

Off by default. With it on, the plugin remembers every path it has forwarded and, when that same path arrives again as `normal` or as `null` (the producer removed the notification), sends one **`CLEARED: <path words>`** notification and forgets the path. Alerts that were never forwarded produce nothing, which is why this is quieter than adding `normal` to the alert levels.

- The registry lives in memory, keyed by path, and entries expire after 24 hours like the duplicate filter. It is filled when the notification is queued, not when the delivery is confirmed.
- A clear also resets the duplicate filter entry for that path, so a new alarm on the same path goes out immediately.
- The message is the one carried by the notification; `Back to normal` when it has none.
- Priority comes from the server `priorityMap` for `normal` (2 by default), so the all-clear does not break through focus modes.
- A value that is `normal` never follows the normal delivery path, even if `normal` is listed in the alert levels: with this option off it sends nothing, and with it on it only sends the clear of a path that was forwarded.
- `titlePrefix` applies to the clear title too.
- This version sends a **new message**: it does not use ntfy's `sequence_id` / `message_clear` to update or dismiss the original notification.

### 2. Advanced Mode – Bidirectional communication

This is the plugin’s core functionality.  
Send commands from your phone (e.g., restart a server or turn off lights) and receive confirmations or responses in SignalK.

Key features:

- Send custom notifications via REST API (POST /send)  
- Interactive buttons with HTTP actions ("Ok"/"Cancel")  
- Receive responses under communications.ntfy.responses  
- Native integration with Node-RED, HTTP Shortcuts, etc.  
- Automatic server switching (local <--> ntfy.sh) based on WiFi presence

Example use case:  
Notification: “Reboot RPi4?” → User taps "OK" -> Command executed via SSH -> Confirmation received in SignalK.  
Ideal for embedded control systems where secure, app-free interaction is essential.

---

## Mobile app required

To receive push notifications on your phone, you’ll need the official ntfy app:  
- [Android (Google Play)](https://play.google.com/store/apps/details?id=io.heckel.ntfy)  
- [Android (F-Droid)](https://f-droid.org/packages/io.heckel.ntfy/)  
- [iOS (App Store)](https://apps.apple.com/us/app/ntfy/id1625396347)  

The app runs in the background, listens to your topics, and delivers instant, reliable notifications — even when your phone is idle. No account needed.

---

## Responsible use: respect ntfy.sh limits

If you use the public ntfy.sh service, please respect its [free-tier limits](https://docs.ntfy.sh/config/#general-limits):  
- ~250 messages/day  
- ~150 subscriptions/day  
- All topics are public: anyone can read or write to them.

### Important: On ntfy.sh, tokens do not restrict access to topics.

The public server runs in open mode (auth-default-access: read-write for everyone), meaning anyone who knows your topic name can both read and publish to it, even without a token.

The only effective protection on ntfy.sh is to:  
- Use long, random, hard-to-guess topic names (treat the topic name like a password).  
- Never reuse common names like boat, alerts, or commands.

If you need true topic privacy, authenticated publishing, or reserved names:  
- Self-host your own ntfy server with ACLs enabled, or  
- Use a [paid ntfy.sh plan](https://ntfy.sh/#pricing) (which allows topic reservation, though still no ACL-based write protection).

---

## Best practices for marine use

For typical boating scenarios, you don’t need enterprise-grade security — but you do need sensible naming:  
- Use long, random topic names (e.g., boat_alerts_aB3xK9mQ2p, commands_rZ7wL4vN8s).  
- ntfy allows letters (A–Z, a–z), digits (0–9), and underscores (_).  
- Avoid dictionary words or boat names like myyacht or sailboat123.  
- Separate topics by function:  
  - One for outgoing alerts (lower risk).  
  - One for responses (medium risk).  
  - One dedicated, highly random topic for commands (highest risk).  
- Use tokens only if you self-host ntfy or have a paid ntfy.sh plan — they prevent unauthorized publishing in those setups.  
- On the free public server, tokens have no effect; security relies entirely on unpredictable topic names.

> Important: The commandsTopic is the most sensitive — it can trigger actions on your boat (reboots, power switches, etc.). Always use a long, random name and combine it with a token if using self-host.

## Is this “secure enough”?

For most boaters, yes:  
- Brute-forcing a 12-character random topic would take centuries, even without rate limits.  
- ntfy.sh applies strict rate limiting (60 requests burst, then 1/10s) and IP bans via fail2ban.  
- On a local network, topics are only exposed to devices on your boat — no internet exposure.

If you need full ACLs, authentication, or TLS isolation, self-host ntfy on your Raspberry Pi or PC and disable public access.

---

## Local network setup (important!)

**Never use localhost** in your server URL if you interact from mobile devices.  
Your phone interprets localhost as itself — not your SignalK server.

---

## Self-hosted ntfy (optional)

Running ntfy on board keeps alerts working with no internet, and keeps your topics private to your own network. Minimal `docker-compose.yml`:

```yaml
services:
  ntfy:
    image: binwiederhier/ntfy
    container_name: ntfy
    command: serve
    restart: unless-stopped
    ports:
      - "8081:80"
    volumes:
      - ./ntfy-cache:/var/cache/ntfy
      - ./ntfy-config:/etc/ntfy
    environment:
      - TZ=UTC
```

Start it with `docker compose up -d` and point the plugin at `http://<server-ip>:8081` - never `localhost`, as explained above. Drop a `server.yml` into `./ntfy-config` if you want authentication, ACLs or a base URL; without it the server runs in open mode, so use long random topic names.

### Signal K running in a container

If Signal K runs inside a container, `localhost` / `127.0.0.1` there means the container itself, not the host, so the ntfy container is unreachable at that address. Use the host gateway name instead:

- **Podman**: `host.containers.internal`
- **Docker**: `host.docker.internal` (on Linux, add `extra_hosts: ["host.docker.internal:host-gateway"]` to the Signal K service)

The server URL then looks like `http://host.containers.internal:8081`. The same rule applies to your phone: use the host LAN IP, never `localhost`.

---

## Installation & Requirements

- SignalK server
- Access to ntfy (public or self-hosted)

---

## Documentation

See the plugin’s built-in documentation for:  
- Step-by-step configuration (basic → advanced)  
- Ready-to-use Node-RED subflows  
- Troubleshooting common issues  
- REST API integration examples

---

## SignalK Paths & API Endpoints

The plugin creates the following SignalK data paths and REST API endpoints to enable full integration:

###  SignalK Data Paths

- communications.ntfy.settings.activeServer (always available)  
  String indicating the ID of the currently active ntfy server (e.g., "local" or "ntfysh"). Updated on startup and every 30 seconds.

- communications.ntfy.responses (advanced mode only)  
  Received ntfy interactive button responses (e.g., user taps "Ok" or "Cancel") appear here as SignalK deltas.

- communications.ntfy.commands (advanced mode only)  
  Custom commands sent via ntfy (e.g., "action:reboot,value:true") are published here for consumption by Node-RED, other plugins, or automation logic.

These paths allow seamless integration with SignalK-compatible tools without polling or external dependencies.

###  REST API Endpoints

The plugin exposes the following endpoints under SignalK’s plugin router (/plugins/signalk-ntfy):

- **POST /plugins/signalk-ntfy/send**
  Send a custom notification to the configured ntfy server.  
  You may optionally override the default topic in the request body (useful for dynamic routing).  
  > Note: Responses from interactive buttons will always be published to the configured responsesTopic (communications.ntfy.responses), regardless of the topic used in the original message.

Example request:
```
{
    "title": "Cabin Lights Control",
    "message": "Turn off cabin lights?",
    "topic": "boat_alerts",
    "actions": [
      {
        "action": "broadcast",
        "label": "Yes",
        "message": "action:lights_off,value:true",
        "actionId": "cabin_lights_123"
      },
      {
        "action": "broadcast",
        "label": "No",
        "message": "action:lights_off,value:false",
        "actionId": "cabin_lights_123"
      }
    ]
  }

```
- **GET /plugins/signalk-ntfy/status**  
  Returns the current status of the pluExample response:ponse:

```
{
    "status": "active",
    "plugin": "signalk-ntfy",
    "configured": true,
    "ntfyUrl": "https://ntfy.sh",
    "defaultTopic": "boat_alerts",
    "timestamp": "2025-11-04T12:00:00.000Z"
  }
```
- **PUT /plugins/signalk-ntfy/settings/server**  
  Dynamically switch the active ntfy server and persist the selection. Restarts listeners if advanced mode is Example request:e request:

```
{
    "serverId": "local"
  }
```
**Example successful response:**

```
{
    "status": "updated",
    "activeServer": "local",
    "persistent": true,
    "listenersRestarted": true,
    "timestamp": "2025-11-04T12:00:00.000Z"
  }
```
For full request/response schemas and validation rules, see the included openApi.json file.

---

## License

**License:** Apache-2.0

Special thanks to an anonymous technical collaborator whose guidance significantly improved the design and robustness of this plugin.
Thanks to the SignalK community and ntfy.sh for building reliable, open tools.  
This plugin is not affiliated with ntfy.sh or SignalK. Use at your own risk and in compliance with services.


Example: Notification with confirmation

```
{
  "title": "Cabin Lights Control",
  "message": "Turn off cabin lights?",
  "actions": [
    {
      "action": "broadcast","label": "Yes",
      "message": "action:lights_off,value:true",
      "actionId": "cabin_lights_123"
    },
    {
      "action": "broadcast",
      "label": "No",
      "message": "action:lights_off,value:false",
      "actionId": "cabin_lights_123"
    }
  ]
}
```

