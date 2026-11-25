# Girasol CSR Generator

App de escritorio (Tauri 2 + React) que genera la llave privada y el CSR para solicitar un certificado
de agente automatizado de FirmEasy. Todo ocurre en el equipo: no envía datos a ningún servidor.
Se distribuye por la Microsoft Store.

## Desarrollo

Requisitos: Node 24, pnpm 11, Rust 1.99 (MSVC). En Windows, el OpenSSL vendored necesita
[Strawberry Perl](https://strawberryperl.com/) primero en el `PATH` (el perl de Git Bash no sirve).

```sh
pnpm install
pnpm tauri dev
cd src-tauri && cargo test --release --lib
```

Las dependencias van en versión exacta, y pnpm solo instala versiones publicadas hace al menos
3 días (`minimumReleaseAge`).

## Publicar una versión

1. Agrega `## [X.Y.Z] - AAAA-MM-DD` a `CHANGELOG.md`. Esa sección se publica como "Novedades de
   esta versión" en la Store (máximo 1500 caracteres).
2. Sube `version` en `package.json`. Es la única fuente: `tauri.conf.json`, la página Acerca y el
   MSIX la leen de ahí.
3. Commit y push a `main`.
4. `git tag vX.Y.Z && git push origin vX.Y.Z`
5. Aprueba el deploy en Actions (environment `microsoft-store`).

El workflow `release-store.yml` compila, arma el MSIX y lo envía a certificación. Falla si el tag no
coincide con la versión o si falta la sección del CHANGELOG.

**No envíes nada desde Partner Center.** El paquete subido solo se procesa con el commit que hace
el CI; si envías el borrador desde Partner Center, se publica el paquete anterior.

Para probar el MSIX en local:

```powershell
pnpm tauri build --no-bundle
./src-tauri/msix/build-msix.ps1 -OutDir out/msix
```
