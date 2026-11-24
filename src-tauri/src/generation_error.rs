use serde::Serialize;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Field {
    Country,
    State,
    Locality,
    Organization,
    OrganizationUnit,
    Street,
    Email,
    CommonName,
    DriverPath,
    SlotId,
    Pin,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GenerationError {
    Field { field: Field, message: String },
    General { message: String },
}

impl GenerationError {
    pub fn field(field: Field, message: impl Into<String>) -> Self {
        Self::Field {
            field,
            message: message.into(),
        }
    }

    pub fn general(message: impl Into<String>) -> Self {
        Self::General {
            message: message.into(),
        }
    }
}
