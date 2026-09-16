# Dayframe architecture

## Product layers

1. **Shared interface** — the dependency-free `ui/` surface runs in the Windows and future iOS shells.
2. **Local-first store** — tasks and settings remain usable without an internet connection.
3. **Cloud account** — Supabase Auth and PostgreSQL synchronize user-owned records between devices.
4. **Windows attention agent** — Rust reads the foreground process and window title through Win32 APIs.
5. **iOS attention agent** — a Swift Tauri plugin will use Family Controls, Device Activity, and Managed Settings.

## Authority levels

| Level | Behavior |
| --- | --- |
| 0 — Observer | Reports planned versus actual time only. |
| 1 — Coach | Sends reminders and asks for intent. |
| 2 — Controller | Replans the day and escalates repeated distractions. |
| 3 — Strict | Adds hard friction and scheduled app shielding where the operating system permits it. |

## Attention guard sequence

1. A focus session begins for a task.
2. The client loads that task's required and blocked applications.
3. The native layer observes the foreground application locally; raw activity is not uploaded.
4. A blocked match produces a gentle notification.
5. A second match inside ten minutes produces a stronger warning.
6. A third match activates Intent Gate and brings Dayframe forward.
7. Only aggregate counts and focused duration are eligible for account sync.

## Privacy boundary

- Foreground window titles and executable paths stay on the device.
- Cloud sync stores tasks, milestones, preferences, session duration, and interruption counts.
- Credentials are stored with platform-secure storage in the production account implementation.
- The user can disable attention monitoring independently on each device.

## Next engineering milestones

1. Connect Supabase Auth and replace local-only persistence with an offline-first repository.
2. Add automatic schedule generation and deadline backplanning.
3. Run the Windows agent from the system tray and optionally at login.
4. Implement task-specific allowlists and browser URL detection through an optional extension.
5. Add the iOS native plugin and TestFlight build.

