"use client";

import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

export function RailFooter() {
  return (
    <div className="flex flex-col items-center gap-1 py-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" asChild>
            <Link href="/create">
              <PlusIcon className="size-4" />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">New Mecha</TooltipContent>
      </Tooltip>
      <ThemeToggle />
    </div>
  );
}
