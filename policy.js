// Deterministic policy check for an agent's proposed on-chain action.
// The Ponytail ladder, applied to transactions instead of code: the cheapest,
// safest action is the one never sent.
// ponytail: advisory only. It protects funds only if the signer refuses to sign
// without an `allow`; upgrade path is putting the signer behind this check.

export const DEFAULT_POLICY = {
  perTxCapUsd: 25,
  dailyCapUsd: 100,
  maxSlippageBps: 100,
  cooldownSec: 600,
  allowedPrograms: {
    "11111111111111111111111111111111": "System",
    TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token",
    TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
    ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token Account",
    JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter v6",
    MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: "Memo",
  },
  allowedRecipients: [],
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const actionKey = (a) =>
  JSON.stringify([a.kind, a.inputMint, a.outputMint, a.recipient, a.amountUsd]);

export function checkAction(action, policy = {}, ledger = [], now = Date.now()) {
  const p = { ...DEFAULT_POLICY, ...policy };
  const reasons = [];
  const key = actionKey(action);

  // Rung 1: does this need to happen at all?
  if (!action.reason?.trim()) reasons.push("rung 1: state why this action is needed");

  // Rung 2: already done?
  const recent = ledger.find((e) => e.key === key && now - e.ts < p.cooldownSec * 1000);
  if (recent) reasons.push(`rung 2: same action ran ${Math.round((now - recent.ts) / 1000)}s ago`);

  // Rung 3: only existing, known programs. No mystery contracts.
  const programs = action.programIds ?? [];
  if (programs.length === 0) reasons.push("rung 3: list the programIds this transaction calls");
  for (const id of programs) {
    if (!p.allowedPrograms[id]) reasons.push(`rung 3: program not allowlisted: ${id}`);
  }

  // Never cut: spend caps, slippage, recipients, approvals.
  const amount = Number(action.amountUsd);
  if (!Number.isFinite(amount) || amount < 0) {
    reasons.push("amountUsd must be a non-negative number");
  } else {
    if (amount > p.perTxCapUsd) reasons.push(`amount $${amount} exceeds per-tx cap $${p.perTxCapUsd}`);
    const spent = ledger.filter((e) => now - e.ts < DAY_MS).reduce((s, e) => s + e.amountUsd, 0);
    if (spent + amount > p.dailyCapUsd) {
      reasons.push(`daily cap $${p.dailyCapUsd} would be exceeded (spent $${spent})`);
    }
  }
  if (action.kind === "swap" && !(action.slippageBps <= p.maxSlippageBps)) {
    reasons.push(`slippageBps must be set and <= ${p.maxSlippageBps}`);
  }
  if (action.kind === "transfer" && !p.allowedRecipients.includes(action.recipient)) {
    reasons.push("recipient is not allowlisted; the agent may not pick who gets paid");
  }
  if (action.kind === "approve" && !(Number(action.approveAmount) <= amount)) {
    reasons.push("approvals must be bounded to this action's amount, never unlimited");
  }

  return { allow: reasons.length === 0, reasons, key };
}

// Keep only the last 24h; that is all the caps look at.
export const pruneLedger = (ledger, now = Date.now()) => ledger.filter((e) => now - e.ts < DAY_MS);
