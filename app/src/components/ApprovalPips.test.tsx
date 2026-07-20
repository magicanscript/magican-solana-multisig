// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { address } from "@solana/kit";
import { ApprovalPips } from "./ApprovalPips";

afterEach(cleanup);

const A = address("So11111111111111111111111111111111111111112");
const B = address("SysvarC1ock11111111111111111111111111111111");

const base = { owners: [A, B], txOwnerSetSeqno: 0, msOwnerSetSeqno: 0 };

describe("ApprovalPips", () => {
  // We assert the state, not the colour: a class is a styling detail, while
  // "approved / not approved" is the meaning, which must be available to both the
  // test and a screen reader.
  it("marks the owner who approved and leaves the others unmarked", () => {
    render(<ApprovalPips {...base} signers={[true, false]} />);
    const pips = screen.getAllByRole("img");
    expect(pips).toHaveLength(2);
    expect(pips[0]).toHaveAttribute("data-approved", "true");
    expect(pips[1]).toHaveAttribute("data-approved", "false");
  });

  it("labels every pip with its owner and their approval", () => {
    render(<ApprovalPips {...base} signers={[true, false]} />);
    // The anchors are mandatory: /approved/ also matches "not approved".
    expect(screen.getByLabelText(/— approved$/)).toHaveAttribute("data-approved", "true");
    expect(screen.getByLabelText(/— not approved$/)).toHaveAttribute("data-approved", "false");
  });

  it("marks the current user's pip", () => {
    render(<ApprovalPips {...base} signers={[false, false]} me={B} />);
    expect(screen.getByLabelText(/\(you\)/i)).toHaveAttribute("data-me", "true");
  });

  // The mask is frozen against its own owner set: after the rules change, zipping it
  // with the current list would attribute an approval to the wrong person. The pips
  // must refuse to render.
  it("renders no pips after a rules change, and explains why", () => {
    render(<ApprovalPips {...base} msOwnerSetSeqno={1} signers={[true, false]} />);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(screen.getByText(/previous multisig rules/i)).toBeInTheDocument();
  });

  // The mask length diverged from the owner list within a single version of the rules —
  // that must never happen; silently drawing "as many as fit" would lie about the quorum.
  it("renders no pips when the mask length doesn't match the owner list", () => {
    render(<ApprovalPips {...base} signers={[true]} />);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(screen.getByText(/doesn't match the current owner set/i)).toBeInTheDocument();
  });
});
