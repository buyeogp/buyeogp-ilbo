/**
 * 사용 설명서 — 설계문서 §6.4 P10
 *
 * 쓰는 사람이 외국인 팀장 4명이다. 긴 문장을 쓰지 않는다.
 * 짧은 문장, 순서 번호, 키 이름, 색깔. 「왜」보다 「어떻게」를 먼저 쓴다.
 *
 * 두 가지를 지킨다.
 *  1. **실제 화면을 넣는다.** 글로만 설명한 자리는 읽는 사람이 자기 화면과
 *     맞춰 보지 못한다. 중요한 화면에는 번호를 찍고 아래에 무엇인지 적는다.
 *  2. **등급에 따라 보여 주는 내용이 다르다.** 팀장에게 「확정」 절차를 읽히면
 *     자기 일인 줄 안다. 단 윗 등급은 아랫 등급 내용을 볼 수 있어야 한다 —
 *     팀장을 가르치는 사람이 그 화면을 봐야 하기 때문이다.
 *
 * 인쇄해서 사무실 벽에 붙일 수 있어야 한다. 막혔을 때 화면을 못 여는 경우가
 * 있다. 인쇄하면 지금 고른 등급의 내용만 나온다.
 */
import { useMemo, useState } from 'react';

/** 보는 사람의 처지. 직책이 아니라 「무엇을 하는 사람인가」로 나눈다. */
const VIEWS = [
  { id: 'field', label: '팀장', sub: '일보를 쓰는 사람' },
  { id: 'hq', label: '본사', sub: '확인하고 확정하는 사람' },
  { id: 'admin', label: '관리자', sub: '담당·계정을 고치는 사람' },
];

const SECTIONS = [
  { id: 'start', title: '시작하기', views: ['field', 'hq', 'admin'] },
  { id: 'write', title: '일보 쓰기', views: ['field'] },
  { id: 'red', title: '빨간 칸이 나오면', views: ['field'] },
  { id: 'submit', title: '제출하기', views: ['field'] },
  { id: 'confirm', title: '확인하고 확정하기', views: ['hq'] },
  { id: 'paper', title: '종이 출력과 보관', views: ['field', 'hq'] },
  { id: 'scope', title: '담당 바꾸기', views: ['admin'] },
  { id: 'account', title: '계정과 비밀번호', views: ['admin'] },
  { id: 'trouble', title: '문제가 생기면', views: ['field', 'hq', 'admin'] },
];

const HQ = ['hq_staff', 'hq_manager'];

/** 로그인한 사람에게 가장 맞는 쪽을 먼저 편다 */
function defaultView(roles = []) {
  if (roles.includes('admin')) return 'admin';
  if (roles.some((r) => HQ.includes(r))) return 'hq';
  return 'field';
}

/**
 * 화면 그림.
 *
 * 번호는 그림 위에 얹는다 — 그림에 구워 넣으면 글자가 뭉개지고 고칠 수 없다.
 * 자리는 백분율이라 그림을 어떤 크기로 보여 줘도 따라간다.
 */
