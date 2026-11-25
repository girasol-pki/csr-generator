import { describe, expect, it } from "vitest";
import {
	characterCount,
	csrParamsOf,
	type FormValues,
	fieldsToRevalidate,
	formSchema,
	pkcs11ParamsOf,
} from "@/csr/subject-form";
import { aFormValues, aPKCS11FormValues } from "./form-values-mother";

const errorsOf = (values: FormValues, field: keyof FormValues) =>
	formSchema
		.safeParse(values)
		.error?.issues.filter((issue) => issue.path[0] === field)
		.map((issue) => issue.message) ?? [];

const neverInvalid = () => false;

describe("characterCount", () => {
	it("counts code points, not UTF-16 units", () => {
		expect(characterCount("😀")).toBe(1);
	});
});

describe("formSchema", () => {
	it("accepts a complete subject", () => {
		expect(formSchema.safeParse(aFormValues()).success).toBe(true);
	});

	it("collapses inner whitespace and trims", () => {
		const parsed = formSchema.parse(aFormValues({ organization: "  EMPRESA   DE  EJEMPLO  " }));

		expect(parsed.organization).toBe("EMPRESA DE EJEMPLO");
	});

	it("requires subject fields", () => {
		expect(errorsOf(aFormValues({ commonName: "   " }), "commonName")).toEqual(["Este campo es requerido"]);
	});

	it("accepts an organization of exactly 128 characters", () => {
		expect(errorsOf(aFormValues({ organization: "O".repeat(128) }), "organization")).toEqual([]);
	});

	it("rejects an organization over 128 characters and says by how much", () => {
		expect(errorsOf(aFormValues({ organization: "O".repeat(129) }), "organization")).toEqual([
			"Máximo 128 caracteres (tienes 129)",
		]);
	});

	it("counts after NFC, so a decomposed Ñ is one character", () => {
		const decomposedEnye = "Ñ";

		expect(errorsOf(aFormValues({ commonName: decomposedEnye.repeat(128) }), "commonName")).toEqual([]);
	});

	it("allows a street of up to 256 characters", () => {
		expect(errorsOf(aFormValues({ street: "S".repeat(256) }), "street")).toEqual([]);
		expect(errorsOf(aFormValues({ street: "S".repeat(257) }), "street")).toHaveLength(1);
	});

	it("limits region and province together, reported on province", () => {
		const values = aFormValues({ region: "R".repeat(64), province: "P".repeat(64) });

		expect(errorsOf(values, "province")).toEqual(["Región y provincia juntas: máximo 128 caracteres (tienen 129)"]);
	});

	it("rejects an invalid email", () => {
		expect(errorsOf(aFormValues({ email: "agente@" }), "email")).toEqual(["El email ingresado no es válido"]);
	});

	it("ignores the token fields when PKCS#11 is off", () => {
		expect(formSchema.safeParse(aFormValues({ pin: "" })).success).toBe(true);
	});

	it("requires driver, slot, PIN and key label when PKCS#11 is on", () => {
		const values = aPKCS11FormValues({ driverPath: "", slotId: "", pin: "", keyLabel: "  " });

		expect(errorsOf(values, "driverPath")).toEqual(["Selecciona un driver PKCS#11"]);
		expect(errorsOf(values, "slotId")).toEqual(["Selecciona un slot"]);
		expect(errorsOf(values, "pin")).toEqual(["Ingresa el PIN del token"]);
		expect(errorsOf(values, "keyLabel")).toEqual(["Ingresa una etiqueta para la llave"]);
	});
});

describe("fieldsToRevalidate", () => {
	it("revalidates a field as soon as it goes over its limit", () => {
		expect(fieldsToRevalidate("organization", { organization: "O".repeat(129) }, neverInvalid)).toEqual([
			"organization",
		]);
	});

	it("leaves a valid field alone while typing", () => {
		expect(fieldsToRevalidate("organization", { organization: "EMPRESA" }, neverInvalid)).toEqual([]);
	});

	it("revalidates a field that already shows an error, so the error clears once fixed", () => {
		const isInvalid = (field: string) => field === "organization";

		expect(fieldsToRevalidate("organization", { organization: "EMPRESA" }, isInvalid)).toEqual(["organization"]);
	});

	it("revalidates province when typing in region pushes the combined state over the limit", () => {
		const values = { region: "R".repeat(100), province: "P".repeat(28) };

		expect(fieldsToRevalidate("region", values, neverInvalid)).toEqual(["province"]);
	});
});

describe("csrParamsOf", () => {
	it("joins region and province into the state attribute", () => {
		const params = csrParamsOf(aFormValues({ region: "LIMA", province: "CAÑETE" }));

		expect(params.state).toBe("LIMA-CAÑETE");
		expect(params.locality).toBe("MIRAFLORES");
		expect(params.modulusLength).toBe(2048);
	});
});

describe("pkcs11ParamsOf", () => {
	it("sends the slot as a number and the key label trimmed", () => {
		const params = pkcs11ParamsOf(aPKCS11FormValues({ slotId: "3", keyLabel: "  mi-llave " }));

		expect(params.slotId).toBe(3);
		expect(params.keyLabel).toBe("mi-llave");
	});
});
