# lazy-guard

MCP policy layer for Solana AI agents. The agent asks before it acts on-chain.
Inspired by [Ponytail](https://github.com/DietrichGebert/ponytail)'s ladder (MIT), applied to transactions instead of code.

## Ladder

1. Does this need to happen? (agent must state a reason)
2. Already done recently? (cooldown, default 10 min)
3. Only known programs (System, Token, Token-2022, ATA, Jupiter v6, Memo)

Never cut: per-tx cap ($25), daily cap ($100), slippage cap (100 bps), recipient allowlist, bounded approvals.

## Tools

- `check_action`: ALLOW / DENY with reasons. Allowed amounts are reserved against the daily cap in `ledger.json`.
- `simulate_tx`: dry-runs a base64 transaction on the RPC (devnet by default).
- Prompt `lazy-guard`: the ladder as agent instructions.

## Run

```bash
npm install
npm test
node index.js
```

```json
{ "mcpServers": { "lazy-guard": { "command": "node", "args": ["lazy-guard/index.js"] } } }
```

Env: `LAZY_GUARD_RPC`, `LAZY_GUARD_LEDGER`, `LAZY_GUARD_CONFIG` (JSON merged over the defaults in `policy.js`).

## Known ceiling

Advisory only: it protects funds only if the signer refuses to sign without an ALLOW.
Next step: a signer wrapper that calls `checkAction` itself, and deriving `programIds`
from the transaction instead of trusting the agent's list.
