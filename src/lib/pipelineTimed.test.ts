import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { pipelineTimed } from "./pipelineLog";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("pipelineTimed", () => {
  const originalHeartbeat = process.env.VISTA_PIPELINE_HEARTBEAT_SEC;
  const originalTimeout = process.env.VISTA_PIPELINE_OP_TIMEOUT_MS;

  afterEach(() => {
    if (originalHeartbeat === undefined) delete process.env.VISTA_PIPELINE_HEARTBEAT_SEC;
    else process.env.VISTA_PIPELINE_HEARTBEAT_SEC = originalHeartbeat;
    if (originalTimeout === undefined) delete process.env.VISTA_PIPELINE_OP_TIMEOUT_MS;
    else process.env.VISTA_PIPELINE_OP_TIMEOUT_MS = originalTimeout;
  });

  it("logs complete with durationMs on success", async () => {
    const entries: unknown[][] = [];
    const orig = console.info;
    console.info = (...args: unknown[]) => {
      entries.push(args);
    };
    try {
      const result = await pipelineTimed("FAL_PIPELINE", "test op", async () => {
        await sleep(20);
        return "ok";
      });
      assert.equal(result, "ok");
      const start = entries.find((a) => String(a[0]).includes("test op — start"));
      assert.ok(start);
      const complete = entries.find((a) => String(a[0]).includes("test op — complete"));
      assert.ok(complete);
      const data = complete?.[1] as Record<string, unknown> | undefined;
      assert.ok(data && typeof data.durationMs === "number" && data.durationMs >= 0);
    } finally {
      console.info = orig;
    }
  });

  it("logs failed and rethrows on error", async () => {
    const errors: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    try {
      await pipelineTimed("FAL_PIPELINE", "failing op", async () => {
        throw new Error("boom");
      });
      assert.fail("expected throw");
    } catch (err) {
      assert.equal((err as Error).message, "boom");
      assert.ok(errors.some((l) => l.includes("failing op — failed")));
    } finally {
      console.error = orig;
    }
  });

  it("emits still running heartbeats when heartbeatSec is set", async () => {
    process.env.VISTA_PIPELINE_HEARTBEAT_SEC = "0";
    const entries: unknown[][] = [];
    const orig = console.info;
    console.info = (...args: unknown[]) => {
      entries.push(args);
    };
    try {
      await pipelineTimed(
        "FAL_KONTEXT",
        "heartbeat op",
        async () => {
          await sleep(150);
          return 1;
        },
        { heartbeatSec: 0.05 },
      );
      assert.ok(entries.some((a) => String(a[0]).includes("heartbeat op — still running")));
      assert.ok(entries.some((a) => String(a[0]).includes("heartbeat op — complete")));
    } finally {
      console.info = orig;
    }
  });

  it("merges completeMeta into complete log", async () => {
    const entries: unknown[][] = [];
    const orig = console.info;
    console.info = (...args: unknown[]) => {
      entries.push(args);
    };
    try {
      await pipelineTimed(
        "FAL_PIPELINE",
        "fal upload",
        async () => "https://v3b.fal.media/files/test.png",
        {
          completeMeta: (url) => ({ urlHost: new URL(url).hostname }),
        },
      );
      const complete = entries.find((a) => String(a[0]).includes("fal upload — complete"));
      const data = complete?.[1] as Record<string, unknown> | undefined;
      assert.equal(data?.urlHost, "v3b.fal.media");
    } finally {
      console.info = orig;
    }
  });

  it("fails when op exceeds VISTA_PIPELINE_OP_TIMEOUT_MS", async () => {
    process.env.VISTA_PIPELINE_OP_TIMEOUT_MS = "50";
    const errors: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    try {
      await pipelineTimed("FAL_RENDER", "slow op", async () => {
        await sleep(200);
        return "late";
      });
      assert.fail("expected timeout");
    } catch (err) {
      assert.ok(String(err).includes("exceeded"));
      assert.ok(errors.some((l) => l.includes("slow op — failed")));
    } finally {
      console.error = orig;
    }
  });
});
