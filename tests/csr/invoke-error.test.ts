import { describe, expect, it } from "vitest";
import { parseInvokeError } from "@/csr/invoke-error";

describe("parseInvokeError", () => {
	it("shows a backend state error on the province field", () => {
		const failure = parseInvokeError({ kind: "field", field: "state", message: "Muy largo" });

		expect(failure).toEqual({ kind: "field", field: "province", message: "Muy largo" });
	});

	it("shows a backend locality error on the district field", () => {
		const failure = parseInvokeError({ kind: "field", field: "locality", message: "Requerido" });

		expect(failure).toEqual({ kind: "field", field: "district", message: "Requerido" });
	});

	it("keeps general backend errors as they are", () => {
		const failure = parseInvokeError({ kind: "general", message: "Token no disponible" });

		expect(failure).toEqual({ kind: "general", message: "Token no disponible" });
	});

	it("uses the text when Tauri rejects with a string", () => {
		expect(parseInvokeError("invalid args")).toEqual({ kind: "general", message: "invalid args" });
	});

	it("uses the message of a thrown Error", () => {
		expect(parseInvokeError(new Error("respuesta inválida"))).toEqual({
			kind: "general",
			message: "respuesta inválida",
		});
	});

	it("falls back to a generic message for anything else, including unknown fields", () => {
		const unknown = { kind: "general", message: "Error desconocido" };

		expect(parseInvokeError({ kind: "field", field: "serialNumber", message: "x" })).toEqual(unknown);
		expect(parseInvokeError(undefined)).toEqual(unknown);
	});
});
