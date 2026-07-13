import test from "node:test";
import assert from "node:assert/strict";
import { createSseEmitter, isStreamClosedError } from "./sseStream.ts";

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
