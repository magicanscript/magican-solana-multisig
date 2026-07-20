import { describe, it, expect } from "vitest";
import { address } from "@solana/kit";
import { actionBlocks, actionHint, BUSY_REASON } from "./proposal-actions";

const A = address("So11111111111111111111111111111111111111112");
const B = address("SysvarC1ock11111111111111111111111111111111");
const STRANGER = address("11111111111111111111111111111111");

const ms = { owners: [A, B], threshold: 2, ownerSetSeqno: 0 };
const tx = { didExecute: false, signers: [true, false], ownerSetSeqno: 0 };

describe("actionBlocks", () => {
  it("владельцу, который ещё не голосовал, одобрение разрешено", () => {
    expect(actionBlocks(tx, ms, B, false).approve).toBeNull();
  });

  it("без кошелька заблокировано всё", () => {
    const b = actionBlocks(tx, ms, undefined, false);
    expect(b.approve).toMatch(/кошел/i);
    expect(b.execute).toMatch(/кошел/i);
  });

  it("не-владельцу одобрение запрещено, а исполнение — нет (оно permissionless)", () => {
    const ready = { ...tx, signers: [true, true] };
    const b = actionBlocks(ready, ms, STRANGER, false);
    expect(b.approve).toMatch(/не владелец/i);
    expect(b.execute).toBeNull();
  });

  it("повторный голос запрещён: маска булева, второй раз ничего не даёт", () => {
    expect(actionBlocks(tx, ms, A, false).approve).toMatch(/уже одобрили/i);
  });

  it("исполнение недоступно, пока не собран кворум", () => {
    expect(actionBlocks(tx, ms, B, false).execute).toMatch(/кворум/i);
  });

  it("после исполнения запрещено обе кнопки — и причина названа честно", () => {
    const done = { ...tx, didExecute: true, signers: [true, true] };
    const b = actionBlocks(done, ms, B, false);
    // Не «ждём кворума»: кворум как раз собран. Врать причиной нельзя — пользователь
    // будет ждать подписей у предложения, которое уже исполнено.
    expect(b.approve).toMatch(/исполнен/i);
    expect(b.execute).toMatch(/исполнен/i);
  });

  it("устаревшее предложение: обе кнопки заблокированы сменой набора владельцев", () => {
    const stale = { ...tx, signers: [true, true], ownerSetSeqno: 1 };
    const b = actionBlocks(stale, ms, B, false);
    expect(b.approve).toMatch(/владельц/i);
    expect(b.execute).toMatch(/владельц/i);
  });

  // Маска заморожена на СВОЁМ наборе владельцев: сопоставлять её с текущим списком
  // нельзя. Иначе «вы уже одобрили» показалось бы тому, чей голос принадлежит
  // другому человеку, — а настоящая причина (предложение мертво) потерялась бы.
  it("у устаревшего предложения причина — набор владельцев, а не чужой голос", () => {
    const stale = { ...tx, signers: [true, false], ownerSetSeqno: 1 };
    expect(actionBlocks(stale, ms, A, false).approve).not.toMatch(/уже одобрили/i);
  });

  // После set_owners длина маски и длина списка владельцев расходятся. Читать маску
  // по индексу в НОВОМ списке — это выход за границы (undefined) либо чужой голос.
  // Спасает только порядок веток: stale проверяется раньше маски. Тест держит порядок.
  it("маска короче нового списка владельцев — до индексации дело не доходит", () => {
    const grown = { owners: [A, B, STRANGER], threshold: 2, ownerSetSeqno: 1 };
    const old = { didExecute: false, signers: [true, true], ownerSetSeqno: 0 };
    const b = actionBlocks(old, grown, STRANGER, false);
    expect(b.approve).toMatch(/владельц/i);
    expect(b.execute).toMatch(/владельц/i);
  });

  it("во время другого действия заблокировано всё — но причина временная", () => {
    // Предложение, где иначе доступны ОБА действия: кворум собран, а мой голос ещё нет.
    const ready = { ...tx, signers: [true, true], ownerSetSeqno: 0 };
    const three = { ...ms, owners: [A, B, STRANGER], threshold: 2 };
    const b = actionBlocks({ ...ready, signers: [true, true, false] }, three, STRANGER, true);
    expect(b.approve).toMatch(/дождитесь/i);
    expect(b.execute).toMatch(/дождитесь/i);
  });

  // Постоянная причина важнее временной: «дождитесь» у чужого мультисига сбивало бы
  // с толку — ждать бессмысленно, одобрять всё равно нельзя.
  it("постоянная причина показывается вместо временной", () => {
    expect(actionBlocks(tx, ms, STRANGER, true).approve).toMatch(/не владелец/i);
  });

  // change_threshold бампает тот же owner_set_seqno, что и set_owners (governance.rs:
  // «используем его как общую версию конфигурации»). Писать «набор владельцев
  // изменился» — врать: владельцы те же, поменяли порог, и человек пойдёт искать
  // несуществующее увольнение.
  it("причина устаревания говорит о правилах, а не только о владельцах", () => {
    const stale = { ...tx, ownerSetSeqno: 1 };
    const b = actionBlocks(stale, ms, B, false);
    expect(b.approve).toMatch(/правил/i);
    expect(b.approve).not.toMatch(/^Набор владельцев изменился/);
  });

  // Предложение с посторонним подписантом создать через наш UI нельзя (lib/ix.ts его
  // отвергает), но оно могло прийти из CLI. execute_transaction.rs сохраняет чужой
  // is_signer в AccountMeta, а подписать программа умеет только за свою казну —
  // такое предложение обречено НАВСЕГДА. Кнопка «Исполнить» обязана это знать.
  it("исполнение закрыто, если во вложенной инструкции чужой подписант", () => {
    const ready = { ...tx, signers: [true, true] };
    const foreign = { ...ready, accounts: [{ pubkey: STRANGER, isSigner: true, isWritable: false }] };
    const b = actionBlocks(foreign, ms, B, false, A);
    expect(b.execute).toMatch(/подписант/i);
  });

  it("казна как подписант исполнению не мешает — ради этого всё и сделано", () => {
    const ready = { ...tx, signers: [true, true] };
    const ok = { ...ready, accounts: [{ pubkey: A, isSigner: true, isWritable: true }] };
    expect(actionBlocks(ok, ms, B, false, A).execute).toBeNull();
  });
});

describe("actionHint", () => {
  it("молчит, пока хоть одно действие доступно", () => {
    expect(actionHint({ approve: null, execute: "нет кворума" })).toBeNull();
  });

  // «Дождитесь» — причина на секунду; печатать её как приговор строке нельзя, тем
  // более что диалог с текущим действием и так на экране.
  it("не показывает временную причину как объяснение", () => {
    expect(
      actionHint({ approve: "Вы не владелец этого мультисига", execute: BUSY_REASON }),
    ).toBeNull();
  });

  it("одну общую причину печатает один раз", () => {
    const same = "Предложение уже исполнено";
    expect(actionHint({ approve: same, execute: same })).toBe(same);
  });

  // Частый случай: голос отдан, кворума нет. Причина approve без причины execute
  // оставляет вопрос «а исполнить-то почему нельзя» без ответа.
  it("разные причины показывает обе", () => {
    const hint = actionHint({ approve: "Вы уже одобрили", execute: "Доступно, когда собран кворум" });
    expect(hint).toMatch(/уже одобрили/i);
    expect(hint).toMatch(/кворум/i);
  });
});
