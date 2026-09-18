"""현행 일보 5종에서 돈방·집계행을 판독해 016_seed_pen.sql 을 생성한다."""
import openpyxl, os, re, io
from collections import Counter

SRC = r'C:\Users\mecha\project\buyeoGP\자료들'
OUT = r'C:\Users\mecha\project\buyeoGP\db\016_seed_pen.sql'
os.chdir(SRC)

PEN = re.compile(r'^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$')
norm = lambda v: re.sub(r'\s+', '', '' if v is None else str(v))


def grid(ws, ncol=3):
    """read_only 시트를 한 번만 훑어 {행: [셀…]} 로 만든다.
       read_only 모드의 ws.cell() 은 임의접근이 O(n^2) 이므로 쓰지 않는다."""
    g = {}
    for r, row in enumerate(ws.iter_rows(min_row=1, max_row=ws.max_row,
                                         max_col=ncol, values_only=True), 1):
        g[r] = list(row)
    return g


def title_blocks(g, kw, col=1):
    starts = [r for r in sorted(g) if g[r][col - 1] and kw in str(g[r][col - 1])]
    starts.append(max(g) + 1 if g else 1)
    return [(starts[i], starts[i + 1] - 1) for i in range(len(starts) - 1)]


def pens_in(f, sheets, kw, col=1, keep=None):
    """블록마다 돈방 목록을 뽑고 최빈 목록을 돌려준다."""
    wb = openpyxl.load_workbook(f, data_only=True, read_only=True)
    sig = Counter()
    for sn in sheets:
        if sn not in wb.sheetnames:
            continue
        g = grid(wb[sn], col)
        for lo, hi in title_blocks(g, kw, col):
            got = []
            for r in range(lo, hi + 1):
                m = PEN.match(norm(g.get(r, [None] * col)[col - 1]))
                if m:
                    code = f'{int(m.group(1))}-{int(m.group(2))}'
                    if keep and not keep(m):
                        continue
                    if code not in got:
                        got.append(code)
            if got:
                sig[tuple(got)] += 1
    wb.close()
    best, n = sig.most_common(1)[0]
    return list(best), sig, n


report = []
pens = {}

pens['JADON'], s1, n1 = pens_in('자돈사,육성사.xlsx', ['자돈8월', '자돈9월'], '자돈사 일지')
report.append(('자돈사', len(pens['JADON']), sum(s1.values()), n1, len(s1)))

pens['YUKSUNG'], s2, n2 = pens_in('자돈사,육성사.xlsx', ['육성8월', '육성9월'], '육성사 일지')
report.append(('육성사', len(pens['YUKSUNG']), sum(s2.values()), n2, len(s2)))

pens['GEOMJUNG'], s3, n3 = pens_in('검정사일보.xlsx', ['8월', '9월'], '검정사 일지')
report.append(('검정사', len(pens['GEOMJUNG']), sum(s3.values()), n3, len(s3)))

pens['BIYUK_M'], s4, n4 = pens_in('비육사일보.xlsx', ['8월', '9월'], '비육사 일지')
report.append(('비육사(수)', len(pens['BIYUK_M']), sum(s4.values()), n4, len(s4)))

pens['BUNMAN1'], s5, n5 = pens_in('분만사일보.xlsx', ['분만8월', '분만9월'], '분만사 일지',
                                  keep=lambda m: m.group(1) == '1')
report.append(('분만1동', len(pens['BUNMAN1']), sum(s5.values()), n5, len(s5)))

pens['BUNMAN2'], s6, n6 = pens_in('분만사일보.xlsx', ['분만8월', '분만9월'], '분만사 일지',
                                  keep=lambda m: m.group(1) == '2')
report.append(('분만2동', len(pens['BUNMAN2']), sum(s6.values()), n6, len(s6)))

# 종부사일보 : 돈사 x 축종구분
HOUSES = {'순치사': 'SUNCHI', '종부사': 'JONGBU', '임신1동': 'IMSIN1', '임신2동': 'IMSIN2'}
wb = openpyxl.load_workbook('종부사일보.xlsx', data_only=True, read_only=True)
cats = {}
sigc = Counter()
for sn in ['종부8월', '종부9월']:
    g = grid(wb[sn], 3)
    for lo, hi in title_blocks(g, '일지', col=2):
        cur, rows = None, []
        for r in range(lo, hi + 1):
            row = g.get(r, [None, None, None])
            b, c = norm(row[1]), norm(row[2])
            if b in HOUSES:
                cur = b
            if b == '합계':
                break
            if cur and c and c != '계':
                rows.append((cur, c))
        if rows:
            sigc[tuple(rows)] += 1
wb.close()
best, nblocks = sigc.most_common(1)[0]
for h, c in best:
    cats.setdefault(HOUSES[h], []).append(c)
report.append(('종부사일보(축종구분)', sum(len(v) for v in cats.values()),
               sum(sigc.values()), nblocks, len(sigc)))

# 대장 원문 -> pig_category 코드
CATMAP = {
    '후보(수)': 'CAND_M', '후보(암)': 'CAND_F', '웅돈': 'BOAR',
    '이유모돈': 'WEAN_SOW', '이유돈': 'WEAN_PIG',
    '체류돈': 'STAY', '단기쳬류': 'STAY_S', '단기체류': 'STAY_S', '장기체류': 'STAY_L',
    '임신돈': 'PREG',
}
BUNMAN_CATS = ['FARROW_WAIT', 'LACT_SOW', 'SUCK', 'WEANED']

