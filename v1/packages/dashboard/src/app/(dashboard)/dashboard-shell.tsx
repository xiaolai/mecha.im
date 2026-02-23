"use client";

import { useEffect } from "react";
import { MechaRail } from "@/components/rail/MechaRail";
import { SessionsPanel } from "@/components/sessions/SessionsPanel";
import { TopBar } from "@/components/layout/TopBar";
import { EventStreamProvider } from "@/components/EventStreamProvider";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useDashboardStore } from "@/lib/store";
import { useIsMobile } from "@/hooks/use-mobile";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const sessionsPanelOpen = useDashboardStore((s) => s.sessionsPanelOpen);
  const setSessionsPanelOpen = useDashboardStore((s) => s.setSessionsPanelOpen);
  const isMobile = useIsMobile();

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      // Cmd+B: toggle sessions panel on mobile
      if (e.key === "b") {
        e.preventDefault();
        setSessionsPanelOpen(!sessionsPanelOpen);
      }

      // Cmd+/: focus chat input
      if (e.key === "/") {
        e.preventDefault();
        const input = document.querySelector<HTMLTextAreaElement>(".aui-composer-input");
        input?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sessionsPanelOpen, setSessionsPanelOpen]);

  return (
    <EventStreamProvider>
      <div className="flex h-dvh overflow-hidden">
        {/* Rail - always visible */}
        <MechaRail />

        {/* Sessions Panel - sheet on mobile, resizable on desktop */}
        {isMobile ? (
          <>
            <Sheet open={sessionsPanelOpen} onOpenChange={setSessionsPanelOpen}>
              <SheetContent side="left" className="w-60 p-0 pt-0">
                <SessionsPanel />
              </SheetContent>
            </Sheet>
            <div className="flex flex-1 flex-col min-w-0">
              <TopBar />
              <main className="flex-1 overflow-auto">
                {children}
              </main>
            </div>
          </>
        ) : (
          <ResizablePanelGroup orientation="horizontal" className="flex-1">
            <ResizablePanel defaultSize="240px" minSize="180px" maxSize="400px">
              <SessionsPanel />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel minSize="50%">
              <div className="flex h-full flex-col min-w-0">
                <TopBar />
                <main className="flex-1 overflow-auto">
                  {children}
                </main>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
    </EventStreamProvider>
  );
}
