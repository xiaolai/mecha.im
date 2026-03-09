import * as React from "react";
import { Button, type ButtonProps } from "./button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

/** Props for TooltipIconButton, extending Button with a required tooltip string. */
interface TooltipIconButtonProps extends ButtonProps {
  tooltip: string;
}

/** Icon button wrapped in a tooltip for accessible labeling. */
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
