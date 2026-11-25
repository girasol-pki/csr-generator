export type PrivateKeyWithCSR = {
	privateKeyPem: string | null;
	csrPem: string;
};

export type PKCS11Slot = {
	id: number;
	label: string;
	manufacturer: string;
	model: string;
	serial_number: string;
	initialized: boolean;
	login_required: boolean;
};