print('=== 판독 결과 ===')
for name, cnt, blocks, top, variants in report:
    flag = '' if variants == 1 else f'  (서로 다른 구성 {variants}종 — 최빈 {top}/{blocks} 블록)'
    print(f'  {name:20s} {cnt:3d}행  블록 {blocks:3d}개{flag}')

unknown = [c for v in cats.values() for c in v if c not in CATMAP]
if unknown:
    print('  !! 미매핑 축종구분:', unknown)

# ---------------- SQL 생성 ----------------
L = []
w = L.append
w('-- =====================================================================')
w('-- 016 돈방 · 돈사별 집계행 — M1 마스터 정비')
w('--')
w('-- 현행 일보 5종의 「구분」 열을 직접 판독해 생성했다. 손으로 쓴 값이 아니다.')
w('--   원천 : 자돈사,육성사.xlsx / 분만사일보.xlsx / 검정사일보.xlsx')
w('--          비육사일보.xlsx / 종부사일보.xlsx  (2026-08~09 운영본)')
w('--   생성 : db/tools/gen_016_seed_pen.py')
w('-- =====================================================================')
w('SET search_path = app, sec, public;')
w('')
w('-- ── 돈방 ─────────────────────────────────────────────────────────────')
w('INSERT INTO pen (farm_id, house_id, code, seq, active_from)')
w('SELECT h.farm_id, h.id, v.code, v.seq, DATE \'2026-08-06\'')
w('  FROM house h')
w('  JOIN (VALUES')
rows = []
for hc in ['BUNMAN1', 'BUNMAN2', 'JADON', 'YUKSUNG', 'GEOMJUNG', 'BIYUK_M']:
    for i, code in enumerate(pens[hc], 1):
        rows.append(f"    ('{hc}','{code}',{i * 10})")
w(',\n'.join(rows))
w('  ) AS v(house_code, code, seq) ON v.house_code = h.code')
w(" WHERE h.farm_id = (SELECT id FROM farm WHERE code = 'BUYEO');")
w('')
w("COMMENT ON COLUMN pen.active_from IS")
w("  '2026-08-06 — 엑셀 일보 운영 개시일. 그 이전은 전량 종이 작성이므로 적재 대상이 아니다 (§1.1)';")
w('')
w('-- ── 돈사별 집계행 (count_basis = category / pen_category) ────────────')
w('INSERT INTO house_category (farm_id, house_id, category_id, seq)')
w('SELECT h.farm_id, h.id, c.id, v.seq')
w('  FROM house h')
w('  JOIN (VALUES')
rows = []
for hc in ['SUNCHI', 'JONGBU', 'IMSIN1', 'IMSIN2']:
    for i, cat in enumerate(cats.get(hc, []), 1):
        rows.append(f"    ('{hc}','{CATMAP[cat]}',{i * 10})")
for hc in ['BUNMAN1', 'BUNMAN2']:
    for i, code in enumerate(BUNMAN_CATS, 1):
        rows.append(f"    ('{hc}','{code}',{i * 10})")
w(',\n'.join(rows))
w('  ) AS v(house_code, cat_code, seq) ON v.house_code = h.code')
w('  JOIN pig_category c ON c.code = v.cat_code')
w(" WHERE h.farm_id = (SELECT id FROM farm WHERE code = 'BUYEO');")
w('')
w('-- ── 적재 검증 ────────────────────────────────────────────────────────')
w('DO $$')
w('DECLARE r record; v_expect jsonb := \'' +
  '{"분만1동":%d,"분만2동":%d,"자돈사":%d,"육성사":%d,"검정사":%d,"비육사(수)":%d}' %
  (len(pens['BUNMAN1']), len(pens['BUNMAN2']), len(pens['JADON']),
   len(pens['YUKSUNG']), len(pens['GEOMJUNG']), len(pens['BIYUK_M'])) + '\'::jsonb;')
w('BEGIN')
w('  FOR r IN SELECT h.name, count(p.id) AS n FROM house h')
w('             LEFT JOIN pen p ON p.house_id = h.id GROUP BY h.name LOOP')
w('    IF jsonb_exists(v_expect, r.name) AND (v_expect ->> r.name)::int <> r.n THEN')
w("      RAISE EXCEPTION '돈방 적재 불일치: % 기대 % / 실제 %',")
w("        r.name, v_expect ->> r.name, r.n;")
w('    END IF;')
w('  END LOOP;')
w("  RAISE NOTICE '돈방 % 개, 집계행 % 개 적재',")
w('    (SELECT count(*) FROM pen), (SELECT count(*) FROM house_category);')
w('END $$;')
w('')

io.open(OUT, 'w', encoding='utf-8').write('\n'.join(L) + '\n')
print()
print('생성:', OUT, f'({len(L)} 줄)')
print('돈방 합계:', sum(len(pens[k]) for k in pens))
print('집계행 합계:', sum(len(v) for v in cats.values()) + 2 * len(BUNMAN_CATS))
