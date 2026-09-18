/**
 * 일보 PDF 렌더러 — 설계문서 §6.5 / §7.2
 *
 * HACCP 전자기록이 인정되지 않으므로 시스템이 종이를 만든다.
 * 출력물과 시스템 데이터가 같다는 것은 content_hash 로 증명한다
 * (submission_signature.content_hash 와 같은 값이어야 한다).
 *
 * Chromium 은 내려받지 않고 시스템에 설치된 Chrome 을 쓴다 — puppeteer-core.
 * 서버 컨테이너에서는 CHROME_PATH 로 경로를 준다.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { renderDailyReport } from './layout.js';

/** 일보 스냅샷의 정규화 해시. 필드 순서를 고정해야 같은 데이터가 같은 해시를 낸다 */
export function contentHash(rp) {
  const canonical = JSON.stringify({
    house: rp.house.code,
    date: rp.reportDate,
    rows: [...rp.rows]
      .map((r) => [
        r.penCode ?? '', r.categoryCode ?? '',
        r.opening, r.inHead, r.outHead, r.internalOut,
        r.sold ?? 0, r.dead, r.closing,
      ])
      .sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1])),
    note: rp.noteText ?? '',
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const guesses = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  ];
  const found = guesses.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      'Chrome 을 찾지 못했습니다. CHROME_PATH 환경 변수로 경로를 지정하십시오.\n' +
      '  컨테이너에서는 chromium 과 한글 글꼴(fonts-noto-cjk)을 함께 설치해야 합니다.');
  }
  return found;
}

/** 일보 한 건을 PDF 버퍼로 만든다 */
export async function renderPdf(report, { launch } = {}) {
  const rp = { ...report };
  rp.contentHash ??= contentHash(rp);
  rp.printedAt ??= new Date().toISOString().replace('T', ' ').slice(0, 16);

  const html = renderDailyReport(rp);

  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    ...launch,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
    });
    return { pdf, html, contentHash: rp.contentHash };
  } finally {
    await browser.close();
  }
}

/** CLI: node src/pdf/render.js <샘플키> [출력경로] */
const { pathToFileURL } = await import('node:url');
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { buildSamples } = await import('./sample.js');
  const key = process.argv[2] ?? 'JADON';
  const out = process.argv[3] ?? `out/${key}.pdf`;

  const samples = await buildSamples();
  const rp = samples[key];
  if (!rp) {
    console.error(`샘플이 없습니다: ${key}`);
    console.error('사용 가능:', Object.keys(samples).join(', '));
    process.exit(1);
  }

  const { pdf, html, contentHash: h } = await renderPdf(rp);
  await writeFile(out, pdf);
  await writeFile(out.replace(/\.pdf$/, '.html'), html, 'utf8');
  console.log(`${rp.house.name} ${rp.reportDate}  행 ${rp.rows.length}`);
  console.log(`  PDF  ${out}  (${(pdf.length / 1024).toFixed(0)} KB)`);
  console.log(`  해시 ${h.slice(0, 32)}…`);
}
