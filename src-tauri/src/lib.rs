use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveApp {
    process_name: String,
    executable_path: String,
    window_title: String,
}

#[tauri::command]
fn get_active_app() -> ActiveApp {
    platform_active_app()
}

#[tauri::command]
fn notify_guard(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn bring_dayframe_forward(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is unavailable".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    let _ = window.unminimize();
    window.set_focus().map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn platform_active_app() -> ActiveApp {
    use std::path::Path;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return empty_active_app();
        }

        let title_length = GetWindowTextLengthW(hwnd);
        let mut title_buffer = vec![0_u16; (title_length.max(0) + 1) as usize];
        let copied = GetWindowTextW(hwnd, title_buffer.as_mut_ptr(), title_buffer.len() as i32);
        let window_title = if copied > 0 {
            String::from_utf16_lossy(&title_buffer[..copied as usize])
        } else {
            String::new()
        };

        let mut process_id = 0_u32;
        GetWindowThreadProcessId(hwnd, &mut process_id);
        if process_id == 0 {
            return ActiveApp { process_name: String::new(), executable_path: String::new(), window_title };
        }

        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
        if process.is_null() {
            return ActiveApp { process_name: String::new(), executable_path: String::new(), window_title };
        }

        let mut path_buffer = vec![0_u16; 32_768];
        let mut path_length = path_buffer.len() as u32;
        let query_ok = QueryFullProcessImageNameW(
            process,
            0,
            path_buffer.as_mut_ptr(),
            &mut path_length,
        );
        let _ = CloseHandle(process);

        let executable_path = if query_ok != 0 {
            String::from_utf16_lossy(&path_buffer[..path_length as usize])
        } else {
            String::new()
        };
        let process_name = Path::new(&executable_path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string();

        ActiveApp { process_name, executable_path, window_title }
    }
}

#[cfg(not(target_os = "windows"))]
fn platform_active_app() -> ActiveApp {
    empty_active_app()
}

fn empty_active_app() -> ActiveApp {
    ActiveApp {
        process_name: String::new(),
        executable_path: String::new(),
        window_title: String::new(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_active_app,
            notify_guard,
            bring_dayframe_forward
        ])
        .run(tauri::generate_context!())
        .expect("error while running Dayframe");
}

