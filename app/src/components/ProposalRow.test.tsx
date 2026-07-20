// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { address } from "@solana/kit";
import { ProposalRow } from "./ProposalRow";
import type { MultisigView, ProposalView } from "@/lib/multisig";

afterEach(cleanup);

const A = address("So11111111111111111111111111111111111111112");
const B = address("SysvarC1ock11111111111111111111111111111111");
const PDA = address("Sysvar1nstructions1111111111111111111111111");
const TX = address("SysvarRent111111111111111111111111111111111");
const SYSTEM = address("11111111111111111111111111111111");

const ms = (over: Partial<MultisigView["data"]> = {}): MultisigView =>
  ({
    address: A,
    data: { owners: [A, B], threshold: 2, ownerSetSeqno: 0, ...over },
  }) as unknown as MultisigView;

const proposal = (over: Record<string, unknown> = {}): ProposalView =>
  ({
    address: TX,
    data: {
      didExecute: false,
      signers: [true, false],
      ownerSetSeqno: 0,
      programId: SYSTEM,
      accounts: [{ pubkey: PDA, isSigner: true, isWritable: true }],
      ...over,
    },
  }) as unknown as ProposalView;

const noop = () => {};
const row = (props: Partial<Parameters<typeof ProposalRow>[0]> = {}) =>
  render(
    <ProposalRow
      view={proposal()}
      ms={ms()}
      me={B}
      signerPda={PDA}
      onApprove={noop}
      onExecute={noop}
      {...props}
    />,
  );

const approveBtn = () => screen.getByRole("button", { name: "Approve" });
const executeBtn = () => screen.getByRole("button", { name: "Execute" });

describe("ProposalRow", () => {
  it("an owner who has not voted can approve but not execute (no quorum yet)", () => {
    row();
    expect(approveBtn()).toBeEnabled();
    expect(executeBtn()).toBeDisabled();
  });

  it("clicking an enabled button hands the proposal itself upwards", () => {
    const onApprove = vi.fn();
    const view = proposal();
    row({ view, onApprove });
    approveBtn().click();
    expect(onApprove).toHaveBeenCalledWith(view);
  });

  it("an owner who already voted cannot approve, and the reason is visible as text", () => {
    row({ me: A });
    expect(approveBtn()).toBeDisabled();
    expect(screen.getByText(/already approved this proposal/i)).toBeInTheDocument();
  });

  it("execution becomes available once the quorum is reached", () => {
    row({ view: proposal({ signers: [true, true] }) });
    expect(executeBtn()).toBeEnabled();
  });

  it("an executed proposal is dead through and through", () => {
    row({ view: proposal({ didExecute: true, signers: [true, true] }) });
    expect(approveBtn()).toBeDisabled();
    expect(executeBtn()).toBeDisabled();
    expect(screen.getByText(/already been executed/i)).toBeInTheDocument();
  });

  // While another action is in flight the buttons go dark — but that reason lasts a
  // second, and printing it as a verdict on the row is wrong (the dialog with the
  // action is on screen anyway).
  it("during another action the buttons go dark without an explaining caption", () => {
    row({ view: proposal({ signers: [true, true] }), busy: true });
    expect(approveBtn()).toBeDisabled();
    expect(executeBtn()).toBeDisabled();
    expect(screen.queryByText(/wait for the current action/i)).not.toBeInTheDocument();
  });

  // A proposal with a foreign signer will never execute: the program can only sign for
  // the treasury. The quorum is reached, though — so the button would look functional.
  it("execution is blocked for a proposal with a foreign signer", () => {
    row({
      view: proposal({
        signers: [true, true],
        accounts: [{ pubkey: B, isSigner: true, isWritable: false }],
      }),
    });
    expect(executeBtn()).toBeDisabled();
    expect(screen.getByText(/foreign signer/i)).toBeInTheDocument();
  });

  it("nothing is available without a wallet", () => {
    row({ me: undefined });
    expect(approveBtn()).toBeDisabled();
    expect(executeBtn()).toBeDisabled();
    expect(screen.getByText(/connect your wallet/i)).toBeInTheDocument();
  });

  // The approvals belong to the previous rules, so they must not be compared with the
  // current threshold: "2 / 2" on a dead proposal would read as "quorum reached".
  it("after a rules change it does not show the approval count against the current threshold", () => {
    row({ view: proposal({ ownerSetSeqno: 0, signers: [true, true] }), ms: ms({ ownerSetSeqno: 1 }) });
    expect(screen.queryByText("2 / 2")).not.toBeInTheDocument();
    // exact: "Outdated" is the badge, while the hint below also ends with "outdated".
    expect(screen.getByText("Outdated", { exact: true })).toBeInTheDocument();
  });

  it("shows the proposal index and does not invent one when it is unknown", () => {
    row({ index: 3 });
    expect(screen.getByText("#3")).toBeInTheDocument();
    cleanup();
    row();
    expect(screen.getByText("#?")).toBeInTheDocument();
  });
});
