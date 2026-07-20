import { test, expect } from '@playwright/test';
import { installWallets, loadSigner } from './wallet-stub';

/**
 * Raw-режим против РЕАЛЬНОГО devnet: произвольная вложенная инструкция (Memo),
 * подписанная казной мультисига. Мультисиг берём 1-of-1 — голос автора и есть
 * кворум, так что весь путь проходится одним кошельком, а проверяется главное:
 * raw-предложение не только создаётся, но и ИСПОЛНЯЕТСЯ.
 */
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const SP =
  '/tmp/user/1000/claude-1000/-home-art-projects-magican-solana-multisig/dee35d2c-476f-489a-be1b-a89317cc6451/scratchpad';

test('raw-предложение (Memo): создать → исполнить', async ({ page }) => {
  const o1 = await loadSigner(`${process.env.HOME}/.config/solana/id.json`);
  // Второй кошелёк владельцем этого 1-of-1 НЕ является — на нём проверяем дизейблы.
  const stranger = await loadSigner(`${SP}/owner2.json`);
  await installWallets(page, [
    { name: 'Probe One', ...o1 },
    { name: 'Probe Two', ...stranger },
  ]);

  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await page.getByRole('button', { name: 'Подключить кошелёк' }).click();
  await page.getByRole('menuitem', { name: 'Probe One' }).click();
  await expect(page.getByRole('button', { name: 'Отключить' })).toBeVisible({ timeout: 20_000 });

  // --- Мультисиг 1-of-1 ---
  await page.goto('/create');
  await page.getByRole('button', { name: 'Удалить владельца' }).click();
  await page.getByRole('spinbutton').fill('1');
  await page.getByRole('button', { name: 'Проверить' }).click();
  await expect(page.getByText(/Симуляция успешна|✓/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Создать' }).click();
  await page.waitForURL(/\/m\/.+/, { timeout: 60_000 });
  await expect(page.getByText('1-of-1')).toBeVisible({ timeout: 30_000 });
  console.log('✓ мультисиг 1-of-1 создан:', page.url().split('/m/')[1]);

  // Казну пополняем, чтобы её аккаунт существовал на момент invoke_signed.
  await page.getByRole('button', { name: 'Пополнить' }).click();
  await expect(page.getByText('0.1 SOL', { exact: true })).toBeVisible({ timeout: 60_000 });

  // --- Raw-предложение: Memo, подписанный казной ---
  await page.getByRole('tab', { name: 'Raw' }).click();
  await page.getByPlaceholder('Адрес программы').fill(MEMO_PROGRAM);
  await page.getByRole('button', { name: '+ Казна' }).click();
  await page
    .getByPlaceholder('Пусто — если инструкция без данных')
    .fill(Buffer.from('magican raw ok').toString('base64'));

  await page.getByRole('button', { name: 'Проверить' }).click();
  await expect(page.getByText(/Симуляция успешна/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Подписать' }).click();
  await expect(page.getByText('#0')).toBeVisible({ timeout: 60_000 });
  console.log('✓ raw-предложение создано');

  // Порог 1 → автоголос автора сразу даёт кворум.
  await expect(page.getByText('1 / 1')).toBeVisible();
  await expect(page.getByText('Готово к исполнению')).toBeVisible();

  // Дизейблы для чужого кошелька: одобрять нельзя (не владелец), а вот исполнить —
  // можно: execute permissionless, подписантом там выступает казна, не человек.
  await page.getByRole('button', { name: 'Отключить' }).click();
  await page.getByRole('button', { name: 'Подключить кошелёк' }).click();
  await page.getByRole('menuitem', { name: 'Probe Two' }).click();
  await expect(page.getByRole('button', { name: 'Отключить' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Одобрить' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Исполнить' })).toBeEnabled();
  console.log('✓ не-владелец: одобрение закрыто, исполнение permissionless');

  await page.getByRole('button', { name: 'Отключить' }).click();
  await page.getByRole('button', { name: 'Подключить кошелёк' }).click();
  await page.getByRole('menuitem', { name: 'Probe One' }).click();
  await expect(page.getByRole('button', { name: 'Отключить' })).toBeVisible({ timeout: 20_000 });

  // --- Исполнение ---
  await page.getByRole('button', { name: 'Исполнить' }).click();
  await expect(page.getByText(/Симуляция успешна/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Подписать' }).click();
  // exact: бейдж «Исполнено» и подсказка «Предложение уже исполнено» — разные узлы.
  await expect(page.getByText('Исполнено', { exact: true })).toBeVisible({ timeout: 60_000 });
  console.log('✓ raw-предложение исполнено');

  expect(errors, `ошибки в консоли:\n${errors.join('\n')}`).toEqual([]);
});
