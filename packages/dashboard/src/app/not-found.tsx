import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <h2 className="text-lg font-semibold text-foreground">Page not found</h2>
      <p className="text-sm text-muted-foreground">The page you requested does not exist.</p>
      <Link
        href="/"
        className="rounded-md border border-border bg-background px-4 py-2 text-sm hover:bg-accent"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
