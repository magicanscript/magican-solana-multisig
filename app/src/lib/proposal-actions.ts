import type { Address } from "@solana/kit";
import { deriveStatus, isAttributable } from "./proposal-status";
import type { ProposalAccount } from "./ix";

/** Почему кнопка выключена. `null` — действие доступно. */
export type Blocks = { approve: string | null; execute: string | null };

const NO_WALLET = "Подключите кошелёк";
const EXECUTED = "Предложение уже исполнено";
/**
 * `owner_set_seqno` — общая версия правил, а не только списка владельцев: его бампает
 * и `set_owners`, и `change_threshold` (governance.rs). Писать «набор владельцев
 * изменился» после смены порога — врать: человек пойдёт искать увольнение, которого
 * не было. Формулировка обязана покрывать обе причины.
 */
const STALE = "Правила мультисига изменились (владельцы или порог) — предложение устарело";
const FOREIGN_SIGNER =
  "Во вложенной инструкции есть посторонний подписант — исполнить такое предложение невозможно";
/** Временная причина: через секунду её не будет. Её отличает `isTransient`. */
export const BUSY_REASON = "Дождитесь завершения текущего действия";

/** Причина отпадёт сама собой — это не приговор действию, а «сейчас занято». */
export const isTransient = (reason: string | null): boolean => reason === BUSY_REASON;

/**
 * Причины запрета для approve/execute — ровно те же проверки, что делает программа,
 * только заранее: пользователь узнаёт о запрете до подписи, а не из ошибки симуляции.
 *
 * Два правила, которые здесь легко нарушить незаметно:
 *  - причина обязана быть НАСТОЯЩЕЙ. Свалить исполненное и устаревшее предложение в
 *    «ждём кворума» — значит отправить человека ждать подписей у мёртвого предложения;
 *  - постоянная причина важнее временной (`busy`): «дождитесь» у чужого мультисига
 *    обещает доступ, которого не будет.
 *
 * `signerPda` — казна мультисига; без неё проверку постороннего подписанта не сделать,
 * поэтому она опциональна, но передавать её стоит всегда.
 */
export function actionBlocks(
  tx: {
    didExecute: boolean;
    signers: boolean[];
    ownerSetSeqno: number;
    accounts?: readonly ProposalAccount[];
  },
  ms: { owners: readonly Address[]; threshold: number; ownerSetSeqno: number },
  me: Address | undefined,
  busy: boolean,
  signerPda?: Address,
): Blocks {
  const status = deriveStatus(tx, ms);
  // Голос принадлежит владельцу по ИНДЕКСУ в маске, а маска заморожена на своём
  // наборе владельцев: после set_owners сопоставлять её с текущим списком нельзя.
  const comparable = isAttributable(tx, ms);
  const myIndex = me ? ms.owners.indexOf(me) : -1;

  // Подписать вложенную инструкцию программа умеет только за свою казну (invoke_signed),
  // а чужой `is_signer` она сохраняет в AccountMeta как есть (execute_transaction.rs).
  // Наш UI такое предложение создать не даст (lib/ix.ts), но оно могло прийти из CLI —
  // и тогда оно обречено НАВСЕГДА, сколько бы подписей ни собрало.
  const hasForeignSigner =
    signerPda != null && (tx.accounts?.some((a) => a.isSigner && a.pubkey !== signerPda) ?? false);

  const approve = !me
    ? NO_WALLET
    : status === "executed"
      ? EXECUTED
      : status === "stale"
        ? STALE
        : myIndex < 0
          ? "Вы не владелец этого мультисига"
          : comparable && tx.signers[myIndex] === true
            ? "Вы уже одобрили это предложение"
            : busy
              ? BUSY_REASON
              : null;

  // Execute никого не требует в подписанты (permissionless) — нужен лишь кошелёк
  // для оплаты комиссии, поэтому не-владельцу его не запрещаем.
  const execute = !me
    ? NO_WALLET
    : status === "executed"
      ? EXECUTED
      : status === "stale"
        ? STALE
        : hasForeignSigner
          ? FOREIGN_SIGNER
          : status !== "executable"
            ? "Доступно, когда собран кворум"
            : busy
              ? BUSY_REASON
              : null;

  return { approve, execute };
}

/**
 * Текст под строкой предложения: зачем он вообще нужен — tooltip на выключенной
 * кнопке не показывается на тач-устройствах, и человек упирается в серую кнопку
 * без объяснений.
 *
 * Печатаем, только когда мертвы ОБА действия и мертвы насовсем: «дождитесь» — это
 * причина на секунду, а диалог с текущим действием и так на экране. И если причины
 * разные, нужны обе: «вы уже одобрили» без «ждём кворума» оставляет без ответа
 * вопрос, почему нельзя исполнить.
 */
export function actionHint(blocks: Blocks): string | null {
  const { approve, execute } = blocks;
  if (!approve || !execute) return null;
  if (isTransient(approve) || isTransient(execute)) return null;
  return approve === execute ? approve : `${approve}. ${execute}`;
}
