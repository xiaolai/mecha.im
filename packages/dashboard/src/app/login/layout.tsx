"use client";

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      {children}
    </div>
  );
}
