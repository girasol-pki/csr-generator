import { CSRGenerationResult } from "@/components/CSRGenerationResult";
import { GenerateCSRForm } from "@/components/GenerateCSRForm";
import { Layout } from "@/layout";
import { PrivateKeyWithCSR } from "@/models";
import { useEffect, useState } from "react";

const INITIAL_DOWNLOADED_STATUS = {
	privateKey: false,
	csr: false,
}

export function GenerateCSRPage() {
	const [privateKeyWithCSR, setPrivateKeyWithCSR] = useState<PrivateKeyWithCSR | null>(null)
	const [downloadedStatus, setDownloadedStatus] = useState(INITIAL_DOWNLOADED_STATUS)

	const setPrivateKeyIsDownloaded = () => {
		setDownloadedStatus({
			...downloadedStatus,
			privateKey: true,
		})
	}

	const setCSRIsDownloaded = () => {
		setDownloadedStatus({
			...downloadedStatus,
			csr: true,
		})
	}

	const resetDownloadedStatus = () => {
		setDownloadedStatus(INITIAL_DOWNLOADED_STATUS)
	}

	useEffect(() => {
		if (!privateKeyWithCSR) return;
		const needsPrivate = privateKeyWithCSR.privateKeyPem !== null;
		if (downloadedStatus.csr && (!needsPrivate || downloadedStatus.privateKey)) {
			setPrivateKeyWithCSR(null)
		}
	}, [downloadedStatus, privateKeyWithCSR])

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
					className="w-[480px] flex-shrink-0"
					privateKeyWithCSR={privateKeyWithCSR}
					setPrivateKeyWithCSR={setPrivateKeyWithCSR}
					downloadedStatus={downloadedStatus}
					resetDownloadedStatus={resetDownloadedStatus}
				/>
				<CSRGenerationResult
					className="flex-1 min-w-0"
					privateKeyWithCSR={privateKeyWithCSR}
					setPrivateKeyIsDownloaded={setPrivateKeyIsDownloaded}
					setCSRIsDownloaded={setCSRIsDownloaded}
				/>
			</div>
		</Layout>
	)
}