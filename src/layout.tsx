import "./globals.css";

import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { Header } from "./components/Header";
import { ThemeProvider } from "./components/theme-provider";
import { cn } from "./lib/utils";

type Props = {
	children: ReactNode;
	className?: string;
};

export function Layout({ children, className }: Props) {
	return (
		<ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
			<Header className="p-8 max-w-(--breakpoint-2xl) mx-auto" />
			<main className={cn("px-8 pt-2 pb-8 max-w-(--breakpoint-2xl) mx-auto", className)}>{children}</main>
			<Toaster richColors />
		</ThemeProvider>
	);
}
