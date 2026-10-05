import assert from "node:assert/strict";
import test from "node:test";

import { actionKey, checkAction } from "../policy.js";

const JUP = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const swap = { kind: "swap", reason: "rebalance", programIds: [JUP], amountUsd: 10, slippageBps: 50 };
const NOW = 1_000_000_000;

test("a sane swap is allowed", () => {
  assert.deepEqual(checkAction(swap, {}, [], NOW).reasons, []);
});

test("each rung and cap denies", () => {
  const denied = (a, ledger = []) => !checkAction({ ...swap, ...a }, {}, ledger, NOW).allow;
  assert.ok(denied({ reason: " " }), "no reason");
  assert.ok(denied({}, [{ ts: NOW - 1000, key: actionKey(swap), amountUsd: 10 }]), "repeat");
  assert.ok(denied({ programIds: ["Evi1111111111111111111111111111111111111111"] }), "unknown program");
  assert.ok(denied({ programIds: [] }), "no programs listed");
  assert.ok(denied({ amountUsd: 26 }), "per-tx cap");
  assert.ok(denied({ amountUsd: 20 }, [{ ts: NOW - 1000, key: "x", amountUsd: 90 }]), "daily cap");
  assert.ok(denied({ slippageBps: undefined }), "missing slippage");
  assert.ok(denied({ slippageBps: 500 }), "high slippage");
  assert.ok(denied({ kind: "transfer", recipient: "Attacker" }), "unlisted recipient");
  assert.ok(denied({ kind: "approve", approveAmount: Infinity }), "unlimited approval");
});

test("old spend falls out of the daily window", () => {
  const ledger = [{ ts: NOW - 25 * 3600 * 1000, key: "x", amountUsd: 100 }];
  assert.ok(checkAction(swap, {}, ledger, NOW).allow);
});