function Shot({ src, alt, marks = [], caption, legend = [] }) {
  return (
    <figure className="shot">
      <div className="shot-img">
        <img src={src} alt={alt} />
        {marks.map((m, i) => (
          <span key={i} className="mark" style={{ left: `${m.x}%`, top: `${m.y}%` }}>
            {i + 1}
          </span>
        ))}
      </div>
      {legend.length > 0 && (
        <ol className="shot-legend">
          {legend.map((t, i) => <li key={i}>{t}</li>)}
        </ol>
      )}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

export function Help({ me }) {
  const roles = me?.user?.roles ?? [];
  const [view, setView] = useState(() => defaultView(roles));
  const shown = useMemo(() => SECTIONS.filter((s) => s.views.includes(view)), [view]);
  const has = (id) => shown.some((s) => s.id === id);

  return (
    <div className="help">
      <div className="help-head">
        <h1>사용 설명서</h1>
        <p>부여GP 일보 시스템</p>
        <span className="spacer" />
        <button className="btn" onClick={() => window.print()}>인쇄</button>
      </div>

      <div className="help-who">
        <span>누구를 위한 설명입니까?</span>
        {VIEWS.map((v) => (
          <button key={v.id} type="button"
                  className={view === v.id ? 'chip on' : 'chip'}
                  onClick={() => setView(v.id)}>
            {v.label}<i>{v.sub}</i>
          </button>
        ))}
      </div>

      <nav className="help-toc">
        {shown.map((s, i) => (
          <a key={s.id} href={`#h-${s.id}`}><b>{i + 1}</b>{s.title}</a>
        ))}
      </nav>

      {/* ── 1. 시작하기 ─────────────────────────────────────────── */}
      {has('start') && (
        <section id="h-start">
          <h2><i>{shown.findIndex((s) => s.id === 'start') + 1}</i>시작하기</h2>

          <h3>로그인</h3>
          <ol>
            <li>아이디와 비밀번호를 넣습니다.</li>
            <li>비밀번호를 모르면 <b>관리자</b>에게 말합니다. 새로 만들어 줍니다.</li>
          </ol>
          <p className="warn-line">
            계정은 <b>같이 쓰지 않습니다.</b> 한 사람에 한 계정입니다.
            누가 썼는지 기록이 남아야 하기 때문입니다.
          </p>

          <h3>화면이 잠기면</h3>
          <p><b>15분</b> 동안 아무것도 누르지 않으면 잠깁니다. 다시 로그인하면 됩니다.
             <b>넣던 내용은 저절로 저장되어 있습니다.</b></p>

          <h3>돈사 바꾸기</h3>
          <p>맡은 돈사가 여러 개면 화면 맨 위에 탭이 나옵니다. 누르면 바뀝니다.
             로그아웃하지 않아도 됩니다.</p>
          <table className="k">
            <tbody>
              <tr><td><span className="dot done" /> 초록</td><td>확정된 일보</td></tr>
              <tr><td><span className="dot draft" /> 주황</td><td>쓰는 중이거나 제출됨</td></tr>
              <tr><td><span className="dot" /> 회색</td><td>아직 시작하지 않음</td></tr>
            </tbody>
          </table>
        </section>
      )}

      {/* ── 2. 일보 쓰기 ────────────────────────────────────────── */}
      {has('write') && (
        <section id="h-write">
          <h2><i>{shown.findIndex((s) => s.id === 'write') + 1}</i>일보 쓰기</h2>

          <h3>먼저 「일보 시작」을 누릅니다</h3>
          <p>누르기 전에는 <b>칸에 글씨가 안 써집니다.</b> 이 화면이 나오면 아직 시작 전입니다.</p>
          <Shot
            src="/help/notstarted.png"
            alt="아직 시작하지 않은 일보 화면"
            marks={[{ x: 19, y: 7.3 }, { x: 45, y: 11.9 }, { x: 96.4, y: 96.7 }]}
            legend={[
              '「미시작」 — 아직 일보가 없습니다',
              '왜 안 써지는지 여기에 나옵니다',
              '이 단추를 누르면 입력할 수 있습니다',
            ]}
          />

          <h3>바뀐 두수만 넣습니다</h3>
          <Shot
            src="/help/grid.png"
            alt="일보 입력 화면 — 표 왼쪽 부분"
            marks={[{ x: 22.8, y: 16 }, { x: 33, y: 16 }, { x: 59.6, y: 16 }, { x: 67.7, y: 16 }]}
            legend={[
              '전일두수 — 시스템이 넣습니다. 고칠 수 없습니다 (회색)',
              '전입·전출·내부이동·판매 — 여기만 내가 넣습니다 (흰색)',
              '폐사·도태 — 폐사 등록에서 넘어옵니다 (회색)',
              '당일두수 — 시스템이 계산합니다 (회색)',
            ]}
          />

          <table className="k">
            <thead><tr><th>칸</th><th>누가 넣나</th></tr></thead>
            <tbody>
              <tr><td>전일두수</td><td className="auto">시스템 (회색)</td></tr>
              <tr><td>전입 · 전출 · 내부이동 · 판매</td><td className="you">내가 넣습니다</td></tr>
              <tr><td>폐사 · 도태</td><td className="auto">폐사 등록에서 넘어옵니다 (회색)</td></tr>
              <tr><td>당일두수</td><td className="auto">시스템이 계산 (회색)</td></tr>
              <tr><td>보고두수</td><td className="you">직접 센 두수 (안 세었으면 비워 둡니다)</td></tr>
            </tbody>
          </table>

          <p className="warn-line">
            <b>빈칸으로 두지 않습니다.</b> 변동이 없었으면 <b>0</b> 을 넣습니다.
            빈칸은 「없었다」인지 「아직 안 봤다」인지 알 수 없습니다.
          </p>

          <h3>저장은 저절로 됩니다</h3>
          <p>숫자를 넣고 <b>1~2초 지나면 저절로 저장</b>됩니다. 저장 단추를 누르지 않아도 됩니다.
             화면 <b>오른쪽 아래</b>를 보면 지금 어떤 상태인지 나옵니다.</p>
          <Shot
            src="/help/savebar.png"
            alt="화면 아래 단추 줄"
            marks={[{ x: 2.5, y: 24 }, { x: 13, y: 72 }, { x: 91.5, y: 72 }]}
            legend={[
              '합계 — 전체 두수',
              '쓸 수 있는 키',
              '저장 상태 — 여기를 봅니다',
            ]}
          />
          <table className="k">
            <tbody>
              <tr><td>저장 중…</td><td>보내는 중입니다</td></tr>
              <tr><td className="auto">17:32 저장됨</td><td>다 저장됐습니다</td></tr>
              <tr><td className="you">17:32 저장 · 1행은 고쳐야 저장됩니다</td>
                  <td>빨간 칸이 있는 줄만 아직 안 됐습니다. <b>고치면 바로 저장됩니다</b></td></tr>
              <tr><td>저장 못 했습니다</td><td>인터넷을 봅니다. 화면을 닫지 마십시오</td></tr>
            </tbody>
          </table>

          <h3>키보드</h3>
          <table className="k keys">
            <tbody>
              <tr><td><kbd>Tab</kbd></td><td>다음 칸</td></tr>
              <tr><td><kbd>Enter</kbd></td><td>다음 줄, 같은 칸</td></tr>
              <tr><td><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd></td><td>칸 옮기기</td></tr>
              <tr><td><kbd>Ctrl</kbd>+<kbd>Enter</kbd></td>
                  <td><b>이 줄은 변동 없음</b> — 빈칸을 0 으로 채우고 다음 줄로</td></tr>
              <tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>지금 바로 저장 (안 눌러도 저절로 됩니다)</td></tr>
            </tbody>
          </table>
          <p>숫자판(키보드 오른쪽 숫자)을 쓰면 빠릅니다.</p>

          <h3>줄 왼쪽에 빨간 선이 있으면</h3>
          <p>아직 안 넣은 줄입니다. 전부 없어져야 제출할 수 있습니다.</p>
        </section>
      )}

      {/* ── 3. 빨간 칸 ──────────────────────────────────────────── */}
      {has('red') && (
        <section id="h-red">
          <h2><i>{shown.findIndex((s) => s.id === 'red') + 1}</i>빨간 칸이 나오면</h2>
          <p>시스템이 <b>틀렸다고 막는 것</b>입니다. 그냥 넘어갈 수 없습니다.</p>

          <Shot
            src="/help/red.png"
            alt="차이가 나서 사유를 적어야 하는 화면"
            marks={[{ x: 14, y: 29 }, { x: 45, y: 73 }, { x: 60, y: 73 }]}
            legend={[
              '무엇이 잘못됐는지 위에 나옵니다',
              '차이 −2 — 직접 센 두수(12)와 계산(14)이 다릅니다',
              '사유 칸이 빨갛습니다. 여기에 왜 다른지 적으면 사라집니다',
            ]}
          />

          <table className="k">
            <thead><tr><th>화면</th><th>뜻</th><th>할 일</th></tr></thead>
            <tbody>
              <tr><td>당일두수가 빨갛다</td><td>있는 것보다 많이 나갔습니다</td>
                  <td>전출·판매 두수를 다시 봅니다</td></tr>
              <tr><td><b>차이</b> 칸에 숫자</td><td>직접 센 두수와 계산이 다릅니다</td>
                  <td><b>사유</b> 칸에 왜 다른지 적습니다</td></tr>
              <tr><td>사유 칸이 빨갛다</td><td>차이가 있는데 사유가 없습니다</td>
                  <td>사유를 적습니다</td></tr>
            </tbody>
          </table>

          <p className="warn-line">
            차이가 나면 <b>숫자를 고쳐서 맞추지 않습니다.</b>
            센 대로 넣고 왜 다른지 적습니다. 그게 기록입니다.
          </p>
        </section>
      )}

      {/* ── 4. 제출 ─────────────────────────────────────────────── */}
      {has('submit') && (
        <section id="h-submit">
          <h2><i>{shown.findIndex((s) => s.id === 'submit') + 1}</i>제출하기</h2>
          <div className="flow">
            <span><b>내가</b> 제출</span><i>→</i>
            <span>본사가 확정</span><i>→</i>
            <span>PDF 출력 · 서명</span><i>→</i>
            <span>3년 보관</span>
          </div>
          <ul>
            <li>다 넣으면 오른쪽 아래 <b>제출</b>을 누릅니다.</li>
            <li>빈 줄이나 빨간 칸이 남아 있으면 <b>제출을 누를 수 없습니다.</b>
                몇 줄이 남았는지 표 위에 나옵니다.</li>
            <li>제출한 뒤에는 <b>고칠 수 없습니다.</b> 누르기 전에 한 번 봅니다.</li>
            <li>틀린 것을 나중에 찾으면 <b>본사에 말합니다.</b> 정정전표로 고칩니다.</li>
          </ul>
          <p>확정은 본사가 합니다. 내가 쓴 일보를 내가 확정할 수는 없습니다 —
             쓴 사람과 확인하는 사람이 달라야 하기 때문입니다.</p>
        </section>
      )}

      {/* ── 확정 (본사) ─────────────────────────────────────────── */}
      {has('confirm') && (
        <section id="h-confirm">
          <h2><i>{shown.findIndex((s) => s.id === 'confirm') + 1}</i>확인하고 확정하기</h2>

          <h3>제출 현황에서 시작합니다</h3>
          <p>아침에 이 화면을 먼저 봅니다. <b>어느 돈사가 아직 안 냈나</b>를 한 장으로 답합니다.</p>
          <Shot
            src="/help/status.png"
            alt="제출 현황 화면"
            marks={[{ x: 20.5, y: 6.4 }, { x: 40, y: 47 }, { x: 76, y: 47 }]}
            legend={[
              '오늘 12개 돈사 중 몇 개가 확정됐나',
              '입력 — 있어야 할 줄 중 몇 줄이 들어왔나 (44 / 44 이면 다 됨)',
              '상태 — 누르면 그 돈사 일보로 갑니다',
            ]}
          />

          <h3>확정</h3>
          <ol className="big">
            <li>돈사를 눌러 일보를 엽니다.</li>
            <li><b>차이</b> 칸에 숫자가 있으면 <b>사유</b>를 읽습니다. 그게 확인의 핵심입니다.</li>
            <li>오른쪽 아래 <b>확정</b>을 누릅니다.</li>
          </ol>
          <p className="warn-line">
            확정하면 <b>원본이 고정됩니다.</b> 그 뒤에는 팀장도 본사도 직접 못 고칩니다.
            고쳐야 하면 정정전표를 발행합니다.
          </p>
          <p>잘못 확정했으면 <b>확정 해제</b>로 되돌릴 수 있습니다. 그 기록도 남습니다.</p>
        </section>
      )}

      {/* ── 종이 ────────────────────────────────────────────────── */}
      {has('paper') && (
        <section id="h-paper">
          <h2><i>{shown.findIndex((s) => s.id === 'paper') + 1}</i>종이 출력과 보관</h2>
          <p className="warn-line">
            <b>컴퓨터에 넣은 것만으로는 안 됩니다.</b> HACCP 심사는 종이를 봅니다.
            출력해서 서명하고 <b>3년</b> 보관합니다.
          </p>
          <ol>
            <li>확정된 일보를 PDF 로 출력합니다.</li>
            <li>작성자와 확인자가 서명합니다.</li>
            <li>돈사별 사무실에 보관합니다.</li>
          </ol>
          <p>출력물에는 확인 번호가 찍힙니다. 종이와 컴퓨터의 내용이 같다는 표시입니다.
             <b>종이를 손으로 고치지 않습니다.</b> 고치면 번호가 안 맞습니다.</p>
        </section>
      )}

      {/* ── 담당 바꾸기 (관리자) ────────────────────────────────── */}
      {has('scope') && (
        <section id="h-scope">
          <h2><i>{shown.findIndex((s) => s.id === 'scope') + 1}</i>담당 바꾸기</h2>
          <p>사람이 쉬거나 돈사를 바꿔 맡을 때 <b>계정 관리 → 담당</b> 에서 바꿉니다.</p>

          <h3>먼저 적용일을 정합니다</h3>
          <p>화면 <b>오른쪽 위</b>에 있습니다. 오늘부터면 그대로 둡니다.</p>
          <Shot src="/help/scopedate.png" alt="적용일 고르는 칸"
                caption="적용일을 미래로 두면 그날부터 바뀝니다 — 「10월 1일부터 넘긴다」를 미리 넣어 두면 그날 기억하지 않아도 됩니다." />

          <h3>칸을 누릅니다</h3>
          <Shot
            src="/help/scope.png"
            alt="돈사와 사람이 만나는 담당 표"
            marks={[{ x: 5, y: 12 }, { x: 31, y: 30 }, { x: 5, y: 82 }, { x: 30, y: 89 }]}
            legend={[
              '왼쪽은 돈사, 위쪽은 사람입니다',
              '● 이 있으면 담당입니다. 칸을 누르면 바뀝니다',
              '왼쪽에 빨간 선 — 담당이 없는 돈사입니다',
              '담당이 없으면 아래에 경고가 나옵니다',
            ]}
          />

          <p className="warn-line">
            표에서 <b>담당 팀장 「없음」</b> 인 줄이 있으면 안 됩니다.
            그 돈사는 <b>아무도 일보를 쓰지 않습니다.</b>
          </p>

          <h3>알아둘 것</h3>
          <ul>
            <li>바꾼 것은 <b>변경 이력</b> 에 남습니다. <b>지울 수 없습니다.</b></li>
            <li>담당에서 빠지면 그 돈사의 <b>지난 일보도 안 보입니다.</b>
                볼 일이 있으면 본사에 말합니다.</li>
            <li>부장·본사처럼 <b>전 돈사</b> 를 맡는 사람은 칸으로 안 그립니다. 표 아래에 적힙니다.</li>
          </ul>
        </section>
      )}

      {/* ── 계정 (관리자) ──────────────────────────────────────── */}
      {has('account') && (
        <section id="h-account">
          <h2><i>{shown.findIndex((s) => s.id === 'account') + 1}</i>계정과 비밀번호</h2>

          <h3>새 계정</h3>
          <ol className="big">
            <li><b>계정</b> 탭 → <b>새 계정</b>.</li>
            <li>아이디(영문 소문자·숫자)와 이름을 넣습니다.</li>
            <li>비밀번호는 시스템이 만들어 <b>한 번만</b> 보여 줍니다.</li>
          </ol>
          <p className="warn-line">
            비밀번호는 <b>그 화면을 닫으면 다시 못 봅니다.</b>
            본인에게 전달하고, 잊었으면 새로 만들어 줍니다.
          </p>

          <h3>그만둔 사람</h3>
          <p><b>지우지 않습니다. 「중지」로 둡니다.</b> 지난 일보에 그 사람 이름이
             남아 있어야 하기 때문입니다. 중지하면 바로 로그인이 안 되고,
             열려 있던 화면도 끊깁니다.</p>

          <h3>등급</h3>
          <p>등급 바꾸기는 <b>본사만</b> 합니다. 관리자여도 못 바꿉니다.</p>
          <p>팀장이 스스로 본사 등급을 가질 수 있으면 <b>자기가 쓴 일보를 자기가
             확정</b>하게 됩니다. 그것을 막는 한 줄입니다.</p>

          <h3>변경 이력</h3>
          <p>계정·담당을 바꾼 기록은 <b>변경 이력</b> 탭에 남습니다.
             누가 언제 무엇을 바꿨는지 전부 나오고, <b>지울 수 없습니다</b> —
             HACCP 심사에서 요구하는 기록입니다.</p>
        </section>
      )}

      {/* ── 문제 ───────────────────────────────────────────────── */}
      {has('trouble') && (
        <section id="h-trouble">
          <h2><i>{shown.findIndex((s) => s.id === 'trouble') + 1}</i>문제가 생기면</h2>
          <table className="k">
            <thead><tr><th>이런 때</th><th>이렇게</th></tr></thead>
            <tbody>
              <tr><td>칸에 숫자가 안 써집니다</td>
                  <td><b>일보 시작</b> 을 눌렀는지 봅니다. 표 위에 왜 안 되는지 써 있습니다</td></tr>
              <tr><td>내 돈사가 안 보입니다</td><td>담당이 아닙니다. 관리자에게 말합니다</td></tr>
              <tr><td>제출 단추를 못 누릅니다</td>
                  <td>빈 줄이나 빨간 칸이 남아 있습니다. 표 위에 몇 줄인지 나옵니다</td></tr>
              <tr><td>제출한 일보를 고치고 싶습니다</td><td>본사에 말합니다. 정정전표로 고칩니다</td></tr>
              <tr><td>비밀번호를 잊었습니다</td><td>관리자에게 말합니다</td></tr>
              <tr><td>「실패가 여러 번 있었습니다」</td><td>15분 기다렸다가 다시 합니다</td></tr>
              <tr><td>「저장 못 했습니다」가 뜹니다</td>
                  <td>인터넷을 봅니다. <b>화면을 닫지 마십시오</b> — 열어 두면 다시 보냅니다</td></tr>
              <tr><td>화면이 안 열립니다</td><td>인터넷을 봅니다. 그래도 안 되면 본사에 말합니다</td></tr>
            </tbody>
          </table>

          <p className="warn-line">
            안 되는 것을 <b>그냥 넘기지 않습니다.</b>
            두수가 한 번 틀리면 그 뒤 모든 날이 틀립니다.
          </p>
        </section>
      )}

      <footer className="help-foot">
        부여GP 돈사 일보 시스템 · 농업회사법인 (주) 부여지피
        <span> · {VIEWS.find((v) => v.id === view)?.label} 용</span>
      </footer>
    </div>
  );
}
