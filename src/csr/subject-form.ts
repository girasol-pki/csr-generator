import { z } from "zod";

export type CSRGenerationParams = {
	country: string;
	state: string;
	locality: string;
	organization: string;
	organizationUnit: string;
	street: string;
	email: string;
	commonName: string;
	modulusLength: number;
};

export type PKCS11CSRGenerationParams = CSRGenerationParams & {
	driverPath: string;
	slotId: number;
	pin: string;
	keyLabel: string;
};

// Límites y normalización acordados con girasol-ec: se cuentan puntos de código tras NFC
// (no unidades UTF-16 ni bytes) sobre el valor final de cada atributo del subject.
export const characterCount = (value: string) => [...value].length;

export const normalizeSubjectText = (value: string) => value.normalize("NFC").replace(/\s+/g, " ").trim();

export const MAX_STATE_LENGTH = 128;

export const MAX_CHARS = {
	region: MAX_STATE_LENGTH,
	province: MAX_STATE_LENGTH,
	district: 128,
	organization: 128,
	organizationUnit: 128,
	street: 256,
	email: 255,
	commonName: 128,
} as const;

export type LimitedField = keyof typeof MAX_CHARS;

export const isLimitedField = (name: string): name is LimitedField => name in MAX_CHARS;

const withinChars = (max: number) => (value: string, ctx: z.RefinementCtx) => {
	const count = characterCount(value);
	if (count > max) {
		ctx.addIssue({ code: "custom", message: `Máximo ${max} caracteres (tienes ${count})` });
	}
};

const subjectText = (max: number) =>
	z
		.string()
		.transform(normalizeSubjectText)
		.pipe(z.string().min(1, "Este campo es requerido").superRefine(withinChars(max)));

// El atributo ST del certificado es "región-provincia".
export const stateOf = (region: string, province: string) => `${region}-${province}`;

const isStatePart = (name: LimitedField) => name === "region" || name === "province";

const exceedsFieldLimit = (name: LimitedField, value = "") =>
	characterCount(normalizeSubjectText(value)) > MAX_CHARS[name];

const exceedsStateLimit = (region = "", province = "") => characterCount(stateOf(region, province)) > MAX_STATE_LENGTH;

// Al escribir en `name`: revalida lo que se pasa del límite y lo que ya muestra error, para que el aviso
// aparezca o desaparezca en el acto.
export function fieldsToRevalidate(
	name: LimitedField,
	values: Partial<Record<LimitedField, string>>,
	isInvalid: (field: LimitedField) => boolean,
): LimitedField[] {
	const targets = new Set<LimitedField>();
	if (exceedsFieldLimit(name, values[name]) || isInvalid(name)) {
		targets.add(name);
	}
	if (isStatePart(name) && (exceedsStateLimit(values.region, values.province) || isInvalid("province"))) {
		targets.add("province");
	}
	return [...targets];
}

export const formSchema = z
	.object({
		country: z.string().length(2),
		region: subjectText(MAX_CHARS.region),
		province: subjectText(MAX_CHARS.province),
		district: subjectText(MAX_CHARS.district),
		organization: subjectText(MAX_CHARS.organization),
		organizationUnit: subjectText(MAX_CHARS.organizationUnit),
		street: subjectText(MAX_CHARS.street),
		email: z
			.string()
			.trim()
			.pipe(z.email("El email ingresado no es válido").superRefine(withinChars(MAX_CHARS.email))),
		commonName: subjectText(MAX_CHARS.commonName),
		modulusLength: z.string().refine((value) => ["2048", "3072"].includes(value), {
			message: "El tamaño de clave debe ser 2048 o 3072",
		}),
		pkcs11Enabled: z.boolean(),
		driverPath: z.string(),
		slotId: z.string(),
		pin: z.string(),
		keyLabel: z.string(),
	})
	.superRefine((values, ctx) => {
		const state = stateOf(values.region, values.province);
		if (characterCount(state) > MAX_STATE_LENGTH) {
			ctx.addIssue({
				code: "custom",
				path: ["province"],
				message: `Región y provincia juntas: máximo ${MAX_STATE_LENGTH} caracteres (tienen ${characterCount(state)})`,
			});
		}

		if (!values.pkcs11Enabled) {
			return;
		}
		if (!values.driverPath) {
			ctx.addIssue({ code: "custom", path: ["driverPath"], message: "Selecciona un driver PKCS#11" });
		}
		if (!values.slotId) {
			ctx.addIssue({ code: "custom", path: ["slotId"], message: "Selecciona un slot" });
		}
		if (!values.pin) {
			ctx.addIssue({ code: "custom", path: ["pin"], message: "Ingresa el PIN del token" });
		}
		if (!values.keyLabel || values.keyLabel.trim().length === 0) {
			ctx.addIssue({ code: "custom", path: ["keyLabel"], message: "Ingresa una etiqueta para la llave" });
		}
	});

export type FormValues = z.infer<typeof formSchema>;

export const csrParamsOf = (values: FormValues): CSRGenerationParams => ({
	country: values.country,
	state: stateOf(values.region, values.province),
	locality: values.district,
	organization: values.organization,
	organizationUnit: values.organizationUnit,
	street: values.street,
	email: values.email,
	commonName: values.commonName,
	modulusLength: Number(values.modulusLength),
});

export const pkcs11ParamsOf = (values: FormValues): PKCS11CSRGenerationParams => ({
	...csrParamsOf(values),
	driverPath: values.driverPath,
	slotId: Number(values.slotId),
	pin: values.pin,
	keyLabel: values.keyLabel.trim(),
});
