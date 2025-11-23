# Changelog

All notable changes to the `signalk-ntfy` plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.0.2] - 2025-11-04

### Fixed

- **WebSocket stability**: Fixed false inactivity detection by correctly counting `keepalive` messages from ntfy.sh as valid activity.
- **Message handling**: Ensure all plain-text and JSON messages are properly parsed and forwarded to SignalK paths.

### Changed

- **Conservative reconnect strategy for ntfy.sh**:  
  When using the public `ntfy.sh` server, WebSocket reconnection delay is now **10 minutes** (600,000 ms) to comply with service limits (~150 subscriptions/day) and prevent IP bans.
- **Local servers** retain fast reconnection (5 seconds) for responsive local networks.
- **Added protection** against infinite reconnection loops (max 5 attempts before temporary backoff).

### Added

- **Heartbeat monitor**: Automatically detects and recovers from silently broken WebSocket connections (common in NAT/firewall environments like marine networks).
- **Improved debug logging**: Clearer messages for connection state, reconnection attempts, and server detection.

### Security

- **Reduced risk of rate-limiting**: The new conservative strategy makes the plugin safe for long-term use with `ntfy.sh`, even on unstable connections (e.g., mobile or remote marine networks).

> 📌 **Recommendation**: Users of `ntfy.sh` are strongly encouraged to update to this version to avoid service disruption due to connection throttling.

## [0.0.1] - 2025-11-03

### Added

- Initial release of the `signalk-ntfy` plugin.
- Support for **basic mode**: automatic SignalK notification forwarding to ntfy topics.
- Support for **advanced mode**: bidirectional communication via WebSockets (commands and responses).
- Multi-server configuration (local + remote).
- REST API endpoint (`/send`) for custom notifications.
- Token-based authentication.
- Dynamic server switching via UI or API.
