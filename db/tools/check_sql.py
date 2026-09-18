"""SQL 정적 점검 — 실 DB 없이 돌리는 최소 검사.

  1) 문자열·달러인용·주석을 제대로 건너뛰며 괄호/따옴표 균형
  2) FK 전방 참조 (아직 만들지 않은 테이블을 참조)
  3) 생성열이 다른 생성열을 참조 (PostgreSQL 금지)
  4) 감사 트리거 / RLS 루프 대상 테이블 존재 여부와 farm_id 보유
  5) 참조 무결성: REFERENCES 대상 테이블·컬럼이 실제로 존재하는가

실행: python tools/check_sql.py
"""
import io, os, re, glob, sys

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))


def strip_sql(s):
    """문자열 리터럴 / 달러인용 / 주석을 공백으로 치환한 본문과,
       달러인용 블록 목록을 돌려준다."""
    out = []
    i, n = 0, len(s)
    dollars = 0
    while i < n:
        c = s[i]
        if c == '-' and s[i:i + 2] == '--':
            j = s.find('\n', i)
            j = n if j < 0 else j
            out.append(' ' * (j - i))
            i = j
        elif c == '/' and s[i:i + 2] == '/*':
            j = s.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append(' ' * (j - i))
            i = j
        elif c == "'":
            j = i + 1
            while j < n:
                if s[j] == "'":
                    if s[j:j + 2] == "''":
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            else:
                return None, dollars, i          # 닫히지 않은 문자열
            out.append(' ' * (j - i))
            i = j
        elif s[i:i + 2] == '$$':
            dollars += 1
            j = s.find('$$', i + 2)
            if j < 0:
                return None, dollars, i          # 닫히지 않은 $$
            dollars += 1
            out.append(' ' * (j + 2 - i))
            i = j + 2
        else:
            out.append(c)
            i += 1
    return ''.join(out), dollars, None


files = sorted(f for f in glob.glob('*.sql') if not f.startswith('000'))
problems = []
bodies = {}

print('── 1) 구문 균형 ──────────────────────────────────────')
for f in files:
    raw = io.open(f, encoding='utf-8').read()
    body, dollars, badpos = strip_sql(raw)
    if body is None:
        problems.append(f'{f}: 닫히지 않은 리터럴 (offset {badpos})')
        print(f'  {f:32s} ERR 닫히지 않은 리터럴')
        continue
    bodies[f] = (raw, body)
    par = body.count('(') - body.count(')')
    msg = 'OK' if par == 0 else f'ERR 괄호 {par:+d}'
    if par:
        problems.append(f'{f}: 괄호 불균형 {par:+d}')
    print(f'  {f:32s} {msg}  (문장 {body.count(";")}, $$ {dollars})')

allbody = '\n'.join(b for _, b in bodies.values())

print('\n── 2) FK 전방 참조 ───────────────────────────────────')
seen, created = set(), {}
fwd = []
for f in files:
    raw, body = bodies[f]
    for m in re.finditer(r'CREATE TABLE\s+(?:IF NOT EXISTS\s+)?((?:\w+\.)?\w+)(.*?)\n\);',
                         body, re.S):
        t = m.group(1).split('.')[-1]
        created[t] = f
        for r in re.finditer(r'REFERENCES\s+((?:\w+\.)?\w+)\s*\(([^)]*)\)', m.group(2)):
            tgt = r.group(1).split('.')[-1]
            if tgt != t and tgt not in seen:
                fwd.append(f'{f}: {t} -> {tgt}')
        seen.add(t)
print(f'  테이블 {len(created)}개 / 전방 참조 {len(fwd)}건')
for x in fwd:
    print('   ', x)
problems += fwd

print('\n── 3) 생성열 상호 참조 ───────────────────────────────')
bad = []
for m in re.finditer(r'CREATE TABLE\s+(?:\w+\.)?(\w+)(.*?)\n\);', allbody, re.S):
    t, blk = m.group(1), m.group(2)
    gens = {}
    for g in re.finditer(r'^\s*(\w+)\s+[\w()\d, ]+?\s*GENERATED ALWAYS AS\s*\((.*?)\)\s*STORED',
                         blk, re.M | re.S):
        gens[g.group(1)] = g.group(2)
    for name, expr in gens.items():
        for other in gens:
            if other != name and re.search(r'\b' + other + r'\b', expr):
                bad.append(f'{t}.{name} -> {other}')
print(f'  {len(bad)}건')
for x in bad:
    print('   ', x)
problems += bad

print('\n── 4) 트리거 / RLS 대상 ──────────────────────────────')
def loop_tables(fname):
    # DO $$ ... $$ 안이므로 원문에서 찾는다 (strip_sql 은 $$ 블록을 지운다)
    raw = bodies[fname][0]
    m = re.search(r'FOREACH t IN ARRAY ARRAY\[(.*?)\]', raw, re.S)
    return re.findall(r"'(\w+)'", m.group(1)) if m else []

for fname, label in [('011_functions_triggers.sql', '감사 트리거'),
                     ('014_rls.sql', 'RLS')]:
    ts = loop_tables(fname)
    miss = [t for t in ts if t not in created]
    print(f'  {label:10s} {len(ts):3d}개  미존재 {miss}')
    problems += [f'{label} 대상 미존재: {t}' for t in miss]
    if label == 'RLS':
        for t in ts:
            mm = re.search(r'CREATE TABLE\s+(?:\w+\.)?' + t + r'\b(.*?)\n\);', allbody, re.S)
            if mm and 'farm_id' not in mm.group(1):
                print(f'    !! farm_id 없음: {t}')
                problems.append(f'RLS 대상에 farm_id 없음: {t}')

print('\n── 5) REFERENCES 대상 컬럼 ───────────────────────────')
cols = {}
for m in re.finditer(r'CREATE TABLE\s+(?:\w+\.)?(\w+)(.*?)\n\);', allbody, re.S):
    t, blk = m.group(1), m.group(2)
    cols[t] = set(re.findall(r'^\s*(\w+)\s+\w', blk, re.M))
missing = []
for m in re.finditer(r'REFERENCES\s+(?:\w+\.)?(\w+)\s*\(([^)]*)\)', allbody):
    t, cl = m.group(1), [c.strip() for c in m.group(2).split(',')]
    if t not in cols:
        missing.append(f'테이블 없음: {t}')
        continue
    for c in cl:
        if c and c not in cols[t] and c != 'id':
            missing.append(f'{t}.{c} 없음')
missing = sorted(set(missing))
print(f'  {len(missing)}건')
for x in missing:
    print('   ', x)
problems += missing

print('\n' + '=' * 55)
print(f'총 문제 {len(problems)}건')
sys.exit(1 if problems else 0)
