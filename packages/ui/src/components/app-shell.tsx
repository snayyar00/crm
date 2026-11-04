"use client";

import { Button } from "@crm/ui/components/button";
import { InkField } from "@crm/ui/components/ink-field";
import { Kbd } from "@crm/ui/components/kbd";
import Logo from "@crm/ui/components/logo";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
} from "@crm/ui/components/sheet";
import { cn } from "@crm/ui/lib/utils";
import { MenuIcon, SearchIcon } from "lucide-react";
import { Slot } from "radix-ui";
import type * as React from "react";
import { createContext, useContext, useMemo, useRef } from "react";

type AppShellNav = { close: () => void };

const AppShellNavContext = createContext<AppShellNav>({ close: () => {} });

function useAppShellNav(): AppShellNav {
	return useContext(AppShellNavContext);
}

function Wordmark(props: React.ComponentProps<"span">) {
	return (
		<span className="flex items-center gap-2" {...props}>
			<Logo className="size-5" />
			<span className="font-semibold text-base tracking-tight">
				WebAbility
			</span>
		</span>
	);
}

function AppShellHome({
	asChild = false,
	className,
	children,
	onClick,
	...props
}: React.ComponentProps<"a"> & { asChild?: boolean }) {
	const Comp = asChild ? Slot.Root : "a";
	const { close } = useAppShellNav();

	return (
		<Comp
			data-slot="app-shell-home"
			className={cn(
				"flex shrink-0 items-center rounded-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
				className,
			)}
			{...props}
			onClick={(event) => {
				onClick?.(event);
				if (!event.defaultPrevented) close();
			}}
		>
			<Slot.Slottable>{children}</Slot.Slottable>
			<Wordmark aria-hidden />
		</Comp>
	);
}

function AppShellSearch({
	placeholder,
	label = "Search",
	shortcut = "⌘K",
	disabled = false,
	onOpen,
}: {
	placeholder: string;
	label?: string;
	shortcut?: string;
	disabled?: boolean;
	onOpen?: () => void;
}) {
	return (
		<>
			<button
				type="button"
				data-slot="app-shell-search"
				aria-label={label}
				aria-keyshortcuts="Meta+K Control+K"
				disabled={disabled}
				onClick={onOpen}
				className="hidden h-8 w-full max-w-md items-center gap-2 rounded-md bg-background px-2.5 text-muted-foreground text-sm shadow-border outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:shadow-focus disabled:pointer-events-none sm:flex"
			>
				<SearchIcon aria-hidden className="size-4 shrink-0" />
				<span className="flex-1 truncate text-left">{placeholder}</span>
				<Kbd>{shortcut}</Kbd>
			</button>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				aria-label={label}
				disabled={disabled}
				onClick={onOpen}
				className="sm:hidden"
			>
				<SearchIcon aria-hidden />
			</Button>
		</>
	);
}

function AppShell({
	sidebar,
	mobileSidebar,
	home,
	product,
	search,
	agent,
	end,
	navOpen,
	onNavOpenChange,
	children,
}: {
	sidebar: React.ReactNode;
	mobileSidebar?: React.ReactNode;
	home: React.ReactNode;
	product?: string;
	search?: React.ReactNode;
	agent?: React.ReactNode;
	end?: React.ReactNode;
	navOpen: boolean;
	onNavOpenChange: (open: boolean) => void;
	children: React.ReactNode;
}) {
	const menuRef = useRef<HTMLButtonElement>(null);
	const nav = useMemo(
		() => ({ close: () => onNavOpenChange(false) }),
		[onNavOpenChange],
	);

	return (
		<AppShellNavContext.Provider value={nav}>
			<div
				data-slot="app-shell"
				className="relative isolate flex h-svh min-h-0 bg-background md:bg-[var(--rail,#0c1712)]"
			>
				<InkField className="hidden w-64 md:block" />
				<div
					data-slot="app-shell-rail"
					className="shell-rail relative z-1 hidden w-58 shrink-0 flex-col md:flex [view-transition-name:app-rail]"
				>
					<div className="flex h-13 shrink-0 items-center gap-2.5 pl-5">
						{home}
						{product ? (
							<span className="border-l pl-2.5 font-medium text-[0.8125rem] text-muted-foreground">
								{product}
							</span>
						) : null}
					</div>
					{sidebar}
				</div>
				<div
					data-slot="app-shell-sheet"
					className="flex min-w-0 flex-1 flex-col bg-background md:shell-cut"
				>
					<svg
						aria-hidden
						data-slot="app-shell-cut-edge"
						className="pointer-events-none absolute inset-y-0 left-0 z-10 hidden h-full w-6 text-border md:dark:block"
					>
						<path
							d="M26 0.5Q22.17 0.5 19.15 2.85L3.47 15.03Q0.5 17.34 0.5 21.1V100000"
							fill="none"
							stroke="currentColor"
							strokeLinejoin="round"
							strokeWidth={1}
						/>
					</svg>
					<header
						data-slot="app-shell-top-bar"
						className="flex h-13 shrink-0 items-center gap-2 border-b px-2 md:px-4 [view-transition-name:app-header]"
					>
						<div className="flex shrink-0 items-center gap-1 md:hidden">
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								ref={menuRef}
								aria-label="Open navigation"
								aria-expanded={navOpen}
								onClick={() => onNavOpenChange(true)}
							>
								<MenuIcon aria-hidden />
							</Button>
							{home}
						</div>
						<div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:grid sm:grid-cols-[1fr_minmax(0,28rem)_1fr]">
							<div className="flex min-w-0 justify-center sm:col-start-2">
								{search}
							</div>
							<div className="flex items-center justify-end gap-2 sm:col-start-3">
								{agent}
								{end}
							</div>
						</div>
					</header>
					<div
						data-slot="app-shell-body"
						className="flex min-h-0 min-w-0 flex-1"
					>
						{children}
					</div>
				</div>
			</div>
			<Sheet open={navOpen} onOpenChange={onNavOpenChange}>
				<SheetContent
					side="left"
					showCloseButton={false}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						menuRef.current?.focus();
					}}
					className="w-72 gap-0 overflow-hidden bg-background p-0 text-foreground md:hidden"
				>
					<div className="flex min-h-0 flex-1 flex-col pt-2">
						<SheetTitle className="sr-only">Navigation</SheetTitle>
						<SheetDescription className="sr-only">
							Move between the pages of this workspace.
						</SheetDescription>
						{mobileSidebar ?? sidebar}
					</div>
				</SheetContent>
			</Sheet>
		</AppShellNavContext.Provider>
	);
}

export { AppShell, AppShellHome, AppShellSearch, useAppShellNav };
