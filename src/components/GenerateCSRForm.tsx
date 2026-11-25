import { zodResolver } from "@hookform/resolvers/zod";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
	ChevronDownIcon,
	ChevronRightIcon,
	FolderOpenIcon,
	InfoIcon,
	LoaderIcon,
	RefreshCwIcon,
	SlidersHorizontalIcon,
	ZapIcon,
} from "lucide-react";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";
import { type FieldErrors, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { parseInvokeError } from "@/csr/invoke-error";
import {
	type CSRGenerationParams,
	csrParamsOf,
	type FormValues,
	fieldsToRevalidate,
	formSchema,
	isLimitedField,
	type PKCS11CSRGenerationParams,
	pkcs11ParamsOf,
} from "@/csr/subject-form";
import { cn } from "@/lib/utils";
import type { PKCS11Slot, PrivateKeyWithCSR } from "@/models";
import { Button } from "./ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "./ui/form";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type DownloadedStatus = {
	privateKey: boolean;
	csr: boolean;
};

const generatedPrivateKeyWithCSRSchema = z.object({
	base64_private_key_pem: z.string(),
	base64_csr_pem: z.string(),
});

const generatedCSROnlySchema = z.object({
	base64_csr_pem: z.string(),
});

const slotsSchema = z.array(
	z.object({
		id: z.number(),
		label: z.string(),
		manufacturer: z.string(),
		model: z.string(),
		serial_number: z.string(),
		initialized: z.boolean(),
		login_required: z.boolean(),
	}),
);

const advancedFields: ReadonlyArray<keyof FormValues> = ["modulusLength", "driverPath", "slotId", "pin", "keyLabel"];

type Props = {
	className?: string;
	privateKeyWithCSR: PrivateKeyWithCSR | null;
	setPrivateKeyWithCSR: Dispatch<SetStateAction<PrivateKeyWithCSR | null>>;
	downloadedStatus: DownloadedStatus;
	resetDownloadedStatus: () => void;
};

