"use client";

import { MechaEnv } from "@/components/MechaEnv";
import { MechaInspect } from "@/components/MechaInspect";
import { Separator } from "@/components/ui/separator";

interface InspectPanelProps {
  mechaId: string;
}

export function InspectPanel({ mechaId }: InspectPanelProps) {
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl">
      {/* Environment */}
      <div>
        <h3 className="text-sm font-medium mb-3">Environment Variables</h3>
        <div className="rounded-lg border border-border bg-card p-4">
          <MechaEnv mechaId={mechaId} />
        </div>
      </div>

      <Separator />

      {/* Raw Inspect */}
      <div>
        <h3 className="text-sm font-medium mb-3">Raw Docker Inspect</h3>
        <div className="rounded-lg border border-border bg-card p-4">
          <MechaInspect mechaId={mechaId} />
        </div>
      </div>
    </div>
  );
}
