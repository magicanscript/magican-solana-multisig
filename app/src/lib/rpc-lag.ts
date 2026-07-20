/**
 * A public RPC is a load balancer in front of a pool of nodes. A transaction is confirmed on
 * one node, while the next read may go to another one that has not seen it yet: a just-created
 * multisig is "not found", the proposals list is empty, the approval mask has not changed.
 * A single request after a write is fundamentally not enough.
 *
 * Where the expected state is known (the counter grew, the proposal was executed), we read
 * again until we see it. If we haven't seen it across all attempts, we return what did come
 * back: showing slightly stale data is better than spinning a spinner forever.
 *
 * Where a subscription is possible (the treasury balance) it is more reliable than any retries:
 * see useBalance(..., { watch: true }) on the multisig page.
 */
export const RPC_LAG_RETRIES = 6;
export const RPC_LAG_DELAY_MS = 1_200;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
