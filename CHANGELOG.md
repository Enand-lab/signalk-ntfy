# Changelog

All notable changes to the `signalk-ntfy` plugin are documented in this file.  
This project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) standards.

## [0.0.3] - 2025-11-25

### Fixed

- **WebSocket instability**: implemented client-side `ping` and unified topic subscription to prevent disconnections in NAT/firewall environments (e.g., marine networks).
- **Risk of rate-limiting on `ntfy.sh`**: reduced subscription count by 50% by using a single WebSocket connection for both command and response topics.

### Changed

- **Exponential backoff**: reconnection delays now follow `[5, 10, 15, 20, 30, 45, 60, 120]` seconds to avoid overwhelming the server during outages.
- **Inactivity timeout**: increased from 60 seconds to 300 seconds (5 minutes) to align with real-world `ntfy.sh` behaviour and prevent premature reconnection.

### Added

- **Full compatibility** with existing configurations — no changes required in UI or `package.json` beyond version bump.
- **Robust connection management** inspired by the official ntfy Android client.

> 💡 **Recommendation**: Users of `ntfy.sh` are strongly encouraged to update to this version to avoid service disruption due to connection throttling.

## [0.0.2] - 2025-11-04

### Changed

- Introduced conservative reconnection strategy for `ntfy.sh` (10-minute delay) to comply with public server limits.
- Added protection against infinite reconnection loops (max 5 attempts).

## [0.0.1] - 2025-11-03

### Added

- Initial release: basic and advanced modes, REST API, WebSocket bidirectional communication, multi-server support.
