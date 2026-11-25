# Seguridad

Si encuentras una vulnerabilidad, **no abras un issue público**. Repórtala en privado desde
[Security → Report a vulnerability](https://github.com/girasol-pki/csr-generator/security/advisories/new).

Incluye la versión de la app, los pasos para reproducirla y su impacto. Respondemos en un plazo de
5 días hábiles.

Solo recibe parches de seguridad la última versión publicada en la Microsoft Store.

## Alcance

- Generación de la llave privada y del CSR (incluida la generación en tokens PKCS#11).
- Manejo de archivos: guardado de la llave y el CSR.
- El pipeline de release (`.github/workflows`).
