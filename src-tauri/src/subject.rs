use crate::generation_error::{Field, GenerationError};

pub struct Subject<'a> {
    pub country: &'a str,
    pub state: &'a str,
    pub locality: &'a str,
    pub organization: &'a str,
    pub organization_unit: &'a str,
    pub street: &'a str,
    pub email: &'a str,
    pub common_name: &'a str,
}

impl Subject<'_> {
    // Límites por atributo acordados con girasol-ec (EJBCA no impone ninguno), en caracteres
    // (puntos de código), no bytes. Se validan antes de generar nada: en el flujo PKCS#11
    // evita crear una llave en el token para un CSR que no se va a poder usar.
    pub fn validate(&self) -> Result<(), GenerationError> {
        let attributes = [
            (Field::Country, "El país", self.country, 2),
            (Field::State, "La región y provincia", self.state, 128),
            (Field::Locality, "El distrito", self.locality, 128),
            (Field::Organization, "La organización", self.organization, 128),
            (Field::OrganizationUnit, "La unidad organizacional", self.organization_unit, 128),
            (Field::Street, "La dirección", self.street, 256),
            (Field::Email, "El email", self.email, 255),
            (Field::CommonName, "El nombre común", self.common_name, 128),
        ];

        for (field, label, value, max) in attributes {
            let chars = value.chars().count();
            if chars == 0 {
                return Err(GenerationError::field(
                    field,
                    format!("{label} es un campo requerido"),
                ));
            }
            if chars > max {
                return Err(GenerationError::field(
                    field,
                    format!("{label} supera el máximo de {max} caracteres (tiene {chars})"),
                ));
            }
        }

        if !self.email.is_ascii() {
            return Err(GenerationError::field(
                Field::Email,
                "El email solo puede contener caracteres ASCII",
            ));
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::Subject;
    use crate::generation_error::{Field, GenerationError};

    fn valid_subject() -> Subject<'static> {
        Subject {
            country: "PE",
            state: "Lima-Lima",
            locality: "San Isidro",
            organization: "Girasol S.C.R.L",
            organization_unit: "Contabilidad",
            street: "Av. Javier Prado Este 1234",
            email: "usuario@dominio.com",
            common_name: "FirmEasy",
        }
    }

    #[test]
    fn accepts_a_subject_within_limits() {
        assert_eq!(valid_subject().validate(), Ok(()));
    }

    #[test]
    fn accepts_an_organization_longer_than_the_x520_bound_of_64() {
        let subject = Subject {
            organization: "ORGANISMO ESPECIALIZADO PARA LAS CONTRATACIONES PÚBLICAS EFICIENTES",
            ..valid_subject()
        };

        assert_eq!(subject.validate(), Ok(()));
    }

    #[test]
    fn rejects_an_organization_longer_than_128_characters() {
        let organization = "O".repeat(129);
        let subject = Subject {
            organization: &organization,
            ..valid_subject()
        };

        assert_eq!(
            subject.validate(),
            Err(GenerationError::field(
                Field::Organization,
                "La organización supera el máximo de 128 caracteres (tiene 129)",
            ))
        );
    }

    #[test]
    fn allows_a_street_up_to_256_characters() {
        let street = "S".repeat(256);
        let subject = Subject {
            street: &street,
            ..valid_subject()
        };

        assert_eq!(subject.validate(), Ok(()));
    }

    #[test]
    fn counts_characters_not_bytes() {
        let accented = "Ñ".repeat(128);
        let subject = Subject {
            common_name: &accented,
            ..valid_subject()
        };

        assert_eq!(subject.validate(), Ok(()));
    }

    #[test]
    fn rejects_an_empty_attribute() {
        let subject = Subject {
            organization_unit: "",
            ..valid_subject()
        };

        assert_eq!(
            subject.validate(),
            Err(GenerationError::field(
                Field::OrganizationUnit,
                "La unidad organizacional es un campo requerido",
            ))
        );
    }

    #[test]
    fn rejects_a_non_ascii_email() {
        let subject = Subject {
            email: "año@dominio.com",
            ..valid_subject()
        };

        assert_eq!(
            subject.validate(),
            Err(GenerationError::field(
                Field::Email,
                "El email solo puede contener caracteres ASCII",
            ))
        );
    }
}
