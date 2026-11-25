import type { FormValues } from "@/csr/subject-form";

export const aFormValues = (overrides: Partial<FormValues> = {}): FormValues => ({
	country: "PE",
	region: "LIMA",
	province: "LIMA",
	district: "MIRAFLORES",
	organization: "EMPRESA DE EJEMPLO S.A.C.",
	organizationUnit: "TECNOLOGÍA",
	street: "AV. EJEMPLO 123",
	email: "agente@example.com",
	commonName: "Agente automatizado de ejemplo",
	modulusLength: "2048",
	pkcs11Enabled: false,
	driverPath: "",
	slotId: "",
	pin: "",
	keyLabel: "firmeasy-key",
	...overrides,
});

export const aPKCS11FormValues = (overrides: Partial<FormValues> = {}): FormValues =>
	aFormValues({
		pkcs11Enabled: true,
		driverPath: "C:\\Windows\\System32\\token.dll",
		slotId: "1",
		pin: "1234",
		...overrides,
	});
