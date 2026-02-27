"use client";

import * as React from "react";
import { Button, type ButtonProps } from "./button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

interface TooltipIconButtonProps extends ButtonProps {
  tooltip: string;
}

const TooltipIconButton = React.forwardRef<HTMLButtonElement, TooltipIconButtonProps>(
  ({ tooltip, children, ...props }, ref) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button ref={ref} aria-label={tooltip} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  ),
);
TooltipIconButton.displayName = "TooltipIconButton";

export { TooltipIconButton };
