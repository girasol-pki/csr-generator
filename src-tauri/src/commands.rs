use openssl::{
    asn1::Asn1Type,
    base64,
    error::ErrorStack,
    hash::MessageDigest,
    nid::Nid,
    pkey::PKey,
    rsa::Rsa,
    x509::{X509NameBuilder, X509ReqBuilder},
};
use serde::{Deserialize, Serialize};

use crate::generation_error::{Field, GenerationError};
use crate::subject::Subject;

#[derive(Serialize)]
pub struct PrivateKeyWithCSR {
    base64_private_key_pem: String,
    base64_csr_pem: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CSRGenerationParams {
    country: String,
    state: String,
    locality: String,
    organization: String,
    organization_unit: String,
    street: String,
    email: String,
    common_name: String,
    modulus_length: Option<u32>,
}

impl CSRGenerationParams {
    fn subject(&self) -> Subject<'_> {
        Subject {
            country: &self.country,
            state: &self.state,
            locality: &self.locality,
            organization: &self.organization,
            organization_unit: &self.organization_unit,
            street: &self.street,
            email: &self.email,
            common_name: &self.common_name,
        }
    }
}

fn openssl_reason(stack: &ErrorStack) -> &str {
    stack
        .errors()
        .first()
        .and_then(|error| error.reason())
        .unwrap_or("error desconocido")
}

fn openssl_failure(message: &'static str) -> impl FnOnce(ErrorStack) -> GenerationError {
    move |stack| GenerationError::general(format!("{message}: {}", openssl_reason(&stack)))
}

#[tauri::command]
pub fn generate_csr(data: CSRGenerationParams) -> Result<PrivateKeyWithCSR, GenerationError> {
    data.subject().validate()?;

    let key_pair = Rsa::generate(data.modulus_length.unwrap_or(2048))
        .map_err(openssl_failure("No se pudo generar el par de claves"))?;
    let private_key =
        PKey::from_rsa(key_pair).map_err(openssl_failure("No se pudo extraer la private key"))?;

    let mut csr_builder =
        X509ReqBuilder::new().map_err(openssl_failure("No se pudo crear el generador de CSRs"))?;
    csr_builder
        .set_pubkey(&private_key)
        .map_err(openssl_failure("No se pudo asignar la llave pública al CSR"))?;

    let mut subject_name_builder = X509NameBuilder::new()
        .map_err(openssl_failure("No se pudo crear el generador de nombres"))?;

    // Con el tipo ASN.1 explícito OpenSSL no aplica las cotas X.520 (CN/O/OU 64), igual que
    // EJBCA, que tampoco las aplica. Los límites propios los impone Subject::validate.
    // Los tipos son los mismos que OpenSSL elegiría por defecto (string mask utf8only).
    let entries = [
        (Nid::COUNTRYNAME, Asn1Type::PRINTABLESTRING, Field::Country, &data.country, "el país"),
        (
            Nid::STATEORPROVINCENAME,
            Asn1Type::UTF8STRING,
            Field::State,
            &data.state,
            "la región y provincia",
        ),
        (Nid::LOCALITYNAME, Asn1Type::UTF8STRING, Field::Locality, &data.locality, "el distrito"),
        (
            Nid::ORGANIZATIONNAME,
            Asn1Type::UTF8STRING,
            Field::Organization,
            &data.organization,
            "la organización",
        ),
        (
            Nid::ORGANIZATIONALUNITNAME,
            Asn1Type::UTF8STRING,
            Field::OrganizationUnit,
            &data.organization_unit,
            "la unidad organizacional",
        ),
        (Nid::STREETADDRESS, Asn1Type::UTF8STRING, Field::Street, &data.street, "la dirección"),
        (Nid::PKCS9_EMAILADDRESS, Asn1Type::IA5STRING, Field::Email, &data.email, "el email"),
        (
            Nid::COMMONNAME,
            Asn1Type::UTF8STRING,
            Field::CommonName,
            &data.common_name,
            "el nombre común",
        ),
    ];
    for (nid, asn1_type, field, value, label) in entries {
        subject_name_builder
            .append_entry_by_nid_with_type(nid, value, asn1_type)
            .map_err(|stack| {
                GenerationError::field(
                    field,
                    format!("No se pudo agregar {label} al CSR: {}", openssl_reason(&stack)),
                )
            })?;
    }

    let subject_name = subject_name_builder.build();
    csr_builder
        .set_subject_name(&subject_name)
        .map_err(openssl_failure("No se pudo agregar el nombre del sujeto al CSR"))?;
    csr_builder
        .sign(&private_key, MessageDigest::sha256())
        .map_err(openssl_failure("No se pudo firmar el CSR"))?;

    let csr = csr_builder.build();

    let private_key_pem = private_key
        .private_key_to_pem_pkcs8()
        .map_err(openssl_failure("No se pudo convertir la private key al formato PEM"))?;
    let csr_pem = csr
        .to_pem()
        .map_err(openssl_failure("No se pudo convertir el CSR a formato PEM"))?;

    Ok(PrivateKeyWithCSR {
        base64_private_key_pem: base64::encode_block(&private_key_pem),
        base64_csr_pem: base64::encode_block(&csr_pem),
    })
}

#[cfg(test)]
mod tests {
    use super::{generate_csr, CSRGenerationParams};
    use openssl::{base64, nid::Nid, x509::X509Req};

    fn oece_params() -> CSRGenerationParams {
        CSRGenerationParams {
            country: "PE".to_string(),
            state: "Lima-Lima".to_string(),
            locality: "Jesús María".to_string(),
            organization: "ORGANISMO ESPECIALIZADO PARA LAS CONTRATACIONES PÚBLICAS EFICIENTES"
                .to_string(),
            organization_unit: "Oficina de Tecnologías de la Información".to_string(),
            street: "Av. Gregorio Escobedo Cdra. 7 Nro. S/N".to_string(),
            email: "soporte@dominio.pe".to_string(),
            common_name: "Agente automatizado - ORGANISMO ESPECIALIZADO PARA LAS CONTRATACIONES PÚBLICAS EFICIENTES".to_string(),
            modulus_length: Some(2048),
        }
    }

    fn subject_entry(csr: &X509Req, nid: Nid) -> String {
        csr.subject_name()
            .entries_by_nid(nid)
            .next()
            .expect("el atributo existe en el CSR")
            .data()
            .as_utf8()
            .expect("el atributo es texto")
            .to_string()
    }

    fn generated_csr(params: CSRGenerationParams) -> X509Req {
        let Ok(generated) = generate_csr(params) else {
            panic!("el CSR debería generarse");
        };
        let pem = base64::decode_block(&generated.base64_csr_pem).expect("PEM en base64");
        X509Req::from_pem(&pem).expect("CSR válido")
    }

    #[test]
    fn generates_a_csr_with_attributes_longer_than_the_x520_bounds() {
        let csr = generated_csr(oece_params());

        assert_eq!(subject_entry(&csr, Nid::ORGANIZATIONNAME).chars().count(), 67);
        assert_eq!(subject_entry(&csr, Nid::COMMONNAME).chars().count(), 89);
    }

    #[test]
    fn generates_a_csr_with_a_common_name_at_the_128_character_limit() {
        let common_name = "Ñ".repeat(128);
        let csr = generated_csr(CSRGenerationParams {
            common_name: common_name.clone(),
            ..oece_params()
        });

        assert_eq!(subject_entry(&csr, Nid::COMMONNAME), common_name);
    }
}
