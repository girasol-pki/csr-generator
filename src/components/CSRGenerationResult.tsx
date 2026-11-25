import { invoke } from "@tauri-apps/api/core";
import { format } from "date-fns";
import { FileSignatureIcon, InfoIcon, KeyIcon } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { cn } from "@/lib/utils";
import type { PrivateKeyWithCSR } from "@/models";
import { Button } from "./ui/button";

const saveOutcomeSchema = z.enum(["saved", "cancelled"]);

const saveErrorSchema = z.object({ message: z.string() });

type PemKind = "privateKey" | "csr";

async function savePemFile(kind: PemKind, fileName: string, contents: string) {
	try {
		return saveOutcomeSchema.parse(await invoke("save_pem_file", { kind, fileName, contents }));
	} catch (error) {
		const parsed = saveErrorSchema.safeParse(error);
		toast.error("No se pudo guardar el archivo", {
			description: parsed.success ? parsed.data.message : String(error),
			closeButton: true,
		});
		return "cancelled";
	}
}

type Props = {
	className?: string;
	privateKeyWithCSR: PrivateKeyWithCSR | null;
	privateKeyDownloaded: boolean;
	setPrivateKeyIsDownloaded: () => void;
	setCSRIsDownloaded: () => void;
};

export function CSRGenerationResult({
	className,
	privateKeyWithCSR,
	privateKeyDownloaded,
	setCSRIsDownloaded,
	setPrivateKeyIsDownloaded,
}: Props) {
	const formattedDownloadName = useMemo(() => format(new Date(), "yyyyMMddHHmmss"), [privateKeyWithCSR]);

	const hasPrivateKey = Boolean(privateKeyWithCSR?.privateKeyPem);
	const isKeyInToken = privateKeyWithCSR !== null && privateKeyWithCSR.privateKeyPem === null;
	// Sin la llave el certificado emitido para este CSR no sirve: se guarda primero.
	const mustSavePrivateKeyFirst = hasPrivateKey && !privateKeyDownloaded;

	async function savePrivateKey() {
		if (!privateKeyWithCSR?.privateKeyPem) {
			return;
		}
		const outcome = await savePemFile(
			"privateKey",
			`${formattedDownloadName}-private.key`,
			privateKeyWithCSR.privateKeyPem.trim(),
		);
		if (outcome === "cancelled") {
			return;
		}
		setPrivateKeyIsDownloaded();
		toast.success("Private Key guardada correctamente", {
			description: "Guárdala en un lugar seguro: la necesitarás para usar el certificado",
			closeButton: true,
		});
	}

	async function saveCSR() {
		if (!privateKeyWithCSR) {
			return;
		}
		const outcome = await savePemFile("csr", `${formattedDownloadName}-csr.csr`, privateKeyWithCSR.csrPem.trim());
		if (outcome === "cancelled") {
			return;
		}
		setCSRIsDownloaded();
		toast.success("CSR guardado correctamente", {
			description: "Envía este archivo a FirmEasy para solicitar tu certificado",
			closeButton: true,
		});
	}

	const notice = isKeyInToken
		? "La llave privada permanece en el token PKCS#11"
		: mustSavePrivateKeyFirst
			? "Guarda primero la Private Key: sin ella el certificado no servirá"
			: "La Private Key firma el CSR y no la debes compartir con nadie";

	return (
		<section
			className={cn(className, "space-y-6 h-full grid")}
			style={{
				gridTemplateRows: "min-content min-content 1fr",
			}}
		>
			<div className="space-y-3">
				<p className="flex text-sm text-amber-600 dark:text-amber-400 font-semibold w-full justify-center leading-4 grow">
					<InfoIcon className="w-4 h-4 shrink-0 me-2" />
					{notice}
				</p>
				<div className="flex justify-evenly">
					<Button
						className="bg-[hsl(247,94%,19%)] hover:bg-[hsl(247,94%,19%)]/90 dark:bg-[hsl(247,94%,30%)] dark:hover:bg-[hsl(247,94%,25%)] flex px-6 dark:text-gray-100 dark:hover:text-gray-50 select-none w-56"
						disabled={!privateKeyWithCSR || !hasPrivateKey}
						onClick={savePrivateKey}
					>
						<KeyIcon className="w-5 h-5 me-2 shrink-0" />
						<span className="block text-base leading-6">{isKeyInToken ? "Llave en token" : "Guardar Private Key"}</span>
					</Button>
					<Button
						className="bg-primary hover:bg-primary/90 flex px-6 dark:text-gray-100 dark:hover:text-gray-50 select-none w-56"
						disabled={!privateKeyWithCSR || mustSavePrivateKeyFirst}
						onClick={saveCSR}
					>
						<FileSignatureIcon className="w-5 h-5 me-2 shrink-0" />
						<span className="block text-base leading-6">Guardar CSR</span>
					</Button>
				</div>
			</div>
			<pre
				className="w-full min-h-[50ch] h-fit rounded-md border border-primary bg-transparent focus:outline-hidden focus:ring-1 focus:ring-ring text-base resize-none overflow-auto p-5 pl-6 select-none whitespace-pre"
				contentEditable={false}
			>
				{privateKeyWithCSR?.csrPem.trim() ?? "Tu CSR aparecerá aquí"}
			</pre>
		</section>
	);
}