export function GenerateCSRForm({
	className,
	privateKeyWithCSR,
	setPrivateKeyWithCSR,
	downloadedStatus,
	resetDownloadedStatus,
}: Props) {
	const canGenerateNewCSR = useMemo(() => {
		if (!privateKeyWithCSR) {
			return true;
		}
		const needsPrivate = privateKeyWithCSR.privateKeyPem !== null;
		return downloadedStatus.csr && (!needsPrivate || downloadedStatus.privateKey);
	}, [downloadedStatus, privateKeyWithCSR]);

	//! useTransition doesn't work with Tauri yet
	// const [isGenerating, startGeneration] = useTransition();
	const [isGenerating, setIsGenerating] = useState(false);
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const [slots, setSlots] = useState<PKCS11Slot[]>([]);
	const [isListingSlots, setIsListingSlots] = useState(false);

	const form = useForm<FormValues>({
		resolver: zodResolver(formSchema),
		mode: "onTouched",
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
	});

	// El resto de errores aparece al salir del campo; pasarse del límite se avisa en el acto
	// para no dejar escribir de más sin aviso.
	useEffect(() => {
		const subscription = form.watch((values, { name, type }) => {
			if (type !== "change" || !name || !isLimitedField(name)) {
				return;
			}
			const targets = fieldsToRevalidate(name, values, (field) => form.getFieldState(field).invalid);
			if (targets.length > 0) {
				void form.trigger(targets);
			}
		});
		return () => subscription.unsubscribe();
	}, [form]);

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
		if (typeof selected !== "string") {
			return;
		}
		form.setValue("driverPath", selected, { shouldValidate: true });
		form.setValue("slotId", "");
		setSlots([]);
	}

	// Las opciones avanzadas viven en un panel colapsable: si el error es de una de ellas, se abre para que se vea.
	function revealFieldsWithErrors(fields: ReadonlyArray<keyof FormValues>) {
		if (fields.some((field) => advancedFields.includes(field))) {
			setAdvancedOpen(true);
		}
	}

	function reportFailure(title: string, error: unknown) {
		const failure = parseInvokeError(error);
		if (failure.kind === "field") {
			revealFieldsWithErrors([failure.field]);
			form.setError(failure.field, { type: "server", message: failure.message }, { shouldFocus: true });
		}
		toast.error(title, { description: failure.message, closeButton: true });
	}

	function onInvalid(errors: FieldErrors<FormValues>) {
		revealFieldsWithErrors(advancedFields.filter((field) => field in errors));
	}

	async function listSlots() {
		const path = form.getValues("driverPath");
		if (!path) {
			return;
		}
		setIsListingSlots(true);
		try {
			const result: PKCS11Slot[] = slotsSchema.parse(
				await invoke("list_pkcs11_slots", { params: { driverPath: path } }),
			);
			setSlots(result);
			if (result.length === 0) {
				toast.warning("No se encontraron slots con token en este driver", { closeButton: true });
			}
		} catch (error) {
			reportFailure("No se pudieron listar los slots", error);
			setSlots([]);
		} finally {
			setIsListingSlots(false);
		}
	}

	async function generateCSR(data: CSRGenerationParams) {
		setIsGenerating(true);
		await new Promise((resolve) => setTimeout(resolve, 150));

		try {
			const response = generatedPrivateKeyWithCSRSchema.parse(await invoke("generate_csr", { data }));

			setPrivateKeyWithCSR({
				privateKeyPem: globalThis.atob(response.base64_private_key_pem),
				csrPem: globalThis.atob(response.base64_csr_pem),
				generatedAt: new Date(),
			});

			toast.success("CSR generado correctamente", {
				description: "Guarda la Private Key y después el CSR antes de generar otro",
				closeButton: true,
			});
		} catch (error) {
			reportFailure("Ocurrió un error al intentar generar el CSR", error);
		} finally {
			setIsGenerating(false);
		}
	}

	async function generateCSRPkcs11(data: PKCS11CSRGenerationParams) {
		setIsGenerating(true);
		await new Promise((resolve) => setTimeout(resolve, 150));

		try {
			const response = generatedCSROnlySchema.parse(await invoke("generate_csr_pkcs11", { data }));

			setPrivateKeyWithCSR({
				privateKeyPem: null,
				csrPem: globalThis.atob(response.base64_csr_pem),
				generatedAt: new Date(),
			});

			toast.success("CSR generado en el token correctamente", {
				description: "La llave privada permanece en el token. Guarda el CSR para continuar.",
				closeButton: true,
			});
		} catch (error) {
			reportFailure("Ocurrió un error al generar el CSR con PKCS#11", error);
		} finally {
			setIsGenerating(false);
		}
	}

	async function onSubmit(values: FormValues) {
		if (values.pkcs11Enabled) {
			await generateCSRPkcs11(pkcs11ParamsOf(values));
		} else {
			await generateCSR(csrParamsOf(values));
		}
		resetDownloadedStatus();
	}

	return (
		<Form {...form}>
			<form className={cn(className, "space-y-6")} onSubmit={form.handleSubmit(onSubmit, onInvalid)}>
				<div className="grid grid-cols-10 gap-6">
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
						{advancedOpen ? (
							<ChevronDownIcon className="w-4 h-4 me-2 shrink-0" />
						) : (
							<ChevronRightIcon className="w-4 h-4 me-2 shrink-0" />
						)}
						<SlidersHorizontalIcon className="w-4 h-4 me-2 shrink-0" />
						<span>Opciones avanzadas</span>
					</button>
					{advancedOpen && (
						<div className="px-4 pb-4 pt-1 space-y-4 border-t border-muted-foreground/20">
							<FormField
								control={form.control}
								name="modulusLength"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Tamaño de la llave RSA</FormLabel>
										<Select onValueChange={field.onChange} value={field.value}>
											<FormControl>
												<SelectTrigger>
													<SelectValue placeholder="Selecciona un tamaño" />
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												<SelectItem className="text-sm" value="2048">
													2048 bits (recomendado)
												</SelectItem>
												<SelectItem className="text-sm" value="3072">
													3072 bits
												</SelectItem>
											</SelectContent>
										</Select>
										<FormMessage />
									</FormItem>
								)}
							/>

							<p className="flex text-xs text-muted-foreground leading-4">
								<InfoIcon className="w-4 h-4 me-2 shrink-0 mt-px" />
								La llave privada se genera dentro del token y nunca sale del dispositivo. Solo se guardará el CSR.
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
														<Input {...field} readOnly placeholder="Selecciona un .dll / .so / .dylib" />
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
													<Select onValueChange={field.onChange} value={field.value} disabled={slots.length === 0}>
														<FormControl>
															<SelectTrigger>
																<SelectValue
																	placeholder={slots.length === 0 ? "Lista los slots primero" : "Selecciona un slot"}
																/>
															</SelectTrigger>
														</FormControl>
														<SelectContent>
															{slots.map((slot) => (
																<SelectItem key={slot.id} value={String(slot.id)} className="text-sm">
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
														{isListingSlots ? (
															<LoaderIcon className="w-4 h-4 me-2 animate-spin" />
														) : (
															<RefreshCwIcon className="w-4 h-4 me-2" />
														)}
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
													<Input {...field} type="password" autoComplete="off" placeholder="••••••" />
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
					className="flex px-6 dark:text-gray-100 dark:hover:text-gray-50 select-none w-full"
				>
					{isGenerating ? (
						<LoaderIcon className="w-5 h-5 me-2 shrink-0 animate-spin" />
					) : (
						<ZapIcon className="w-5 h-5 me-2 shrink-0" />
					)}
					<span className="block text-lg leading-6">{pkcs11Enabled ? "Generar CSR con PKCS#11" : "Generar CSR"}</span>
				</Button>
				<span className="flex text-sm text-muted leading-4 text-pretty">
					<InfoIcon className="inline w-4 h-4 shrink-0 me-2" />
					Al generar el CSR das fe de que los datos ingresados son correctos y que tienes autorización para solicitar un
					certificado de FirmEasy.
				</span>
			</form>
		</Form>
	);
}
