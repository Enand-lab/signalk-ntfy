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

Example use case:  
“Engine overheating” → Instant push notification on your phone.

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

