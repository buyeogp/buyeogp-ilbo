/**
 * 일보 3종 레이아웃을 한 번에 뽑는다. 원본 엑셀과 눈으로 대조하기 위한 것이다.
 *   node src/pdf/render-all.js [날짜]
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { renderPdf } from './render.js';
import { renderDailyReport } from './layout.js';
import { buildSamples } from './sample.js';

const date = process.argv[2] ?? '2026-08-18';
const samples = await buildSamples(date);
await mkdir('out', { recursive: true });

const puppeteer = (await import('puppeteer-core')).default;

for (const [key, rp] of Object.entries(samples)) {
  const { pdf, html, contentHash } = await renderPdf(rp);
  await writeFile(`out/${key}.pdf`, pdf);
  await writeFile(`out/${key}.html`, html, 'utf8');
  console.log(`${rp.house.name.padEnd(12)} ${rp.house.countBasis.padEnd(13)} `
    + `행 ${String(rp.rows.length).padStart(3)}  ${(pdf.length / 1024).toFixed(0).padStart(4)} KB  `
    + contentHash.slice(0, 16));
}

// 레이아웃 확인용 PNG — 인쇄물을 눈으로 보려면 이미지가 빠르다
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH
    ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--font-render-hinting=none'],
});
for (const [key, rp] of Object.entries(samples)) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1131, deviceScaleFactor: 1.4 });
  await page.setContent(renderDailyReport({ ...rp, contentHash: 'preview', printedAt: '미리보기' }),
                        { waitUntil: 'load' });
  await page.screenshot({ path: `out/${key}.png`, fullPage: true });
  await page.close();
}
await browser.close();
console.log(`\n출력 ${Object.keys(samples).length}종 → api/out/  (${date})`);
