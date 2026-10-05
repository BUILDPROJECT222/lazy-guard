#!/usr/bin/env node
// lazy-guard MCP server: an agent asks before it acts on-chain.
// Tools: check_action (policy + spend ledger), simulate_tx (RPC dry run).
import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { checkAction, pruneLedger } from "./policy.js";

const RPC_URL = process.env.LAZY_GUARD_RPC ?? "https://api.devnet.solana.com";
const LEDGER_PATH = process.env.LAZY_GUARD_LEDGER ?? new URL("./ledger.json", import.meta.url);
const policy = process.env.LAZY_GUARD_CONFIG
  ? JSON.parse(fs.readFileSync(process.env.LAZY_GUARD_CONFIG, "utf8"))
  : {};

const readLedger = () => {
  try {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err; // a corrupt ledger must fail closed, not reset the daily cap
  }
};

const RULES = `Before any on-chain action, stop at the first rung that holds:
1. Does this need to happen at all? If not, do nothing. Doing nothing is free.
2. Already done recently? Don't repeat it.
3. Can an existing, known program do it (Token, Token-2022, Jupiter)? Use it.
4. Can it be one transaction? Make it one.
Always call check_action, then simulate_tx, before asking for a signature.
Never cut: spend caps, slippage limits, recipient allowlist, bounded approvals.`;

const server = new McpServer({ name: "lazy-guard", version: "0.1.0" });

server.registerPrompt(
  "lazy-guard",
  { title: "Lazy guard rules", description: "The on-chain action ladder for agents." },
  () => ({ messages: [{ role: "user", content: { type: "text", text: RULES } }] }),
);

server.registerTool(
  "check_action",
  {
    title: "Check an on-chain action",
    description:
      "Run a proposed action through the ladder and safety caps. If allowed, its amount is reserved against the daily cap.",
    inputSchema: {
      kind: z.enum(["swap", "transfer", "approve", "other"]),
      reason: z.string().describe("Why this action is needed now."),
      programIds: z.array(z.string()).describe("Every program the transaction calls."),
      amountUsd: z.number(),
      slippageBps: z.number().optional(),
      recipient: z.string().optional(),
      approveAmount: z.number().optional(),
      inputMint: z.string().optional(),
      outputMint: z.string().optional(),
    },
    outputSchema: { allow: z.boolean(), reasons: z.array(z.string()) },
  },
  (action) => {
    const ledger = readLedger();
    const { allow, reasons, key } = checkAction(action, policy, ledger);
    if (allow) {
      // ponytail: reserves on allow, even if the tx later fails. Fails closed; a
      // record_executed tool can release unused reservations if that bites.
      ledger.push({ ts: Date.now(), key, amountUsd: action.amountUsd });
      fs.writeFileSync(LEDGER_PATH, JSON.stringify(pruneLedger(ledger), null, 2));
    }
    const text = allow ? "ALLOW" : `DENY\n- ${reasons.join("\n- ")}`;
    return { content: [{ type: "text", text }], structuredContent: { allow, reasons } };
  },
);

server.registerTool(
  "simulate_tx",
  {
    title: "Simulate a transaction",
    description: "Dry-run a base64 serialized transaction against the configured RPC.",
    inputSchema: { transaction: z.string().describe("Base64 serialized transaction.") },
    annotations: { readOnlyHint: true },
  },
  async ({ transaction }) => {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "simulateTransaction",
        params: [transaction, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true }],
      }),
    });
    const body = await res.json();
    if (body.error) throw new Error(`RPC error: ${body.error.message}`);
    const { err, logs, unitsConsumed } = body.result.value;
    const text = `${err ? "FAILED: " + JSON.stringify(err) : "OK"} (${unitsConsumed ?? "?"} CU)\n${(logs ?? []).join("\n")}`;
    return { content: [{ type: "text", text }] };
  },
);

await server.connect(new StdioServerTransport());
