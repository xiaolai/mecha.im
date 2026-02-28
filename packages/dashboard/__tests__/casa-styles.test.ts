import { describe, it, expect } from "vitest";
import { stateStyles } from "../src/lib/casa-styles.js";

describe("stateStyles", () => {
  it("maps running state to success styles", () => {
    expect(stateStyles.running).toEqual({ dot: "bg-success", badge: "success" });
  });

  it("maps stopped state to secondary styles", () => {
    expect(stateStyles.stopped).toEqual({ dot: "bg-muted-foreground", badge: "secondary" });
  });

  it("maps error state to destructive styles", () => {
    expect(stateStyles.error).toEqual({ dot: "bg-destructive", badge: "destructive" });
  });
});
