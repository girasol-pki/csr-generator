mod commands;
mod generation_error;
mod pkcs11;
mod save_pem;
mod subject;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::generate_csr,
            pkcs11::list_pkcs11_slots,
            pkcs11::generate_csr_pkcs11,
            save_pem::save_pem_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
