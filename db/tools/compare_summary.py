"""종합일보(본사 재입력본) vs 개별일보(현장 원본) 대조.

설계문서 D1·D2·D3 의 실측치를 낸다.
  D1 동일 사실을 3회 기록 · D2 전달 매체가 스크린샷 · D3 계산 실수

개별일보는 db/migration/m3_pen_daily.csv (parse_daily_reports.py 산출물)를 쓴다.
종합일보는 자료들/일보양식/202608 종합일보(HACCP 기준).xlsx.

돈사별 「두수합계」를 맞대본다. 두 문서의 축종구분 분류가 서로 달라
(종합일보 순치사: 후보(암)·웅돈·도태대기·이유모돈·장기체류돈·임신돈 /
 개별일보 순치사: 후보(수)·후보(암)·이유모돈·체류돈·임신돈)
항목 단위 비교는 성립하지 않기 때문이다 — 그 자체가 D1 의 증거다.

실행: python db/tools/compare_summary.py
"""
import openpyxl, os, re, csv, io, datetime
from collections import defaultdict

BASE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SUMMARY = os.path.join(BASE, '자료들', '일보양식', '202608 종합일보(HACCP 기준).xlsx')
CSV = os.path.join(BASE, 'db', 'migration', 'm3_pen_daily.csv')
OUT = os.path.join(BASE, 'db', 'migration', 'm3_summary_diff.md')

norm = lambda v: re.sub(r'\s+', '', '' if v is None else str(v))
HOUSE = {'순치사': 'SUNCHI', '종부사': 'JONGBU', '임신1동': 'IMSIN1',
         '임신2동': 'IMSIN2', '분만1동': 'BUNMAN1', '분만2동': 'BUNMAN2'}


def num(v):
    if isinstance(v, (int, float)):
        return int(round(v))
    if isinstance(v, str) and re.match(r'^-?\d+(\.\d+)?$', v.strip()):
        return int(round(float(v)))
    return None


# ── 개별일보 (현장 원본) ─────────────────────────────────────────────
field = defaultdict(lambda: defaultdict(int))      # (house, date) -> {opening, closing}
for r in csv.DictReader(io.open(CSV, encoding='utf-8')):
    k = (r['house_code'], r['report_date'])
    field[k]['opening'] += int(r['opening_head'])
    if r['excel_closing'] != '':
        field[k]['closing'] += int(r['excel_closing'])
    field[k]['rows'] += 1

# ── 종합일보 (본사 재입력본) ─────────────────────────────────────────
wb = openpyxl.load_workbook(SUMMARY, data_only=True, read_only=True)
summary = {}
for sn in wb.sheetnames:
    if not re.match(r'^\d{4}$', sn):
        continue
    d = f'2026-{sn[:2]}-{sn[2:]}'
    ws = wb[sn]
    g = {}
    for r, row in enumerate(ws.iter_rows(min_row=1, max_row=min(40, ws.max_row),
                                         max_col=8, values_only=True), 1):
        g[r] = list(row)
    cur = None
    for r in sorted(g):
        a, b = norm(g[r][0]), norm(g[r][1])
        if a in HOUSE:
            cur = HOUSE[a]
        if cur and b == '두수합계':
            v = num(g[r][6])                       # G 열 = 전일두수
            if v is not None:
                summary[(cur, d)] = v
            cur = None
wb.close()

# ── 대조 ─────────────────────────────────────────────────────────────
# 종합일보 시트 0825 의 「전일두수」가 개별일보 어느 날 값과 맞는지 먼저 정한다.
def shift_score(days):
    ok = tot = 0
    for (h, d), sv in summary.items():
        dt = datetime.date.fromisoformat(d) + datetime.timedelta(days=days)
        k = (h, dt.isoformat())
        if k in field and field[k]['rows']:
            tot += 1
            if field[k]['opening'] == sv:
                ok += 1
    return ok, tot


best, cand = None, {}
for shift in (0, -1, 1):
    ok, tot = shift_score(shift)
    cand[shift] = (ok, tot)
    if tot and (best is None or ok / tot > cand[best][0] / max(cand[best][1], 1)):
        best = shift

rows_out, mismatch = [], []
ok = tot = 0
for (h, d), sv in sorted(summary.items(), key=lambda x: (x[0][1], x[0][0])):
    dt = (datetime.date.fromisoformat(d) + datetime.timedelta(days=best)).isoformat()
    k = (h, dt)
    if k not in field or not field[k]['rows']:
        continue
    fv = field[k]['opening']
    tot += 1
    if fv == sv:
        ok += 1
    else:
        mismatch.append((d, h, sv, fv, sv - fv))

L = []
w = L.append
w('# 종합일보 ↔ 개별일보 대조')
w('')
w('본사 종합일보(재입력본)의 돈사별 「두수합계 · 전일두수」를')
w('현장 개별일보에서 같은 값을 합산해 맞대봤다.')
w('')
w('## 정렬 확인')
w('')
w('종합일보 시트 `MMDD` 의 전일두수가 개별일보의 어느 날짜와 맞는지 먼저 확정했다.')
w('')
w('| 시트 날짜 대비 | 일치 / 비교 |')
w('|---|---|')
for s in (0, -1, 1):
    o, t = cand[s]
    mark = '  ← 채택' if s == best else ''
    w(f'| {s:+d}일 | {o} / {t}{mark} |')
w('')
w('## 결과')
w('')
w(f'- 비교 가능 조합: **{tot}**  (돈사 {len({h for h, _ in summary})}개 × 겹치는 일자)')
w(f'- 일치: **{ok}**')
w(f'- 불일치: **{tot - ok}**' + (f'  ({100.0 * (tot - ok) / tot:.1f}%)' if tot else ''))
w('')
if mismatch:
    w('| 일자 | 돈사 | 종합일보 | 개별일보 | 차이 |')
    w('|---|---|---:|---:|---:|')
    for d, h, sv, fv, diff in mismatch[:40]:
        w(f'| {d} | {h} | {sv:,} | {fv:,} | {diff:+,} |')
    if len(mismatch) > 40:
        w(f'| … | 외 {len(mismatch) - 40}건 | | | |')
    w('')
w('## 분류 체계가 서로 다르다 (D1)')
w('')
w('두 문서는 같은 돈사를 다른 축종구분으로 쪼갠다.')
w('')
w('```')
w('순치사   개별일보  후보(수) · 후보(암) · 이유모돈 · 체류돈 · 임신돈')
w('         종합일보  후보(암) · 웅돈 · 도태대기 · 이유모돈 · 장기체류돈 · 임신돈')
w('종부사   개별일보  웅돈 · 후보(암) · 이유돈 · 단기체류 · 장기체류 · 임신돈')
w('         종합일보  후보(암) · 단기체류(이유모돈) · 장기체류 · 도태대기 · 임신돈')
w('```')
w('')
w('항목 단위로는 대조 자체가 불가능하고 합계로만 맞댈 수 있다.')
w('같은 사실을 세 곳에 서로 다른 구조로 적고 있다는 뜻이며,')
w('신규 시스템에서 종합일보를 뷰로 만들면 이 불일치가 원천적으로 사라진다 (설계문서 §4.13).')

io.open(OUT, 'w', encoding='utf-8').write('\n'.join(L) + '\n')
print(f'정렬: 시트 날짜 {best:+d}일  (후보 {cand})')
print(f'비교 {tot} · 일치 {ok} · 불일치 {tot - ok}')
for m in mismatch[:12]:
    print(f'   {m[0]} {m[1]:9s} 종합 {m[2]:6,} / 개별 {m[3]:6,}  차이 {m[4]:+,}')
print('→', OUT)
