import { test, expect } from '@playwright/test';
import { installWallets, loadSigner } from './wallet-stub';

/**
 * Raw mode against the REAL devnet: an arbitrary nested instruction (Memo)
 * signed by the multisig treasury. We take a 1-of-1 multisig — the author's approval
 * already is the quorum, so the whole path is walked with a single wallet, and the main
 * thing is verified: a raw proposal is not only created but also EXECUTED.
 */
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const SP =
  '/tmp/user/1000/claude-1000/-home-art-projects-magican-solana-multisig/dee35d2c-476f-489a-be1b-a89317cc6451/scratchpad';

test('raw proposal (Memo): create → execute', async ({ page }) => {
  const o1 = await loadSigner(`${process.env.HOME}/.config/solana/id.json`);
  // The second wallet is NOT an owner of this 1-of-1 — we use it to check the disabled states.
  const stranger = await loadSigner(`${SP}/owner2.json`);
  await installWallets(page, [
    { name: 'Probe One', ...o1 },
    { name: 'Probe Two', ...stranger },
  ]);

  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('menuitem', { name: 'Probe One' }).click();
  await expect(page.getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });

  // --- The 1-of-1 multisig ---
  await page.goto('/create');
  await page.getByRole('button', { name: 'Remove owner' }).click();
  await page.getByRole('spinbutton').fill('1');
  await page.getByRole('button', { name: 'Simulate' }).click();
  await expect(page.getByText(/Simulation succeeded|✓/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/m\/.+/, { timeout: 60_000 });
  await expect(page.getByText('1-of-1')).toBeVisible({ timeout: 30_000 });
  console.log('✓ 1-of-1 multisig created:', page.url().split('/m/')[1]);

  // We fund the treasury so that its account exists by the time of invoke_signed.
  await page.getByRole('button', { name: 'Fund' }).click();
  await expect(page.getByText('0.1 SOL', { exact: true })).toBeVisible({ timeout: 60_000 });

  // --- Raw proposal: a Memo signed by the treasury ---
  await page.getByRole('tab', { name: 'Raw' }).click();
  await page.getByPlaceholder('Program address').fill(MEMO_PROGRAM);
  await page.getByRole('button', { name: '+ Treasury' }).click();
  await page
    .getByPlaceholder('Empty — if the instruction takes no data')
    .fill(Buffer.from('magican raw ok').toString('base64'));

  await page.getByRole('button', { name: 'Simulate' }).click();
  await expect(page.getByText(/Simulation succeeded/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Sign' }).click();
  await expect(page.getByText('#0')).toBeVisible({ timeout: 60_000 });
  console.log('✓ raw proposal created');

  // Threshold 1 → the author's automatic approval immediately gives a quorum.
  await expect(page.getByText('1 / 1')).toBeVisible();
  await expect(page.getByText('Ready to execute')).toBeVisible();

  // Disabled states for a foreign wallet: approving is not allowed (not an owner), but executing
  // is: execute is permissionless, the signer there is the treasury, not a human.
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('menuitem', { name: 'Probe Two' }).click();
  await expect(page.getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Execute' })).toBeEnabled();
  console.log('✓ non-owner: approval closed, execution permissionless');

  await page.getByRole('button', { name: 'Disconnect' }).click();
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('menuitem', { name: 'Probe One' }).click();
  await expect(page.getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });

  // --- Execution ---
  await page.getByRole('button', { name: 'Execute' }).click();
  await expect(page.getByText(/Simulation succeeded/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Sign' }).click();
  // exact: the «Executed» badge and the «The proposal has already been executed» hint are
  // different nodes.
  await expect(page.getByText('Executed', { exact: true })).toBeVisible({ timeout: 60_000 });
  console.log('✓ raw proposal executed');

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});
