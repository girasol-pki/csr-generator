use bit_vec::BitVec;
use cryptoki::{
    context::{CInitializeArgs, Pkcs11},
    mechanism::Mechanism,
    object::{Attribute, AttributeType, ObjectHandle},
    session::UserType,
    slot::Slot,
    types::AuthPin,
};
use num_bigint::BigUint;
use openssl::base64;
use serde::{Deserialize, Serialize};
use yasna::models::ObjectIdentifier;

#[derive(Serialize)]
pub struct GenerationError {
    pub message: String,
}

impl GenerationError {
    fn new(msg: impl Into<String>) -> Self {
        Self {
            message: msg.into(),
        }
    }
}

#[derive(Serialize)]
pub struct SlotEntry {
    pub id: u64,
    pub label: String,
    pub manufacturer: String,
    pub model: String,
    pub serial_number: String,
    pub initialized: bool,
    pub login_required: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PKCS11SlotsParams {
    pub driver_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PKCS11CSRGenerationParams {
    pub driver_path: String,
    pub slot_id: u64,
    pub pin: String,
    pub key_label: String,
    pub country: String,
    pub state: String,
    pub locality: String,
    pub organization: String,
    pub organization_unit: String,
    pub street: String,
    pub email: String,
    pub common_name: String,
    pub modulus_length: Option<u32>,
}

#[derive(Serialize)]
pub struct PKCS11CSRResult {
    pub base64_csr_pem: String,
}

fn init_pkcs11(driver_path: &str) -> Result<Pkcs11, GenerationError> {
    let pkcs11 = Pkcs11::new(driver_path).map_err(|e| {
        GenerationError::new(format!("No se pudo cargar el driver PKCS#11: {}", e))
    })?;
    pkcs11
        .initialize(CInitializeArgs::OsThreads)
        .map_err(|e| GenerationError::new(format!("No se pudo inicializar PKCS#11: {}", e)))?;
    Ok(pkcs11)
}

#[tauri::command]
pub fn list_pkcs11_slots(
    params: PKCS11SlotsParams,
) -> Result<Vec<SlotEntry>, GenerationError> {
    let pkcs11 = init_pkcs11(&params.driver_path)?;

    let slots = pkcs11
        .get_slots_with_token()
        .map_err(|e| GenerationError::new(format!("No se pudieron listar los slots: {}", e)))?;

    let mut entries = Vec::with_capacity(slots.len());
    for slot in slots {
        let token_info = pkcs11.get_token_info(slot).map_err(|e| {
            GenerationError::new(format!("No se pudo obtener información del token: {}", e))
        })?;

        entries.push(SlotEntry {
            id: slot.id(),
            label: token_info.label().trim().to_string(),
            manufacturer: token_info.manufacturer_id().trim().to_string(),
            model: token_info.model().trim().to_string(),
            serial_number: token_info.serial_number().trim().to_string(),
            initialized: token_info.token_initialized(),
            login_required: token_info.login_required(),
        });
    }

    Ok(entries)
}

#[tauri::command]
pub fn generate_csr_pkcs11(
    data: PKCS11CSRGenerationParams,
) -> Result<PKCS11CSRResult, GenerationError> {
    let pkcs11 = init_pkcs11(&data.driver_path)?;

    let slot = Slot::try_from(data.slot_id)
        .map_err(|e| GenerationError::new(format!("Slot inválido: {}", e)))?;

    let session = pkcs11
        .open_rw_session(slot)
        .map_err(|e| GenerationError::new(format!("No se pudo abrir sesión en el token: {}", e)))?;

    session
        .login(UserType::User, Some(&AuthPin::new(data.pin.clone())))
        .map_err(|e| GenerationError::new(format!("PIN incorrecto o login fallido: {}", e)))?;

    let modulus_bits = data.modulus_length.unwrap_or(2048);
    let label_bytes = data.key_label.clone().into_bytes();

    let public_template = vec![
        Attribute::Token(true),
        Attribute::Private(false),
        Attribute::Encrypt(true),
        Attribute::Verify(true),
        Attribute::Wrap(true),
        Attribute::ModulusBits(modulus_bits.into()),
        Attribute::PublicExponent(vec![0x01, 0x00, 0x01]),
        Attribute::Label(label_bytes.clone()),
    ];

    let private_template = vec![
        Attribute::Token(true),
        Attribute::Private(true),
        Attribute::Sensitive(true),
        Attribute::Decrypt(true),
        Attribute::Sign(true),
        Attribute::Unwrap(true),
        Attribute::Label(label_bytes),
    ];

    let (pub_handle, priv_handle) = session
        .generate_key_pair(
            &Mechanism::RsaPkcsKeyPairGen,
            &public_template,
            &private_template,
        )
        .map_err(|e| {
            GenerationError::new(format!("No se pudo generar el par de claves en el token: {}", e))
        })?;

    let (modulus, public_exponent) = read_rsa_public_components(&session, pub_handle)?;

    let cert_request_info = build_cert_request_info(&data, &modulus, &public_exponent);

    let signature = session
        .sign(&Mechanism::Sha256RsaPkcs, priv_handle, &cert_request_info)
        .map_err(|e| {
            GenerationError::new(format!("No se pudo firmar el CSR con el token: {}", e))
        })?;

    let csr_der = build_certification_request(&cert_request_info, &signature);
    let csr_pem = der_to_pem(&csr_der, "CERTIFICATE REQUEST");

    Ok(PKCS11CSRResult {
        base64_csr_pem: base64::encode_block(csr_pem.as_bytes()),
    })
}

fn read_rsa_public_components(
    session: &cryptoki::session::Session,
    handle: ObjectHandle,
) -> Result<(BigUint, BigUint), GenerationError> {
    let attrs = session
        .get_attributes(
            handle,
            &[AttributeType::Modulus, AttributeType::PublicExponent],
        )
        .map_err(|e| {
            GenerationError::new(format!(
                "No se pudieron leer los componentes públicos: {}",
                e
            ))
        })?;

    let mut modulus: Option<BigUint> = None;
    let mut exponent: Option<BigUint> = None;
    for attr in attrs {
        match attr {
            Attribute::Modulus(bytes) => modulus = Some(BigUint::from_bytes_be(&bytes)),
            Attribute::PublicExponent(bytes) => exponent = Some(BigUint::from_bytes_be(&bytes)),
            _ => {}
        }
    }

    let modulus = modulus
        .ok_or_else(|| GenerationError::new("El token no devolvió el módulo".to_string()))?;
    let exponent = exponent
        .ok_or_else(|| GenerationError::new("El token no devolvió el exponente público".to_string()))?;

    Ok((modulus, exponent))
}

fn oid(parts: &[u64]) -> ObjectIdentifier {
    ObjectIdentifier::new(parts.to_vec())
}

enum AttrStringType {
    Printable,
    Utf8,
    Ia5,
}

fn build_subject_name_der(data: &PKCS11CSRGenerationParams) -> Vec<u8> {
    let entries: Vec<(ObjectIdentifier, &str, AttrStringType)> = vec![
        (oid(&[2, 5, 4, 6]), data.country.as_str(), AttrStringType::Printable), // C
        (oid(&[2, 5, 4, 8]), data.state.as_str(), AttrStringType::Utf8),        // ST
        (oid(&[2, 5, 4, 7]), data.locality.as_str(), AttrStringType::Utf8),     // L
        (oid(&[2, 5, 4, 10]), data.organization.as_str(), AttrStringType::Utf8), // O
        (oid(&[2, 5, 4, 11]), data.organization_unit.as_str(), AttrStringType::Utf8), // OU
        (oid(&[2, 5, 4, 9]), data.street.as_str(), AttrStringType::Utf8),       // street
        (
            oid(&[1, 2, 840, 113549, 1, 9, 1]),
            data.email.as_str(),
            AttrStringType::Ia5,
        ), // emailAddress
        (oid(&[2, 5, 4, 3]), data.common_name.as_str(), AttrStringType::Utf8),  // CN
    ];

    yasna::construct_der(|writer| {
        writer.write_sequence(|writer| {
            for (attr_oid, value, kind) in &entries {
                writer.next().write_set(|writer| {
                    writer.next().write_sequence(|writer| {
                        writer.next().write_oid(attr_oid);
                        match kind {
                            AttrStringType::Printable => {
                                writer.next().write_printable_string(value)
                            }
                            AttrStringType::Utf8 => writer.next().write_utf8_string(value),
                            AttrStringType::Ia5 => writer.next().write_ia5_string(value),
                        }
                    });
                });
            }
        });
    })
}

fn build_rsa_public_key_der(modulus: &BigUint, exponent: &BigUint) -> Vec<u8> {
    yasna::construct_der(|writer| {
        writer.write_sequence(|writer| {
            writer.next().write_biguint(modulus);
            writer.next().write_biguint(exponent);
        });
    })
}

fn build_subject_public_key_info_der(modulus: &BigUint, exponent: &BigUint) -> Vec<u8> {
    let rsa_public_key = build_rsa_public_key_der(modulus, exponent);

    yasna::construct_der(|writer| {
        writer.write_sequence(|writer| {
            writer.next().write_sequence(|writer| {
                writer
                    .next()
                    .write_oid(&oid(&[1, 2, 840, 113549, 1, 1, 1])); // rsaEncryption
                writer.next().write_null();
            });
            writer
                .next()
                .write_bitvec(&BitVec::from_bytes(&rsa_public_key));
        });
    })
}

fn build_cert_request_info(
    data: &PKCS11CSRGenerationParams,
    modulus: &BigUint,
    exponent: &BigUint,
) -> Vec<u8> {
    let subject_der = build_subject_name_der(data);
    let spki_der = build_subject_public_key_info_der(modulus, exponent);

    yasna::construct_der(|writer| {
        writer.write_sequence(|writer| {
            writer.next().write_u8(0); // version v1(0)
            writer.next().write_der(&subject_der);
            writer.next().write_der(&spki_der);
            // attributes [0] IMPLICIT — empty SET wrapped in context tag 0
            writer
                .next()
                .write_tagged_implicit(yasna::Tag::context(0), |writer| {
                    writer.write_set(|_| {});
                });
        });
    })
}

fn build_certification_request(cert_request_info: &[u8], signature: &[u8]) -> Vec<u8> {
    yasna::construct_der(|writer| {
        writer.write_sequence(|writer| {
            writer.next().write_der(cert_request_info);
            writer.next().write_sequence(|writer| {
                writer
                    .next()
                    .write_oid(&oid(&[1, 2, 840, 113549, 1, 1, 11])); // sha256WithRSAEncryption
                writer.next().write_null();
            });
            writer.next().write_bitvec(&BitVec::from_bytes(signature));
        });
    })
}

fn der_to_pem(der: &[u8], label: &str) -> String {
    let b64 = base64::encode_block(der);
    let mut out = String::new();
    out.push_str(&format!("-----BEGIN {}-----\n", label));
    for chunk in b64.as_bytes().chunks(64) {
        out.push_str(std::str::from_utf8(chunk).unwrap());
        out.push('\n');
    }
    out.push_str(&format!("-----END {}-----\n", label));
    out
}
