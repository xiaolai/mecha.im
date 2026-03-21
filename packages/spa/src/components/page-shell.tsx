interface PageShellProps {
  title: string;
  children: React.ReactNode;
}

/** Page wrapper rendering a title heading and content area. */
export function PageShell({ title, children }: PageShellProps) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      {children}
    </div>
  );
}
