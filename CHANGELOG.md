# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [2026-03-07] - Remediation Wave

### Added
- Oracle request correlation via `x-request-id` middleware and response propagation.
- Prometheus-style `/metrics` endpoints for Oracle and NanoClaw.
- Decay edge-case tests for extreme dormancy and reinforcement behavior.
- Thai quickstart translation at `docs/th/QUICKSTART_TH.md`.
- Repository `CONTRIBUTING.md` and docs language policy.

### Changed
- Oracle HTTP middleware now enforces request ID propagation and route metrics collection.
- NanoClaw Oracle calls now attach `x-request-id` headers.
- Legacy Oracle assets moved to `oracle-v2/src/legacy/`.

### Fixed
- Removed remaining silent catch in WhatsApp availability presence update.
- Improved non-fatal logging visibility in dashboard handlers and auth cleanup paths.
