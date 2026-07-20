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
  // Проверяем не цвет, а состояние: класс — деталь оформления, а «одобрил/не одобрил»
  // — смысл, который обязан быть доступен и тесту, и скринридеру.
  it("отмечает одобрившего и не отмечает остальных", () => {
    render(<ApprovalPips {...base} signers={[true, false]} />);
    const pips = screen.getAllByRole("img");
    expect(pips).toHaveLength(2);
    expect(pips[0]).toHaveAttribute("data-approved", "true");
    expect(pips[1]).toHaveAttribute("data-approved", "false");
  });

  it("подписывает каждый пип владельцем и его голосом", () => {
    render(<ApprovalPips {...base} signers={[true, false]} />);
    // Границы обязательны: /одобрил/ совпадает и с «не одобрил».
    expect(screen.getByLabelText(/— одобрил$/)).toHaveAttribute("data-approved", "true");
    expect(screen.getByLabelText(/— не одобрил$/)).toHaveAttribute("data-approved", "false");
  });

  it("помечает пип текущего пользователя", () => {
    render(<ApprovalPips {...base} signers={[false, false]} me={B} />);
    expect(screen.getByLabelText(/вы/i)).toHaveAttribute("data-me", "true");
  });

  // Маска заморожена на своём наборе владельцев: после смены правил зипование с
  // текущим списком приписало бы голос не тому. Пипсы обязаны отказаться рисовать.
  it("при смене правил не рисует пипсы, а объясняет почему", () => {
    render(<ApprovalPips {...base} msOwnerSetSeqno={1} signers={[true, false]} />);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(screen.getByText(/прежним правилам/i)).toBeInTheDocument();
  });

  // Длина маски разошлась со списком владельцев внутри одной версии правил — такого
  // быть не должно; молча нарисовать «сколько получится» = соврать про кворум.
  it("не рисует пипсы, если длина маски не совпала со списком владельцев", () => {
    render(<ApprovalPips {...base} signers={[true]} />);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(screen.getByText(/не соответствует/i)).toBeInTheDocument();
  });
});
