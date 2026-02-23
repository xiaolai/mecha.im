"use client";

import { ThreadPrimitive, SuggestionPrimitive } from "@assistant-ui/react";
import { Button } from "@/components/ui/button";
import type { FC } from "react";

const suggestions = [
  {
    prompt: "Review the codebase for security issues",
    title: "Review codebase security",
    description: "Scan for vulnerabilities and suggest fixes",
  },
  {
    prompt: "What files have changed recently?",
    title: "Recent changes",
    description: "Check git status and recent modifications",
  },
  {
    prompt: "Create an implementation plan for the next feature",
    title: "Plan next feature",
    description: "Design an architecture for new functionality",
  },
  {
    prompt: "Run the test suite and report results",
    title: "Run tests",
    description: "Execute tests and check coverage",
  },
];

export const WelcomeScreen: FC = () => {
  return (
    <div className="mx-auto my-auto flex w-full max-w-(--thread-max-width) grow flex-col">
      <div className="flex w-full grow flex-col items-center justify-center">
        <div className="flex size-full flex-col justify-center px-4">
          <h1 className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both font-semibold text-2xl duration-200">
            Hello there!
          </h1>
          <p className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-muted-foreground text-xl delay-75 duration-200">
            How can I help you today?
          </p>
        </div>
      </div>
      <div className="grid w-full grid-cols-1 sm:grid-cols-2 gap-2 pb-4">
        {suggestions.map((s) => (
          <ThreadPrimitive.Suggestion
            key={s.prompt}
            prompt={s.prompt}
            method="replace"
            autoSend
          >
            <SuggestionPrimitive.Trigger send asChild>
              <Button
                variant="ghost"
                className="h-auto w-full flex-col items-start justify-start gap-1 rounded-2xl border px-4 py-3 text-left text-sm transition-colors hover:bg-muted"
              >
                <span className="font-medium">{s.title}</span>
                <span className="text-muted-foreground">{s.description}</span>
              </Button>
            </SuggestionPrimitive.Trigger>
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
    </div>
  );
};
