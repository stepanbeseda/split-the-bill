import { expect, test, type Page } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

const pick = (page: Page, name: string) => page.locator('#people').getByRole('button', { name, exact: true }).click();
const plus = (page: Page, item: string) => page.getByRole('button', { name: `+ ${item}`, exact: true }).click();

test('two people see each other’s picks live and pay with an EPC QR code', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await a.goto('/b/demo');
  await b.goto('/b/demo');
  await expect(a.locator('#sync')).toContainText('live');

  await pick(a, 'Sam');
  await plus(a, 'Lasagne');
  await plus(a, 'Lasagne');
  await pick(b, 'Kim');

  // Both lasagnes are gone for Kim: the card moves to "Already taken".
  await expect(b.locator('details.gone summary')).toHaveText('Already taken (1)', { timeout: 10_000 });

  await plus(b, 'Craft beer');
  await b.locator('#bar-pay').click();
  await expect(b.locator('#pay-amount')).toHaveText('€6.60');
  const shot = PNG.sync.read(await b.locator('#pay-qr').screenshot());
  const qr = jsQR(new Uint8ClampedArray(shot.data), shot.width, shot.height);
  expect(qr?.data.split('\n')).toEqual(['BCD', '002', '1', 'SCT', '', 'Alex Example', 'DE89370400440532013000', 'EUR6.60', '', '', 'Kim Trattoria Demo']);
});

test('unknown bills show a friendly error', async ({ page }) => {
  await page.goto('/b/does-not-exist');
  await expect(page.locator('#app')).toContainText('does not exist');
});
