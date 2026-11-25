use std::fs;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::generation_error::GenerationError;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PemKind {
    PrivateKey,
    Csr,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SaveOutcome {
    Saved,
    Cancelled,
}

// El diálogo se abre desde Rust para que la ruta la elija la persona y nunca llegue
// desde el webview: un comando que escribiera en una ruta recibida sería un riesgo.
#[tauri::command(async)]
pub fn save_pem_file(
    app: AppHandle,
    kind: PemKind,
    file_name: String,
    contents: String,
) -> Result<SaveOutcome, GenerationError> {
    let (title, filter_name, extension) = match kind {
        PemKind::PrivateKey => ("Guardar la llave privada", "Llave privada (PEM)", "key"),
        PemKind::Csr => ("Guardar el CSR", "Solicitud de certificado (PEM)", "csr"),
    };

    let Some(selected) = app
        .dialog()
        .file()
        .set_title(title)
        .set_file_name(file_name)
        .add_filter(filter_name, &[extension])
        .blocking_save_file()
    else {
        return Ok(SaveOutcome::Cancelled);
    };

    let path =
        selected.into_path().map_err(|e| GenerationError::general(format!("La ruta elegida no es válida: {e}")))?;
    fs::write(&path, contents).map_err(|e| GenerationError::general(format!("No se pudo guardar el archivo: {e}")))?;

    Ok(SaveOutcome::Saved)
}
