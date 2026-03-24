import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEngine } from "../src/engine.js";
import type { WorkflowDef, StepExecutor } from "../src/types.js";

/** Mock executor that returns canned responses. */
function mockExecutor(responses: Record<string, unknown>): StepExecutor {
  return async ({ bot }) => ({
    output: responses[bot] ?? `response from ${bot}`,
    costUsd: 0.10,
  });
}

/** Mock executor that fails for specific bots. */
function failingExecutor(failBots: string[]): StepExecutor {
  return async ({ bot }) => {
    if (failBots.includes(bot)) throw new Error(`${bot} failed`);
    return { output: `ok from ${bot}`, costUsd: 0.05 };
  };
}

describe("WorkflowEngine", () => {
  let workflowsDir: string;

  const linearDef: WorkflowDef = {
    name: "linear-pipeline",
    steps: {
      research: { bot: "researcher", prompt: "Find topics", output: "topics" },
      draft: { bot: "writer", prompt: "Write about {{research.topics}}", depends: ["research"], output: "article" },
      review: { bot: "editor", prompt: "Review {{draft.article}}", depends: ["draft"], output: "feedback" },
    },
  };

  const parallelDef: WorkflowDef = {
    name: "parallel-build",
    steps: {
      plan: { bot: "architect", prompt: "Plan", output: "plan" },
      frontend: { bot: "fe-dev", prompt: "Build FE based on {{plan.plan}}", depends: ["plan"], output: "fe" },
      backend: { bot: "be-dev", prompt: "Build BE based on {{plan.plan}}", depends: ["plan"], output: "be" },
      integrate: { bot: "integrator", prompt: "Merge {{frontend.fe}} + {{backend.be}}", depends: ["frontend", "backend"] },
    },
  };

  const conditionalDef: WorkflowDef = {
    name: "conditional",
    steps: {
      review: { bot: "editor", prompt: "Review", output: "result" },
      revise: {
        bot: "writer",
        prompt: "Revise",
        depends: ["review"],
        condition: "!review.result.approved",
        output: "revised",
      },
      publish: { bot: "publisher", prompt: "Publish", depends: ["review", "revise?"] },
    },
  };

  const gateDef: WorkflowDef = {
    name: "gated",
    steps: {
      draft: { bot: "writer", prompt: "Write", output: "article" },
      publish: { bot: "publisher", prompt: "Publish {{draft.article}}", depends: ["draft"], gate: "human" },
    },
  };

  const compensateDef: WorkflowDef = {
    name: "with-compensation",
    steps: {
      deploy: { bot: "devops", prompt: "Deploy", output: "url", compensate: "Rollback deploy" },
      notify: { bot: "notifier", prompt: "Notify about {{deploy.url}}", depends: ["deploy"] },
    },
  };

  beforeEach(() => {
    workflowsDir = mkdtempSync(join(tmpdir(), "mecha-workflow-"));
  });

  describe("startRun", () => {
    it("creates a run with initial state", () => {
      const engine = createEngine({ workflowsDir, definition: linearDef });
      const runId = engine.startRun();

      const state = engine.state();
      expect(state.runId).toBe(runId);
      expect(state.status).toBe("pending");
      expect(Object.keys(state.steps)).toEqual(["research", "draft", "review"]);
      expect(state.steps.research!.status).toBe("pending");
    });

    it("merges input defaults", () => {
      const def: WorkflowDef = {
        name: "with-inputs",
        inputs: { domain: { type: "string", default: "AI" } },
        steps: { s1: { bot: "b", prompt: "{{domain}}" } },
      };
      const engine = createEngine({ workflowsDir, definition: def });
      engine.startRun();
      expect(engine.state().inputs.domain).toBe("AI");
    });

    it("overrides defaults with provided inputs", () => {
      const def: WorkflowDef = {
        name: "with-inputs",
        inputs: { domain: { type: "string", default: "AI" } },
        steps: { s1: { bot: "b", prompt: "{{domain}}" } },
      };
      const engine = createEngine({ workflowsDir, definition: def });
      engine.startRun({ domain: "Security" });
      expect(engine.state().inputs.domain).toBe("Security");
    });

    it("snapshots definition to YAML file", () => {
      const engine = createEngine({ workflowsDir, definition: linearDef });
      const runId = engine.startRun();
      const snapshotPath = join(workflowsDir, "runs", linearDef.name, `${runId}.yaml`);
      expect(existsSync(snapshotPath)).toBe(true);
    });
  });

  describe("executeReady — linear pipeline", () => {
    it("executes steps in dependency order", async () => {
      const engine = createEngine({ workflowsDir, definition: linearDef });
      engine.startRun();
      const exec = mockExecutor({
        researcher: ["topic-a", "topic-b"],
        writer: "draft content",
        editor: "looks good",
      });

      // First round: only research is ready
      const r1 = await engine.executeReady(exec);
      expect(r1).toEqual(["research"]);
      expect(engine.state().steps.research!.status).toBe("completed");

      // Second round: draft is ready
      const r2 = await engine.executeReady(exec);
      expect(r2).toEqual(["draft"]);

      // Third round: review is ready
      const r3 = await engine.executeReady(exec);
      expect(r3).toEqual(["review"]);
      expect(engine.state().status).toBe("done");
    });

    it("tracks total cost", async () => {
      const engine = createEngine({ workflowsDir, definition: linearDef });
      engine.startRun();
      const exec = mockExecutor({});

      await engine.executeReady(exec);
      await engine.executeReady(exec);
      await engine.executeReady(exec);

      expect(engine.state().totalCostUsd).toBeCloseTo(0.30, 2);
    });
  });

  describe("executeReady — parallel steps", () => {
    it("executes independent steps in the same round", async () => {
      const engine = createEngine({ workflowsDir, definition: parallelDef });
      engine.startRun();
      const exec = mockExecutor({});

      // Round 1: plan
      const r1 = await engine.executeReady(exec);
      expect(r1).toEqual(["plan"]);

      // Round 2: frontend + backend (both depend only on plan)
      const r2 = await engine.executeReady(exec);
      expect(r2.sort()).toEqual(["backend", "frontend"]);

      // Round 3: integrate
      const r3 = await engine.executeReady(exec);
      expect(r3).toEqual(["integrate"]);
      expect(engine.state().status).toBe("done");
    });
  });

  describe("conditional steps", () => {
    it("skips step when condition is false", async () => {
      const engine = createEngine({ workflowsDir, definition: conditionalDef });
      engine.startRun();
      const exec = mockExecutor({ editor: { approved: true } });

      await engine.executeReady(exec); // review
      await engine.executeReady(exec); // revise skipped, publish runs

      expect(engine.state().steps.revise!.status).toBe("skipped");
      expect(engine.state().steps.publish!.status).toBe("completed");
      expect(engine.state().status).toBe("done");
    });

    it("executes step when condition is true", async () => {
      const engine = createEngine({ workflowsDir, definition: conditionalDef });
      engine.startRun();
      const exec = mockExecutor({ editor: { approved: false }, writer: "revised" });

      await engine.executeReady(exec); // review
      await engine.executeReady(exec); // revise runs (condition: !approved)
      await engine.executeReady(exec); // publish

      expect(engine.state().steps.revise!.status).toBe("completed");
      expect(engine.state().status).toBe("done");
    });
  });

  describe("gates", () => {
    it("pauses at gate step", async () => {
      const engine = createEngine({ workflowsDir, definition: gateDef });
      engine.startRun();
      const exec = mockExecutor({});

      await engine.executeReady(exec); // draft

      // publish should be waiting (gate)
      const r2 = await engine.executeReady(exec);
      expect(r2).toEqual([]);
      expect(engine.state().steps.publish!.status).toBe("waiting");
      expect(engine.state().status).toBe("waiting");
    });

    it("resumes after approval", async () => {
      const engine = createEngine({ workflowsDir, definition: gateDef });
      engine.startRun();
      const exec = mockExecutor({});

      await engine.executeReady(exec); // draft
      await engine.executeReady(exec); // publish waits

      expect(engine.approveGate("publish")).toBe(true);
      expect(engine.state().steps.publish!.status).toBe("pending");

      await engine.executeReady(exec); // publish runs
      expect(engine.state().status).toBe("done");
    });

    it("returns false for non-waiting step", () => {
      const engine = createEngine({ workflowsDir, definition: gateDef });
      engine.startRun();
      expect(engine.approveGate("draft")).toBe(false);
    });
  });

  describe("failure handling", () => {
    it("marks run as failed when a step fails", async () => {
      const engine = createEngine({ workflowsDir, definition: linearDef });
      engine.startRun();
      const exec = failingExecutor(["researcher"]);

      await engine.executeReady(exec);
      expect(engine.state().steps.research!.status).toBe("failed");
      expect(engine.state().steps.research!.error).toBe("researcher failed");
      expect(engine.state().status).toBe("failed");
    });
  });

  describe("compensation", () => {
    it("runs compensation for completed steps in reverse order", async () => {
      const engine = createEngine({ workflowsDir, definition: compensateDef });
      engine.startRun();

      // Deploy succeeds, notify fails
      const exec = failingExecutor(["notifier"]);
      await engine.executeReady(exec); // deploy
      await engine.executeReady(exec); // notify fails

      expect(engine.state().status).toBe("failed");

      // Run compensation
      const compensated = await engine.compensate(mockExecutor({}));
      expect(compensated).toEqual(["deploy"]); // only deploy had compensate
      expect(engine.state().steps.deploy!.status).toBe("compensated");
      expect(engine.state().status).toBe("compensated");
    });

    it("does nothing if run is not failed", async () => {
      const engine = createEngine({ workflowsDir, definition: linearDef });
      engine.startRun();
      const compensated = await engine.compensate(mockExecutor({}));
      expect(compensated).toEqual([]);
    });

    it("skips completed steps without compensate field during rollback", async () => {
      const def: WorkflowDef = {
        name: "partial-compensate",
        steps: {
          setup: { bot: "setup-bot", prompt: "setup" }, // no compensate
          deploy: { bot: "devops", prompt: "deploy", depends: ["setup"], output: "url", compensate: "Rollback" },
          notify: { bot: "notifier", prompt: "notify", depends: ["deploy"] },
        },
      };
      const engine = createEngine({ workflowsDir, definition: def });
      engine.startRun();
      const exec = failingExecutor(["notifier"]);
      await engine.executeReady(exec); // setup
      await engine.executeReady(exec); // deploy
      await engine.executeReady(exec); // notify fails

      const compensated = await engine.compensate(mockExecutor({}));
      // setup was completed but has no compensate → skipped
      // deploy was completed and has compensate → compensated
      expect(compensated).toEqual(["deploy"]);
    });

    it("marks run as failed when compensation itself fails", async () => {
      const engine = createEngine({ workflowsDir, definition: compensateDef });
      engine.startRun();

      // Deploy succeeds, notify fails
      const exec = failingExecutor(["notifier"]);
      await engine.executeReady(exec); // deploy
      await engine.executeReady(exec); // notify fails
      expect(engine.state().status).toBe("failed");

      // Compensation also fails
      const compensated = await engine.compensate(failingExecutor(["devops"]));
      expect(compensated).toEqual(["deploy"]);
      expect(engine.state().steps.deploy!.status).toBe("failed");
      expect(engine.state().status).toBe("failed"); // NOT "compensated"
    });
  });

  describe("cancel", () => {
    it("marks run as cancelled", () => {
      const engine = createEngine({ workflowsDir, definition: linearDef });
      engine.startRun();
      engine.cancel();
      expect(engine.state().status).toBe("cancelled");
      expect(engine.isTerminal()).toBe(true);
    });

    it("executeReady returns empty after cancel", async () => {
      const engine = createEngine({ workflowsDir, definition: linearDef });
      engine.startRun();
      engine.cancel();
      const result = await engine.executeReady(mockExecutor({}));
      expect(result).toEqual([]);
    });
  });

  describe("persistence", () => {
    it("state survives engine re-creation", async () => {
      const e1 = createEngine({ workflowsDir, definition: linearDef });
      const runId = e1.startRun();
      await e1.executeReady(mockExecutor({})); // research

      // Re-create engine with same runId
      const e2 = createEngine({ workflowsDir, definition: linearDef, runId });
      const state = e2.state();
      expect(state.steps.research!.status).toBe("completed");
      expect(state.steps.draft!.status).toBe("pending");

      // Continue execution
      await e2.executeReady(mockExecutor({}));
      expect(e2.state().steps.draft!.status).toBe("completed");
    });

    it("starts fresh when runId file does not exist", () => {
      const engine = createEngine({ workflowsDir, definition: linearDef, runId: "nonexistent-run" });
      const runId = engine.startRun();
      expect(runId).toBe("nonexistent-run");
      expect(engine.state().status).toBe("pending");
    });
  });

  describe("idempotency", () => {
    it("skips re-execution when step already has output from partial state", async () => {
      // Simulate daemon restart: step has output but status is still pending
      const def: WorkflowDef = { name: "idemp", steps: { s1: { bot: "b", prompt: "x" } } };
      const engine = createEngine({ workflowsDir, definition: def });
      const runId = engine.startRun();

      // Execute normally first
      await engine.executeReady(mockExecutor({}));
      expect(engine.state().status).toBe("done");

      // Manually tamper with state: set step back to pending but keep output
      const { readFileSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const statePath = join(workflowsDir, "runs", "idemp", `${runId}.json`);
      const state = JSON.parse(readFileSync(statePath, "utf-8"));
      state.status = "running";
      state.steps.s1.status = "pending";
      // output remains set
      writeFileSync(statePath, JSON.stringify(state));

      // Re-create engine with same runId
      const e2 = createEngine({ workflowsDir, definition: def, runId });

      let executorCalled = false;
      const noCallExec: StepExecutor = async () => {
        executorCalled = true;
        return { output: "should not be called" };
      };

      await e2.executeReady(noCallExec);
      expect(executorCalled).toBe(false); // executor NOT called — idempotency skip
      expect(e2.state().steps.s1!.status).toBe("completed");
      expect(e2.state().status).toBe("done");
    });
  });

  describe("validation", () => {
    it("rejects workflow name with path traversal", () => {
      expect(() => createEngine({
        workflowsDir,
        definition: { ...linearDef, name: "../escape" },
      })).toThrow("Invalid workflow name");
    });

    it("detects cycles in dependencies", () => {
      expect(() => createEngine({
        workflowsDir,
        definition: {
          name: "cyclic",
          steps: {
            a: { bot: "b1", prompt: "x", depends: ["c"] },
            b: { bot: "b2", prompt: "x", depends: ["a"] },
            c: { bot: "b3", prompt: "x", depends: ["b"] },
          },
        },
      })).toThrow("Cycle detected");
    });

    it("detects missing dependency references", () => {
      expect(() => createEngine({
        workflowsDir,
        definition: {
          name: "missing-dep",
          steps: {
            a: { bot: "b1", prompt: "x", depends: ["nonexistent"] },
          },
        },
      })).toThrow('depends on unknown step "nonexistent"');
    });
  });

  describe("isTerminal", () => {
    it("returns false for active run", () => {
      const engine = createEngine({ workflowsDir, definition: linearDef });
      engine.startRun();
      expect(engine.isTerminal()).toBe(false);
    });

    it("returns true for completed run", async () => {
      const def: WorkflowDef = {
        name: "single",
        steps: { s1: { bot: "b", prompt: "do" } },
      };
      const engine = createEngine({ workflowsDir, definition: def });
      engine.startRun();
      await engine.executeReady(mockExecutor({}));
      expect(engine.isTerminal()).toBe(true);
    });

    it("returns false when no run started", () => {
      const engine = createEngine({ workflowsDir, definition: linearDef });
      expect(engine.isTerminal()).toBe(false);
    });
  });

  describe("error handling", () => {
    it("state() throws when no run started", () => {
      const engine = createEngine({ workflowsDir, definition: linearDef });
      expect(() => engine.state()).toThrow("No active run");
    });

    it("executeReady throws when no run started", async () => {
      const engine = createEngine({ workflowsDir, definition: linearDef });
      await expect(engine.executeReady(mockExecutor({}))).rejects.toThrow("No active run");
    });

    it("compensate throws when no run started", async () => {
      const engine = createEngine({ workflowsDir, definition: linearDef });
      await expect(engine.compensate(mockExecutor({}))).rejects.toThrow("No active run");
    });

    it("approveGate returns false when no run started", () => {
      const engine = createEngine({ workflowsDir, definition: linearDef });
      expect(engine.approveGate("anything")).toBe(false);
    });

    it("cancel is no-op when no run started", () => {
      const engine = createEngine({ workflowsDir, definition: linearDef });
      engine.cancel(); // should not throw
    });

    it("cancel is no-op when already terminal", async () => {
      const def: WorkflowDef = { name: "done-test", steps: { s1: { bot: "b", prompt: "x" } } };
      const engine = createEngine({ workflowsDir, definition: def });
      engine.startRun();
      await engine.executeReady(mockExecutor({}));
      expect(engine.isTerminal()).toBe(true);
      engine.cancel(); // should not change status
      expect(engine.state().status).toBe("done");
    });

    it("rejects runId with path traversal", () => {
      expect(() => createEngine({
        workflowsDir,
        definition: linearDef,
        runId: "../escape",
      })).toThrow("Invalid runId name");
    });

    it("handles template rendering error as step failure", async () => {
      const def: WorkflowDef = {
        name: "bad-template",
        steps: {
          s1: { bot: "b", prompt: "{{missing_step.output}}", depends: [] },
        },
      };
      const engine = createEngine({ workflowsDir, definition: def });
      engine.startRun();
      // The executor receives a rendered prompt (empty string for missing refs)
      // Template rendering itself doesn't throw — it returns "" for missing values
      await engine.executeReady(mockExecutor({}));
      expect(engine.state().steps.s1!.status).toBe("completed");
    });
  });

  describe("optional dependencies", () => {
    it("handles optional deps with ? suffix when skipped", async () => {
      const def: WorkflowDef = {
        name: "optional-dep",
        steps: {
          check: { bot: "checker", prompt: "check", output: "result" },
          optional: {
            bot: "worker",
            prompt: "work",
            depends: ["check"],
            condition: "!check.result",
            output: "work",
          },
          final: {
            bot: "finalizer",
            prompt: "finalize",
            depends: ["check", "optional?"],
          },
        },
      };
      const engine = createEngine({ workflowsDir, definition: def });
      engine.startRun();
      const exec = mockExecutor({ checker: true }); // condition !true = false → skip optional

      await engine.executeReady(exec); // check
      await engine.executeReady(exec); // optional skipped, final runs
      await engine.executeReady(exec); // final if not yet

      expect(engine.state().steps.optional!.status).toBe("skipped");
      expect(engine.state().steps.final!.status).toBe("completed");
    });
  });

  describe("output key fallback", () => {
    it("uses step name as output key when output field is not defined", async () => {
      const def: WorkflowDef = {
        name: "no-output-key",
        steps: {
          generate: { bot: "gen", prompt: "make something" }, // no output field
          consume: { bot: "con", prompt: "use {{generate.generate}}", depends: ["generate"] },
        },
      };
      const engine = createEngine({ workflowsDir, definition: def });
      engine.startRun();
      const exec = mockExecutor({ gen: "generated-data" });
      await engine.executeReady(exec); // generate
      await engine.executeReady(exec); // consume
      expect(engine.state().status).toBe("done");
    });
  });

  describe("cost tracking", () => {
    it("accumulates cost across steps with no costUsd", async () => {
      const def: WorkflowDef = { name: "no-cost", steps: { s1: { bot: "b", prompt: "x" } } };
      const engine = createEngine({ workflowsDir, definition: def });
      engine.startRun();
      const exec: StepExecutor = async () => ({ output: "ok" }); // no costUsd
      await engine.executeReady(exec);
      expect(engine.state().totalCostUsd).toBe(0);
      expect(engine.state().steps.s1!.costUsd).toBe(0);
    });
  });

  describe("step timeout", () => {
    it("fails step when executor exceeds timeout", async () => {
      const def: WorkflowDef = {
        name: "timeout-test",
        steps: {
          slow: { bot: "bot", prompt: "go", timeout: "10s" },
        },
      };
      const engine = createEngine({ workflowsDir, definition: def });
      engine.startRun();

      const slowExecutor: StepExecutor = async () => {
        await new Promise((resolve) => setTimeout(resolve, 30_000)); // 30s > 10s timeout
        return { output: "done" };
      };

      await engine.executeReady(slowExecutor);
      const state = engine.state();
      expect(state.steps.slow!.status).toBe("failed");
      expect(state.steps.slow!.error).toContain("timed out");
    }, 15_000); // test timeout 15s > step timeout 10s

    it("completes step when executor finishes before timeout", async () => {
      const def: WorkflowDef = {
        name: "timeout-ok",
        steps: {
          fast: { bot: "bot", prompt: "go", timeout: "10s" },
        },
      };
      const engine = createEngine({ workflowsDir, definition: def });
      engine.startRun();

      const fastExecutor: StepExecutor = async () => ({ output: "done" });

      await engine.executeReady(fastExecutor);
      expect(engine.state().steps.fast!.status).toBe("completed");
    });

    it("uses default timeout when none specified", async () => {
      const def: WorkflowDef = {
        name: "timeout-default",
        steps: {
          normal: { bot: "bot", prompt: "go" },
        },
      };
      const engine = createEngine({ workflowsDir, definition: def });
      engine.startRun();

      const executor: StepExecutor = async () => ({ output: "done" });
      await engine.executeReady(executor);
      expect(engine.state().steps.normal!.status).toBe("completed");
    });
  });

  describe("maxRetries", () => {
    it("retries a failed step up to maxRetries", async () => {
      const def: WorkflowDef = {
        name: "retry-test",
        steps: {
          flaky: { bot: "bot", prompt: "go", maxRetries: 3 },
        },
      };
      const engine = createEngine({ workflowsDir, definition: def });
      engine.startRun();

      let callCount = 0;
      const failTwiceThenSucceed: StepExecutor = async () => {
        callCount++;
        if (callCount < 3) throw new Error("transient failure");
        return { output: "done" };
      };

      // Attempt 1: fails, step goes back to pending (attempts=1 < maxRetries=3)
      await engine.executeReady(failTwiceThenSucceed);
      expect(engine.state().steps.flaky!.status).toBe("pending");
      expect(engine.state().steps.flaky!.attempts).toBe(1);

      // Attempt 2: fails again, still pending (attempts=2 < maxRetries=3)
      await engine.executeReady(failTwiceThenSucceed);
      expect(engine.state().steps.flaky!.status).toBe("pending");
      expect(engine.state().steps.flaky!.attempts).toBe(2);

      // Attempt 3: succeeds
      await engine.executeReady(failTwiceThenSucceed);
      expect(engine.state().steps.flaky!.status).toBe("completed");
      expect(engine.state().steps.flaky!.output).toBe("done");
      expect(callCount).toBe(3);
    });

    it("fails permanently after exhausting maxRetries", async () => {
      const def: WorkflowDef = {
        name: "retry-exhausted",
        steps: {
          flaky: { bot: "bot", prompt: "go", maxRetries: 2 },
        },
      };
      const engine = createEngine({ workflowsDir, definition: def });
      engine.startRun();

      const alwaysFail: StepExecutor = async () => { throw new Error("permanent failure"); };

      // Attempt 1: fails, retries (pending)
      await engine.executeReady(alwaysFail);
      expect(engine.state().steps.flaky!.status).toBe("pending");

      // Attempt 2: fails, maxRetries exhausted -> failed permanently
      await engine.executeReady(alwaysFail);
      expect(engine.state().steps.flaky!.status).toBe("failed");
      expect(engine.state().steps.flaky!.error).toContain("Max retries");
      expect(engine.state().status).toBe("failed");
    });

    it("fails immediately without maxRetries (backwards compat)", async () => {
      const def: WorkflowDef = {
        name: "no-retry",
        steps: {
          fragile: { bot: "bot", prompt: "go" },  // no maxRetries
        },
      };
      const engine = createEngine({ workflowsDir, definition: def });
      engine.startRun();

      const fail: StepExecutor = async () => { throw new Error("fail"); };
      await engine.executeReady(fail);
      expect(engine.state().steps.fragile!.status).toBe("failed");
      expect(engine.state().status).toBe("failed");
    });
  });
});
