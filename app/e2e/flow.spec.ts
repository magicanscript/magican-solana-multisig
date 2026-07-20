import { test, expect } from '@playwright/test';
import { installWallets, loadSigner } from './wallet-stub';

/**
 * Полный флоу против РЕАЛЬНОГО devnet: создать 2-of-2 → пополнить казну →
 * предложить перевод → одобрить вторым владельцем → исполнить.
 * Кошельки — дублёры (см. wallet-stub.ts), код приложения исполняется настоящий.
 */
const SP = '/tmp/user/1000/claude-1000/-home-art-projects-magican-solana-multisig/dee35d2c-476f-489a-be1b-a89317cc6451/scratchpad';

test('SOL-предложение: создать → одобрить → исполнить', async ({ page }) => {
  const o1 = await loadSigner(`${process.env.HOME}/.config/solana/id.json`);
  const o2 = await loadSigner(`${SP}/owner2.json`);
  await installWallets(page, [
    { name: 'Probe One', ...o1 },
    { name: 'Probe Two', ...o2 },
  ]);

  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  const connect = async (name: string) => {
    await page.getByRole('button', { name: 'Подключить кошелёк' }).click();
    await page.getByRole('menuitem', { name }).click();
    await expect(page.getByRole('button', { name: 'Отключить' })).toBeVisible({ timeout: 20_000 });
  };

  // --- Подключение ---
  await page.goto('/');
  await connect('Probe One');
  console.log('✓ подключён owner1:', o1.address);

  // --- Создание мультисига 2-of-2 ---
  await page.goto('/create');
  const owners = page.locator('input[spellcheck="false"]');
  await owners.nth(1).fill(o2.address);
  await page.getByRole('button', { name: 'Проверить' }).click();
  await expect(page.getByText(/Симуляция успешна|✓/)).toBeVisible({ timeout: 30_000 });
  console.log('✓ симуляция создания прошла');

  await page.getByRole('button', { name: 'Создать' }).click();
  await page.waitForURL(/\/m\/.+/, { timeout: 60_000 });
  const multisig = page.url().split('/m/')[1];
  console.log('✓ мультисиг создан:', multisig);

  await expect(page.getByText('2-of-2')).toBeVisible({ timeout: 30_000 });

  // --- Пополнение казны ---
  await page.getByRole('button', { name: 'Пополнить' }).click();
  // exact: сумма казны показана дважды — в шапке и в форме предложения.
  await expect(page.getByText('0.1 SOL', { exact: true })).toBeVisible({ timeout: 60_000 });
  console.log('✓ казна пополнена на 0.1 SOL');

  // --- Предложение: перевод 0.02 SOL на owner2 ---
  await page.getByPlaceholder('Адрес получателя').fill(o2.address);
  await page.getByPlaceholder('0.0').fill('0.02');
  await page.getByRole('button', { name: 'Проверить' }).click();
  await expect(page.getByText(/Симуляция успешна/)).toBeVisible({ timeout: 30_000 });

  // Пока открыт диалог, форма заперта (fieldset поверх display:contents — поведение,
  // которое обязано проверяться в браузере, а не приниматься на слово).
  await expect(page.getByPlaceholder('Адрес получателя')).toBeDisabled();

  // И весь фон недостижим с клавиатуры: раньше подложка перехватывала только мышь,
  // и Tab'ом из-под модалки жались «Пополнить» (второй попап кошелька) и «Отключить»
  // (размонтирует форму мид-сендом). Нативный showModal() делает документ инертным —
  // проверяем это фокусом, а не верой в спецификацию.
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
  const focusInsideDialog = await page.evaluate(
    () => document.activeElement?.closest('dialog') != null,
  );
  expect(focusInsideDialog, 'фокус ушёл за пределы модального диалога').toBe(true);

  await page.getByRole('button', { name: 'Подписать' }).click();
  await expect(page.getByText('#0')).toBeVisible({ timeout: 60_000 });
  console.log('✓ предложение #0 создано');

  // Автоголос автора: 1 из 2.
  await expect(page.getByText('1 / 2')).toBeVisible();
  await expect(page.getByText('Ждёт подписей')).toBeVisible();

  // Дизейблы (Task 14): автор уже проголосовал, кворума нет — недоступно ничего,
  // и причина названа видимым текстом, а не только tooltip'ом.
  await expect(page.getByRole('button', { name: 'Одобрить' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Исполнить' })).toBeDisabled();
  await expect(page.getByText('Вы уже одобрили это предложение')).toBeVisible();
  console.log('✓ повторное одобрение заблокировано');

  // --- Одобрение вторым владельцем ---
  await page.getByRole('button', { name: 'Отключить' }).click();
  await connect('Probe Two');
  console.log('✓ переключились на owner2:', o2.address);

  // Второму владельцу одобрение уже доступно.
  await expect(page.getByRole('button', { name: 'Одобрить' })).toBeEnabled();
  await page.getByRole('button', { name: 'Одобрить' }).click();
  await expect(page.getByText(/Симуляция успешна/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Подписать' }).click();
  await expect(page.getByText('2 / 2')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Готово к исполнению')).toBeVisible();
  console.log('✓ кворум 2/2 собран');

  // --- Исполнение ---
  await page.getByRole('button', { name: 'Исполнить' }).click();
  await expect(page.getByText(/Симуляция успешна/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Подписать' }).click();
  // exact: бейдж «Исполнено» и подсказка «Предложение уже исполнено» — разные узлы.
  await expect(page.getByText('Исполнено', { exact: true })).toBeVisible({ timeout: 60_000 });
  console.log('✓ предложение исполнено');

  // Исполненное предложение: обе кнопки мертвы, причина — не «ждём кворума»
  // (кворум как раз собран), а честное «уже исполнено».
  await expect(page.getByRole('button', { name: 'Одобрить' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Исполнить' })).toBeDisabled();
  await expect(page.getByText('Предложение уже исполнено')).toBeVisible();

  // Казна уменьшилась на сумму перевода.
  await expect(page.getByText('0.08 SOL', { exact: true })).toBeVisible({ timeout: 30_000 });
  console.log('✓ казна: 0.08 SOL');

  expect(errors, `ошибки в консоли:\n${errors.join('\n')}`).toEqual([]);
});
