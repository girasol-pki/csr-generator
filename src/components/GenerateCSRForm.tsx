import { Dispatch, SetStateAction, useMemo, useState } from "react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "./ui/form";
import { ChevronDownIcon, ChevronRightIcon, FolderOpenIcon, InfoIcon, LoaderIcon, RefreshCwIcon, ShieldIcon, ZapIcon } from "lucide-react";

import { Button } from "./ui/button"
import { Input } from "./ui/input";
import { PKCS11Slot, PrivateKeyWithCSR } from "@/models";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type DownloadedStatus = {
	privateKey: boolean,
	csr: boolean,
}

type CSRGenerationParams = {
	country: string,
	state: string,
	locality: string,
	organization: string,
	organizationUnit: string,
	street: string,
	email: string,
	commonName: string,
	modulusLength: number,
}

type PKCS11CSRGenerationParams = CSRGenerationParams & {
	driverPath: string,
	slotId: number,
	pin: string,
	keyLabel: string,
}

const baseSchema = {
	country: z.string().length(2),
	region: z.string().min(1, "Este campo es requerido"),
	province: z.string().min(1, "Este campo es requerido"),
	district: z.string().min(1, "Este campo es requerido"),
	organization: z.string().min(1, "Este campo es requerido"),
	organizationUnit: z.string().min(1, "Este campo es requerido"),
	street: z.string().min(1, "Este campo es requerido"),
	email: z.string().email("El email ingresado no es válido"),
	commonName: z.string().min(1, "Este campo es requerido"),
	modulusLength: z.string().refine((value) => ["2048", "3072"].includes(value), {
		message: "El tamaño de clave debe ser 2048 o 3072",
	}),
}

const formSchema = z
	.object({
		...baseSchema,
		pkcs11Enabled: z.boolean(),
		driverPath: z.string(),
		slotId: z.string(),
		pin: z.string(),
		keyLabel: z.string(),
	})
	.superRefine((values, ctx) => {
		if (!values.pkcs11Enabled) return;
		if (!values.driverPath) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["driverPath"], message: "Selecciona un driver PKCS#11" })
		}
		if (!values.slotId) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slotId"], message: "Selecciona un slot" })
		}
		if (!values.pin) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pin"], message: "Ingresa el PIN del token" })
		}
		if (!values.keyLabel || values.keyLabel.trim().length === 0) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["keyLabel"], message: "Ingresa una etiqueta para la llave" })
		}
	})


type GeneratedPrivateKeyWithCSR = {
	base64_private_key_pem: string,
	base64_csr_pem: string,
}

type GeneratedCSROnly = {
	base64_csr_pem: string,
}

type GenerationError = {
	message: string,
}

type Props = {
	className?: string,
	privateKeyWithCSR: PrivateKeyWithCSR | null,
	setPrivateKeyWithCSR: Dispatch<SetStateAction<PrivateKeyWithCSR | null>>,
	downloadedStatus: DownloadedStatus,
	resetDownloadedStatus: () => void,
}

