import { z } from "zod";
import type { FormValues } from "./subject-form";

const backendFieldSchema = z.enum([
	"country",
	"state",
	"locality",
	"organization",
	"organizationUnit",
	"street",
	"email",
	"commonName",
	"driverPath",
	"slotId",
	"pin",
]);

// "state" es región y provincia concatenadas; el error se muestra en provincia.
const formFieldByBackendField: Record<z.infer<typeof backendFieldSchema>, keyof FormValues> = {
	country: "country",
	state: "province",
	locality: "district",
	organization: "organization",
	organizationUnit: "organizationUnit",
	street: "street",
	email: "email",
	commonName: "commonName",
	driverPath: "driverPath",
	slotId: "slotId",
	pin: "pin",
};

const generationErrorSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("field"), field: backendFieldSchema, message: z.string() }),
	z.object({ kind: z.literal("general"), message: z.string() }),
]);

export type InvokeFailure =
	| { kind: "field"; field: keyof FormValues; message: string }
	| { kind: "general"; message: string };

// Los comandos rechazan con GenerationError; Tauri rechaza con un string si falla antes (p. ej. al deserializar).
export function parseInvokeError(error: unknown): InvokeFailure {
	const parsed = generationErrorSchema.safeParse(error);
	if (parsed.success) {
		const failure = parsed.data;
		return failure.kind === "field"
			? { kind: "field", field: formFieldByBackendField[failure.field], message: failure.message }
			: failure;
	}
	if (typeof error === "string") {
		return { kind: "general", message: error };
	}
	if (error instanceof Error) {
		return { kind: "general", message: error.message };
	}
	return { kind: "general", message: "Error desconocido" };
}
