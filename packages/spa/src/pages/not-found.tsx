import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold text-foreground">Page not found</h1>
      <p className="text-sm text-muted-foreground">The page you requested does not exist.</p>
      <Link
        to="/"
        className="text-sm font-medium text-primary hover:underline"
      >
        Go to dashboard
      </Link>
    </div>
  );
}
