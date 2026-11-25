# CLAUDE.md

Desarrollo y release: ver `README.md`.

- pnpm, nunca npm. Versiones exactas en `package.json` y `Cargo.toml`.
- La versión de la app vive solo en `package.json`.
- Release: seguir los pasos del README. Nunca enviar el borrador desde Partner Center.
- `cargo` en Windows: correrlo desde PowerShell con Strawberry Perl primero en el `PATH`.
- Los límites de largo de los campos del DN (`src-tauri/src/subject.rs` y `GenerateCSRForm.tsx`) están
  acordados con la CA: no cambiarlos solo en un lado.
- Repo público: nada interno (clientes, IDs de cuentas, recordatorios) en commits, issues ni archivos.
  Las actions van fijadas por SHA y el job con secrets solo corre con tags `v*`.