export function GenerateCSRForm({
	className,
	privateKeyWithCSR,
	setPrivateKeyWithCSR,
	downloadedStatus,
	resetDownloadedStatus,
}: Props) {
	const canGenerateNewCSR = useMemo(() => {
		if (!privateKeyWithCSR) return true;
		const needsPrivate = privateKeyWithCSR.privateKeyPem !== null;
		return downloadedStatus.csr && (!needsPrivate || downloadedStatus.privateKey);
	}, [downloadedStatus, privateKeyWithCSR])

	//! useTransition doesn't work with Tauri yet
	// const [isGenerating, startGeneration] = useTransition();
	const [isGenerating, setIsGenerating] = useState(false);
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const [slots, setSlots] = useState<PKCS11Slot[]>([]);
	const [isListingSlots, setIsListingSlots] = useState(false);

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			country: "PE",
			region: "",
			province: "",
			district: "",
			organization: "",
			organizationUnit: "",
			street: "",
			email: "",
			commonName: "",
			modulusLength: "2048",
			pkcs11Enabled: false,
			driverPath: "",
			slotId: "",
			pin: "",
			keyLabel: "firmeasy-key",
		},
	})

	const pkcs11Enabled = form.watch("pkcs11Enabled");
	const driverPath = form.watch("driverPath");

	async function pickDriver() {
		const selected = await openFileDialog({
			multiple: false,
			directory: false,
			filters: [
				{ name: "Drivers PKCS#11", extensions: ["dll", "so", "dylib"] },
				{ name: "Todos", extensions: ["*"] },
			],
		});
		if (typeof selected !== "string") return;
		form.setValue("driverPath", selected, { shouldValidate: true });
		form.setValue("slotId", "");
		setSlots([]);
	}

	async function listSlots() {
		const path = form.getValues("driverPath");
		if (!path) return;
		setIsListingSlots(true);
		try {
			const result = await invoke<PKCS11Slot[]>("list_pkcs11_slots", {
				params: { driverPath: path },
			});
			setSlots(result);
			if (result.length === 0) {
				toast.warning("No se encontraron slots con token en este driver", { closeButton: true });
			}
		} catch (error) {
			const err = error as GenerationError;
			toast.error("No se pudieron listar los slots", { description: err.message, closeButton: true });
			setSlots([]);
		} finally {
			setIsListingSlots(false);
		}
	}

	async function generateCSR(data: CSRGenerationParams) {
		setIsGenerating(true);
		await new Promise(resolve => setTimeout(resolve, 150));

		const response = await invoke<GeneratedPrivateKeyWithCSR>("generate_csr", {
			data
		})
			.catch((error: GenerationError) => {
				toast.error("Ocurrió un error al intentar generar el CSR", {
					description: error.message,
					closeButton: true,
				})
				setIsGenerating(false);
			})

		if (!response) return;

		const privateKeyPem = globalThis.atob(response.base64_private_key_pem);
		const csrPem = globalThis.atob(response.base64_csr_pem);

		setPrivateKeyWithCSR({
			privateKeyPem,
			csrPem,
		});

		toast.success("CSR generado correctamente", {
			description: "Debes descargar la Private Key y el CSR antes de volver a generar un CSR",
			closeButton: true,
		});

		setIsGenerating(false);
	}

	async function generateCSRPkcs11(data: PKCS11CSRGenerationParams) {
		setIsGenerating(true);
		await new Promise(resolve => setTimeout(resolve, 150));

		const response = await invoke<GeneratedCSROnly>("generate_csr_pkcs11", {
			data,
		}).catch((error: GenerationError) => {
			toast.error("Ocurrió un error al generar el CSR con PKCS#11", {
				description: error.message,
				closeButton: true,
			});
			setIsGenerating(false);
		});

		if (!response) return;

		const csrPem = globalThis.atob(response.base64_csr_pem);

		setPrivateKeyWithCSR({
			privateKeyPem: null,
			csrPem,
		});

		toast.success("CSR generado en el token correctamente", {
			description: "La llave privada permanece en el token. Descarga el CSR para continuar.",
			closeButton: true,
		});

		setIsGenerating(false);
	}

	async function onSubmit(values: z.infer<typeof formSchema>) {
		const csrData: CSRGenerationParams = {
			country: values.country,
			state: `${values.region}-${values.province}`,
			locality: values.district,
			organization: values.organization,
			organizationUnit: values.organizationUnit,
			street: values.street,
			email: values.email,
			commonName: values.commonName,
			modulusLength: Number(values.modulusLength),
		}

		if (values.pkcs11Enabled) {
			await generateCSRPkcs11({
				...csrData,
				driverPath: values.driverPath,
				slotId: Number(values.slotId),
				pin: values.pin,
				keyLabel: values.keyLabel.trim(),
			});
		} else {
			await generateCSR(csrData);
		}
		resetDownloadedStatus();
	}

	return (
		<Form {...form} >
			<form className={cn(className, "space-y-6")} onSubmit={form.handleSubmit(onSubmit)}>
				<div className="grid grid-cols-10 gap-6">
					<FormField
						control={form.control}
						name="modulusLength"
						render={({ field }) => (
							<FormItem className="col-span-10">
								<FormLabel>Tamaño de clave</FormLabel>
								<Select onValueChange={field.onChange} value={field.value}>
									<FormControl>
										<SelectTrigger>
											<SelectValue
												placeholder="Selecciona un tamaño de clave"
											/>
										</SelectTrigger>
									</FormControl>
									<SelectContent>
										<SelectItem className="text-sm" key="2048" value={"2048"}>2048</SelectItem>
										<SelectItem className="text-sm" key="3072" value={"3072"}>3072</SelectItem>
									</SelectContent>
								</Select>
								<FormMessage />
							</FormItem>
						)}
					/>

					<FormField
						control={form.control}
						name="country"
						render={({ field }) => (
							<FormItem className="col-span-2">
								<FormLabel>País</FormLabel>
								<FormControl>
									<Input {...field} value="PE" readOnly />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name="commonName"
						render={({ field }) => (
							<FormItem className="col-span-8">
								<FormLabel>Nombre Común</FormLabel>
								<FormControl>
									<Input {...field} placeholder="FirmEasy" />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
				</div>
				<div className="grid grid-cols-3 gap-6">
					<FormField
						control={form.control}
						name="region"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Región</FormLabel>
								<FormControl>
									<Input {...field} placeholder="Lima" />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name="province"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Provincia</FormLabel>
								<FormControl>
									<Input {...field} placeholder="Lima" />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name="district"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Distrito</FormLabel>
								<FormControl>
									<Input {...field} placeholder="San Isidro" />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
				</div>
				<FormField
					control={form.control}
					name="organization"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Organización</FormLabel>
							<FormControl>
								<Input {...field} placeholder="Girasol S.C.R.L" />
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="organizationUnit"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Unidad Organizacional</FormLabel>
							<FormControl>
								<Input {...field} placeholder="Contabilidad" />
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="street"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Dirección</FormLabel>
							<FormControl>
								<Input {...field} placeholder="Av. Javier Prado Este 1234" />
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="email"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Email</FormLabel>
							<FormControl>
								<Input {...field} type="email" placeholder="usuario@dominio.com" />
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>

				<div className="border border-dashed border-muted-foreground/30 rounded-md">
					<button
						type="button"
						className="flex items-center w-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground select-none"
						onClick={() => setAdvancedOpen((v) => !v)}
					>
						{advancedOpen
							? <ChevronDownIcon className="w-4 h-4 me-2 flex-shrink-0" />
							: <ChevronRightIcon className="w-4 h-4 me-2 flex-shrink-0" />}
						<ShieldIcon className="w-4 h-4 me-2 flex-shrink-0" />
						<span>Modo avanzado: generar llave en token PKCS#11</span>
					</button>
					{advancedOpen && (
						<div className="px-4 pb-4 pt-1 space-y-4 border-t border-muted-foreground/20">
							<p className="flex text-xs text-muted-foreground leading-4">
								<InfoIcon className="w-4 h-4 me-2 flex-shrink-0 mt-px" />
								La llave privada se genera dentro del token y nunca sale del dispositivo. Solo se podrá descargar el CSR.
							</p>

							<FormField
								control={form.control}
								name="pkcs11Enabled"
								render={({ field }) => (
									<FormItem>
										<label className="flex items-center gap-2 cursor-pointer text-sm">
											<input
												type="checkbox"
												checked={field.value}
												onChange={(e) => field.onChange(e.target.checked)}
												className="h-4 w-4"
											/>
											<span>Usar PKCS#11 para esta generación</span>
										</label>
										<FormMessage />
									</FormItem>
								)}
							/>

							{pkcs11Enabled && (
								<>
									<FormField
										control={form.control}
										name="driverPath"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Driver PKCS#11</FormLabel>
												<div className="flex gap-2">
													<FormControl>
														<Input
															{...field}
															readOnly
															placeholder="Selecciona un .dll / .so / .dylib"
														/>
													</FormControl>
													<Button type="button" variant="outline" onClick={pickDriver}>
														<FolderOpenIcon className="w-4 h-4 me-2" />
														<span>Seleccionar</span>
													</Button>
												</div>
												<FormMessage />
											</FormItem>
										)}
									/>

									<FormField
										control={form.control}
										name="slotId"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Slot / token</FormLabel>
												<div className="flex gap-2">
													<Select
														onValueChange={field.onChange}
														value={field.value}
														disabled={slots.length === 0}
													>
														<FormControl>
															<SelectTrigger>
																<SelectValue
																	placeholder={slots.length === 0 ? "Lista los slots primero" : "Selecciona un slot"}
																/>
															</SelectTrigger>
														</FormControl>
														<SelectContent>
															{slots.map((slot) => (
																<SelectItem
																	key={slot.id}
																	value={String(slot.id)}
																	className="text-sm"
																>
																	[{slot.id}] {slot.label || slot.model || "Token"} — {slot.manufacturer}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
													<Button
														type="button"
														variant="outline"
														disabled={!driverPath || isListingSlots}
														onClick={listSlots}
													>
														{isListingSlots
															? <LoaderIcon className="w-4 h-4 me-2 animate-spin" />
															: <RefreshCwIcon className="w-4 h-4 me-2" />}
														<span>Listar</span>
													</Button>
												</div>
												<FormMessage />
											</FormItem>
										)}
									/>

									<FormField
										control={form.control}
										name="pin"
										render={({ field }) => (
											<FormItem>
												<FormLabel>PIN del token</FormLabel>
												<FormControl>
													<Input
														{...field}
														type="password"
														autoComplete="off"
														placeholder="••••••"
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>

									<FormField
										control={form.control}
										name="keyLabel"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Etiqueta de la llave</FormLabel>
												<FormControl>
													<Input {...field} placeholder="firmeasy-key" />
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
								</>
							)}
						</div>
					)}
				</div>

				<Button
					type="submit"
					disabled={isGenerating || (Boolean(privateKeyWithCSR) && !canGenerateNewCSR)}
					className="flex px-6 dark:text-gray-100 hover:dark:text-gray-50 select-none w-full"
				>
					{
						isGenerating
							? <LoaderIcon className="w-5 h-5 me-2 flex-shrink-0 animate-spin" />
							: <ZapIcon className="w-5 h-5 me-2 flex-shrink-0" />
					}
					<span className="block text-lg leading-6">
						{pkcs11Enabled ? "Generar CSR con PKCS#11" : "Generar CSR"}
					</span>
				</Button>
				<span className="flex text-sm text-muted leading-4 text-pretty">
					<InfoIcon className="inline w-4 h-4 flex-shrink-0 me-2" />
					Al generar el CSR das fe de que los datos ingresados son correctos y que tienes autorización para solicitar un certificado de FirmEasy.
				</span>
			</form>
		</Form>
	)
}
