import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCookieHeader, pickPageTarget } from "./browserAuth.js";

test("builds an HTTP Cookie header from CDP cookies", () => {
  assert.equal(
    buildCookieHeader([
      { name: "a", value: "1", domain: ".dndbeyond.com" },
      { name: "b", value: "two words", domain: "www.dndbeyond.com" },
    ]),
    "a=1; b=two%20words",
  );
});

test("picks the DDB page target when available", () => {
  const target = pickPageTarget([
    { type: "service_worker", url: "chrome-extension://x", webSocketDebuggerUrl: "ws://worker" },
    { type: "page", url: "https://www.dndbeyond.com/login", webSocketDebuggerUrl: "ws://login" },
    { type: "page", url: "https://www.dndbeyond.com/characters/1", webSocketDebuggerUrl: "ws://character" },
  ]);

  assert.equal(target?.webSocketDebuggerUrl, "ws://character");
});
