import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createSseEmitter, isStreamClosedError } from "./sseStream.ts";

const decoder = new TextDecoder();

test("isStreamClosedError matches ReadableStream closed controller", () => {
  assert.equal(
    isStreamClosedError(new TypeError("Invalid state: Controller is already closed")),
    true,
  );
});

test("isStreamClosedError ignores unrelated errors", () => {
  assert.equal(isStreamClosedError(new Error("FAL render failed")), false);
  assert.equal(isStreamClosedError(new Error("Invalid state: something else")), false);
});

test("createSseEmitter swallows enqueue after close", () => {
  const enqueued: Uint8Array[] = [];
  let closed = false;
  const controller = {
    enqueue(chunk: Uint8Array) {
      if (closed) throw new TypeError("Invalid state: Controller is already closed");
      enqueued.push(chunk);
    },
    close() {
      if (closed) throw new TypeError("Invalid state: Controller is already closed");
      closed = true;
    },
  } as unknown as ReadableStreamDefaultController<Uint8Array>;

  const { emit, close } = createSseEmitter(controller);
  assert.equal(emit({ phase: "generating", progress: 0.1 }), true);
  assert.equal(enqueued.length, 1);
  close();
  assert.equal(emit({ phase: "complete" }), false);
  close(); // second close must not throw
  assert.equal(enqueued.length, 1);
});

test("createSseEmitter heartbeat pings while open and stops on close", () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const chunks: string[] = [];
    let closed = false;
    const controller = {
      enqueue(chunk: Uint8Array) {
        if (closed) throw new TypeError("Invalid state: Controller is already closed");
        chunks.push(decoder.decode(chunk));
      },
      close() {
        closed = true;
      },
    } as unknown as ReadableStreamDefaultController<Uint8Array>;

    const { emit, close } = createSseEmitter(controller, { heartbeatMs: 1000 });
    mock.timers.tick(2500); // two heartbeats
    assert.equal(chunks.filter((c) => c === ": keep-alive\n\n").length, 2);

    emit({ phase: "generating" });
    assert.ok(chunks.some((c) => c.startsWith("data: ")));

    close();
    mock.timers.tick(5000); // no more heartbeats after close
    assert.equal(chunks.filter((c) => c === ": keep-alive\n\n").length, 2);
  } finally {
    mock.timers.reset();
  }
});
