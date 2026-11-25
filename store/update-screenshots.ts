// Reemplaza las capturas de todas las fichas de la Store por las de store/screenshots y envía el
// cambio a certificación. Usa la API de envíos directamente: msstore CLI solo sube imágenes en el
// primer envío de una app.
//
// Sin dependencias a propósito: corre en el job que tiene los secrets.
// Uso: TENANT_ID=... CLIENT_ID=... CLIENT_SECRET=... PRODUCT_ID=... node store/update-screenshots.ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// En el orden en que se muestran en la Store.
const SCREENSHOTS = [
	{ file: "01-formulario-claro.png", description: "Completa los datos del certificado de agente automatizado" },
	{ file: "02-csr-generado-claro.png", description: "Genera la llave privada y el CSR en tu equipo" },
	{ file: "03-opciones-avanzadas-claro.png", description: "Opciones avanzadas: tamaño de llave y token PKCS#11" },
	{ file: "04-formulario-oscuro.png", description: "También en tema oscuro" },
	{ file: "05-csr-generado-oscuro.png", description: "Guarda primero la llave privada y después el CSR" },
	{ file: "06-opciones-avanzadas-oscuro.png", description: "Genera la llave dentro de tu token PKCS#11" },
] as const;

const COMMIT_POLL_INTERVAL_MS = 30_000;
const COMMIT_TIMEOUT_MS = 20 * 60_000;

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function field(source: JsonObject, key: string, what: string): unknown {
	if (!(key in source)) {
		throw new Error(`${what}: falta "${key}"`);
	}
	return source[key];
}

function stringField(source: JsonObject, key: string, what: string): string {
	const value = field(source, key, what);
	if (typeof value !== "string") {
		throw new Error(`${what}: "${key}" no es texto`);
	}
	return value;
}

function objectField(source: JsonObject, key: string, what: string): JsonObject {
	const value = field(source, key, what);
	if (!isObject(value)) {
		throw new Error(`${what}: "${key}" no es un objeto`);
	}
	return value;
}

function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Falta la variable de entorno ${name}`);
	}
	return value;
}

const log = (message: string) => process.stdout.write(`${message}\n`);

async function getToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
	const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/token`, {
		method: "POST",
		body: new URLSearchParams({
			grant_type: "client_credentials",
			client_id: clientId,
			client_secret: clientSecret,
			resource: "https://manage.devcenter.microsoft.com",
		}),
	});
	if (!response.ok) {
		throw new Error(`No se pudo obtener el token (${response.status})`);
	}
	const body: unknown = await response.json();
	if (!isObject(body)) {
		throw new Error("Respuesta de token inválida");
	}
	return stringField(body, "access_token", "Token");
}

function apiClient(token: string, productId: string) {
	const base = `https://manage.devcenter.microsoft.com/v1.0/my/applications/${productId}`;
	return async (method: string, route: string, body?: JsonObject): Promise<JsonObject> => {
		const response = await fetch(`${base}${route}`, {
			method,
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(`${method} ${route || "/"} respondió ${response.status}: ${text}`);
		}
		const parsed: unknown = text ? JSON.parse(text) : {};
		if (!isObject(parsed)) {
			throw new Error(`${method} ${route || "/"} no devolvió un objeto`);
		}
		return parsed;
	};
}

// Marca las capturas actuales para borrar y agrega las nuevas; logos y demás imágenes quedan igual.
function replaceScreenshots(listings: JsonObject) {
	for (const [language, listing] of Object.entries(listings)) {
		if (!isObject(listing)) {
			throw new Error(`Listing ${language} inválido`);
		}
		const baseListing = objectField(listing, "baseListing", `Listing ${language}`);
		const current = baseListing.images ?? [];
		if (!Array.isArray(current)) {
			throw new Error(`Listing ${language}: "images" no es una lista`);
		}
		const kept = current.map((image: unknown) => {
			if (!isObject(image)) {
				throw new Error(`Listing ${language}: imagen inválida`);
			}
			return image.imageType === "Screenshot" ? { ...image, fileStatus: "PendingDelete" } : image;
		});
		const added = SCREENSHOTS.map(({ file, description }) => ({
			fileName: file,
			fileStatus: "PendingUpload",
			imageType: "Screenshot",
			description,
		}));
		baseListing.images = [...kept, ...added];
		log(`Listing ${language}: ${added.length} capturas nuevas`);
	}
}

function zipScreenshots(): Uint8Array<ArrayBuffer> {
	const directory = path.join(import.meta.dirname, "screenshots");
	const zipPath = path.join(mkdtempSync(path.join(tmpdir(), "store-")), "screenshots.zip");
	execFileSync("zip", ["-j", "-q", zipPath, ...SCREENSHOTS.map(({ file }) => path.join(directory, file))]);
	return readFileSync(zipPath);
}

async function uploadZip(fileUploadUrl: string, zip: Uint8Array<ArrayBuffer>) {
	// La documentación de la API pide escapar "+" en la URL SAS antes de subir.
	const response = await fetch(fileUploadUrl.replaceAll("+", "%2B"), {
		method: "PUT",
		headers: { "x-ms-blob-type": "BlockBlob" },
		body: zip,
	});
	if (!response.ok) {
		throw new Error(`No se pudo subir el zip (${response.status})`);
	}
}

async function waitForCommit(api: ReturnType<typeof apiClient>, submissionId: string): Promise<string> {
	const deadline = Date.now() + COMMIT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const statusResponse = await api("GET", `/submissions/${submissionId}/status`);
		const status = stringField(statusResponse, "status", "Estado del envío");
		if (status === "CommitFailed") {
			throw new Error(`El envío falló: ${JSON.stringify(statusResponse.statusDetails)}`);
		}
		if (status !== "CommitStarted") {
			return status;
		}
		await sleep(COMMIT_POLL_INTERVAL_MS);
	}
	throw new Error("El envío sigue procesándose después de 20 minutos; revísalo en Partner Center");
}

async function main() {
	const productId = requiredEnv("PRODUCT_ID");
	const token = await getToken(requiredEnv("TENANT_ID"), requiredEnv("CLIENT_ID"), requiredEnv("CLIENT_SECRET"));
	const api = apiClient(token, productId);

	const application = await api("GET", "");
	if (isObject(application.pendingApplicationSubmission)) {
		throw new Error("Ya hay un envío pendiente en Partner Center: termínalo o bórralo antes de correr esto.");
	}

	const submission = await api("POST", "/submissions");
	const submissionId = stringField(submission, "id", "Envío");
	log(`Envío creado: ${submissionId}`);

	try {
		replaceScreenshots(objectField(submission, "listings", "Envío"));
		await api("PUT", `/submissions/${submissionId}`, submission);
		await uploadZip(stringField(submission, "fileUploadUrl", "Envío"), zipScreenshots());
		await api("POST", `/submissions/${submissionId}/commit`);
	} catch (error) {
		// Un borrador abandonado bloquearía el próximo release.
		await api("DELETE", `/submissions/${submissionId}`);
		log(`Envío ${submissionId} borrado por el error`);
		throw error;
	}
	log(`Envío confirmado; estado: ${await waitForCommit(api, submissionId)}`);
}

await main();
