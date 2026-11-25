import { isRouteErrorResponse, useRouteError } from "react-router";

function describe(error: unknown) {
	if (isRouteErrorResponse(error)) {
		return `${error.status} ${error.statusText}`;
	}
	if (error instanceof Error) {
		return error.message;
	}
	return "Error desconocido";
}

export function ErrorPage() {
	const error = useRouteError();

	return (
		<div id="error-page">
			<h1>Algo salió mal</h1>
			<p>Ocurrió un error inesperado.</p>
			<p>
				<i>{describe(error)}</i>
			</p>
		</div>
	);
}
