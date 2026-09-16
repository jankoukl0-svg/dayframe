# Dayframe Native

Dayframe is a local-first productivity app for Windows with a shared path to iOS. It combines a daily countdown, time-blocked tasks, milestone backplanning, focus sessions, and an attention guard that reacts when the user opens a distracting app.

## Current native MVP

- Runs as a standalone Tauri 2 desktop application; no browser or ChatGPT URL is required.
- Recreates the Dayframe dashboard with the Czech study schedule.
- Stores tasks, settings, milestones, and completed state locally on the device.
- Polls the foreground Windows process and window title during a focus session.
- Sends native notifications after a distracting app is detected.
- Escalates from a reminder to a stronger warning and then brings Dayframe back to the foreground.
- Includes a GitHub Actions workflow that produces Windows MSI and NSIS installers.
- Includes the database schema planned for cross-device account sync.

## Build the Windows installer

The easiest reproducible route is GitHub Actions:

1. Create an empty GitHub repository and upload this project.
2. Open **Actions → Build Windows installer → Run workflow**.
3. Download the `dayframe-windows-installers` artifact after the build finishes.
4. It contains the `.msi` and NSIS `.exe` installers.

For a local Windows build, install Rust and the Tauri prerequisites, then run:

```powershell
cargo install tauri-cli --version "^2" --locked
cargo tauri icon ui/icon.svg
cargo tauri build --bundles msi,nsis
```

## Development

```powershell
cargo install tauri-cli --version "^2" --locked
cargo tauri dev
```

The frontend is intentionally dependency-free HTML, CSS, and JavaScript. The Windows system integration is implemented in Rust under `src-tauri/src`.

## Cross-device account sync

`supabase/schema.sql` defines the initial user-owned data model and row-level security. The next implementation step is to connect the app to a Supabase project and add email/Apple sign-in. Local storage remains the offline cache.

## iOS path

Tauri 2 reuses the same interface on iOS. The attention guard must use an iOS-specific Swift plugin backed by Family Controls, Device Activity, and Managed Settings. TestFlight/App Store distribution requires macOS, Apple code signing, and the relevant Apple entitlement.

