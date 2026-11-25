import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { CSRGenerationResult } from "@/components/CSRGenerationResult";
import { GenerateCSRForm } from "@/components/GenerateCSRForm";
import { Layout } from "@/layout";
import type { PrivateKeyWithCSR } from "@/models";

const INITIAL_DOWNLOADED_STATUS = {
	privateKey: false,
	csr: false,
};

export function GenerateCSRPage() {
	const [privateKeyWithCSR, setPrivateKeyWithCSR] = useState<PrivateKeyWithCSR | null>(null);
	const [downloadedStatus, setDownloadedStatus] = useState(INITIAL_DOWNLOADED_STATUS);

	const setPrivateKeyIsDownloaded = () => {
		setDownloadedStatus((status) => ({ ...status, privateKey: true }));
	};

	const setCSRIsDownloaded = () => {
		setDownloadedStatus((status) => ({ ...status, csr: true }));
	};

	const resetDownloadedStatus = () => {
		setDownloadedStatus(INITIAL_DOWNLOADED_STATUS);
	};

	useEffect(() => {
		if (!privateKeyWithCSR) {
			return;
		}
		const needsPrivate = privateKeyWithCSR.privateKeyPem !== null;
		if (downloadedStatus.csr && (!needsPrivate || downloadedStatus.privateKey)) {
			setPrivateKeyWithCSR(null);
		}
	}, [downloadedStatus, privateKeyWithCSR]);

	// privateKeyWithCSR se limpia al guardar todo: si sigue presente, algo quedó sin guardar.
	useEffect(() => {
		if (!privateKeyWithCSR) {
			return;
		}
		const privateKeyPending = privateKeyWithCSR.privateKeyPem !== null && !downloadedStatus.privateKey;
		const message = privateKeyPending
			? "Aún no guardas la Private Key. Si cierras ahora se perderá y el certificado que solicites con este CSR no servirá."
			: "Aún no guardas el CSR. Si cierras ahora tendrás que generar uno nuevo.";

		const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
			const close = await ask(message, {
				title: "¿Cerrar sin guardar?",
				kind: "warning",
				okLabel: "Cerrar de todos modos",
				cancelLabel: "Volver",
			});
			if (!close) {
				event.preventDefault();
			}
		});
		return () => {
			void unlisten.then((stop) => stop());
		};
	}, [downloadedStatus, privateKeyWithCSR]);

	return (
		<Layout>
			<div className="mb-10">
				<h1 className="text-primary font-bold text-2xl text-center mb-2">Generador de CSR</h1>
				<p className="text-center">
					Genera un CSR para solicitar un certificado de agente automatizado de la autoridad de certificación FirmEasy
				</p>
			</div>
			<div className="flex gap-10">
				<GenerateCSRForm
					className="w-[480px] shrink-0"
					privateKeyWithCSR={privateKeyWithCSR}
					setPrivateKeyWithCSR={setPrivateKeyWithCSR}
					downloadedStatus={downloadedStatus}
					resetDownloadedStatus={resetDownloadedStatus}
				/>
				<CSRGenerationResult
					className="flex-1 min-w-0"
					privateKeyWithCSR={privateKeyWithCSR}
					privateKeyDownloaded={downloadedStatus.privateKey}
					setPrivateKeyIsDownloaded={setPrivateKeyIsDownloaded}
					setCSRIsDownloaded={setCSRIsDownloaded}
				/>
			</div>
		</Layout>
	);
}
