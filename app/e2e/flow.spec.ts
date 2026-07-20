import { test, expect } from '@playwright/test';
import { installWallets, loadSigner } from './wallet-stub';

/**
 * Full flow against the REAL devnet: create a 2-of-2 → fund the treasury →
 * propose a transfer → approve with the second owner → execute.
 * The wallets are stand-ins (see wallet-stub.ts), the application code that runs is the real one.
 */
const SP = '/tmp/user/1000/claude-1000/-home-art-projects-magican-solana-multisig/dee35d2c-476f-489a-be1b-a89317cc6451/scratchpad';

test('SOL proposal: create → approve → execute', async ({ page }) => {
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
    await page.getByRole('button', { name: 'Connect wallet' }).click();
    await page.getByRole('menuitem', { name }).click();
    await expect(page.getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });
  };

  // --- Connecting ---
  await page.goto('/');
  await connect('Probe One');
  console.log('✓ owner1 connected:', o1.address);

  // --- Creating the 2-of-2 multisig ---
  await page.goto('/create');
  const owners = page.locator('input[spellcheck="false"]');
  await owners.nth(1).fill(o2.address);
  await page.getByRole('button', { name: 'Simulate' }).click();
  await expect(page.getByText(/Simulation succeeded|✓/)).toBeVisible({ timeout: 30_000 });
  console.log('✓ creation simulation passed');

  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/m\/.+/, { timeout: 60_000 });
  const multisig = page.url().split('/m/')[1];
  console.log('✓ multisig created:', multisig);

  await expect(page.getByText('2-of-2')).toBeVisible({ timeout: 30_000 });

  // --- Funding the treasury ---
  await page.getByRole('button', { name: 'Fund' }).click();
  // exact: the treasury amount is shown twice — in the header and in the proposal form.
  await expect(page.getByText('0.1 SOL', { exact: true })).toBeVisible({ timeout: 60_000 });
  console.log('✓ treasury funded with 0.1 SOL');

  // --- Proposal: transfer 0.02 SOL to owner2 ---
  await page.getByPlaceholder('Recipient address').fill(o2.address);
  await page.getByPlaceholder('0.0').fill('0.02');
  await page.getByRole('button', { name: 'Simulate' }).click();
  await expect(page.getByText(/Simulation succeeded/)).toBeVisible({ timeout: 30_000 });

  // While the dialog is open the form is locked (a fieldset over display:contents — behaviour
  // that must be checked in a browser rather than taken on faith).
  await expect(page.getByPlaceholder('Recipient address')).toBeDisabled();

  // And the whole background is unreachable from the keyboard: the backdrop used to intercept
  // the mouse only, and Tab from under the modal reached «Fund» (a second wallet popup) and
  // «Disconnect» (unmounts the form mid-send). The native showModal() makes the document inert —
  // we verify that with focus, not with faith in the spec.
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
  const focusInsideDialog = await page.evaluate(
    () => document.activeElement?.closest('dialog') != null,
  );
  expect(focusInsideDialog, 'focus escaped the modal dialog').toBe(true);

  await page.getByRole('button', { name: 'Sign' }).click();
  await expect(page.getByText('#0')).toBeVisible({ timeout: 60_000 });
  console.log('✓ proposal #0 created');

  // The author's automatic approval: 1 of 2.
  await expect(page.getByText('1 / 2')).toBeVisible();
  await expect(page.getByText('Awaiting signatures')).toBeVisible();

  // Disabled states (Task 14): the author already voted, there is no quorum — nothing is
  // available, and the reason is stated as visible text, not only as a tooltip.
  await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Execute' })).toBeDisabled();
  await expect(page.getByText('You have already approved this proposal')).toBeVisible();
  console.log('✓ repeat approval blocked');

  // --- Approval by the second owner ---
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await connect('Probe Two');
  console.log('✓ switched to owner2:', o2.address);

  // Approval is already available to the second owner.
  await expect(page.getByRole('button', { name: 'Approve' })).toBeEnabled();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/Simulation succeeded/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Sign' }).click();
  await expect(page.getByText('2 / 2')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Ready to execute')).toBeVisible();
  console.log('✓ quorum 2/2 reached');

  // --- Execution ---
  await page.getByRole('button', { name: 'Execute' }).click();
  await expect(page.getByText(/Simulation succeeded/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Sign' }).click();
  // exact: the «Executed» badge and the «The proposal has already been executed» hint are
  // different nodes.
  await expect(page.getByText('Executed', { exact: true })).toBeVisible({ timeout: 60_000 });
  console.log('✓ proposal executed');

  // An executed proposal: both buttons are dead, and the reason is not «waiting for quorum»
  // (the quorum is in fact reached) but an honest «already executed».
  await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Execute' })).toBeDisabled();
  await expect(page.getByText('The proposal has already been executed')).toBeVisible();

  // The treasury shrank by the transferred amount.
  await expect(page.getByText('0.08 SOL', { exact: true })).toBeVisible({ timeout: 30_000 });
  console.log('✓ treasury: 0.08 SOL');

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});
