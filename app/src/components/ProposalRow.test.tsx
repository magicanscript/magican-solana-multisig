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

const approveBtn = () => screen.getByRole("button", { name: "Одобрить" });
const executeBtn = () => screen.getByRole("button", { name: "Исполнить" });

describe("ProposalRow", () => {
  it("владельцу без голоса — одобрение доступно, исполнение нет (кворум не собран)", () => {
    row();
    expect(approveBtn()).toBeEnabled();
    expect(executeBtn()).toBeDisabled();
  });

  it("клик по доступной кнопке отдаёт наверх само предложение", () => {
    const onApprove = vi.fn();
    const view = proposal();
    row({ view, onApprove });
    approveBtn().click();
    expect(onApprove).toHaveBeenCalledWith(view);
  });

  it("проголосовавшему одобрение закрыто, а причина видна текстом", () => {
    row({ me: A });
    expect(approveBtn()).toBeDisabled();
    expect(screen.getByText(/уже одобрили/i)).toBeInTheDocument();
  });

  it("при собранном кворуме исполнение доступно", () => {
    row({ view: proposal({ signers: [true, true] }) });
    expect(executeBtn()).toBeEnabled();
  });

  it("исполненное предложение мертво целиком", () => {
    row({ view: proposal({ didExecute: true, signers: [true, true] }) });
    expect(approveBtn()).toBeDisabled();
    expect(executeBtn()).toBeDisabled();
    expect(screen.getByText(/уже исполнено/i)).toBeInTheDocument();
  });

  // Пока летит другое действие, кнопки гаснут — но это причина на секунду, и
  // печатать её приговором строке нельзя (диалог с действием и так на экране).
  it("во время другого действия кнопки гаснут без объясняющей подписи", () => {
    row({ view: proposal({ signers: [true, true] }), busy: true });
    expect(approveBtn()).toBeDisabled();
    expect(executeBtn()).toBeDisabled();
    expect(screen.queryByText(/дождитесь/i)).not.toBeInTheDocument();
  });

  // Предложение с посторонним подписантом не исполнится никогда: подписать программа
  // умеет только за казну. Кворум при этом собран — и кнопка выглядела бы рабочей.
  it("исполнение закрыто у предложения с посторонним подписантом", () => {
    row({
      view: proposal({
        signers: [true, true],
        accounts: [{ pubkey: B, isSigner: true, isWritable: false }],
      }),
    });
    expect(executeBtn()).toBeDisabled();
    expect(screen.getByText(/посторонний подписант/i)).toBeInTheDocument();
  });

  it("без кошелька недоступно ничего", () => {
    row({ me: undefined });
    expect(approveBtn()).toBeDisabled();
    expect(executeBtn()).toBeDisabled();
    expect(screen.getByText(/подключите кошелёк/i)).toBeInTheDocument();
  });

  // Голоса относятся к прежним правилам, поэтому сравнивать их с текущим порогом
  // нельзя: «2 / 2» у мёртвого предложения читалось бы как «кворум собран».
  it("после смены правил не показывает счёт голосов против текущего порога", () => {
    row({ view: proposal({ ownerSetSeqno: 0, signers: [true, true] }), ms: ms({ ownerSetSeqno: 1 }) });
    expect(screen.queryByText("2 / 2")).not.toBeInTheDocument();
    // exact: «Устарело» — бейдж, а подсказка внизу оканчивается на «устарело».
    expect(screen.getByText("Устарело", { exact: true })).toBeInTheDocument();
  });

  it("показывает индекс предложения, а при неизвестном — не выдумывает его", () => {
    row({ index: 3 });
    expect(screen.getByText("#3")).toBeInTheDocument();
    cleanup();
    row();
    expect(screen.getByText("#?")).toBeInTheDocument();
  });
});
