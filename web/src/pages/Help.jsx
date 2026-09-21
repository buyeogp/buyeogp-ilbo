/**
 * 사용 설명서 — 설계문서 §6.4 P10
 *
 * 쓰는 사람이 외국인 팀장 4명이다. 긴 문장을 쓰지 않는다.
 * 짧은 문장, 순서 번호, 키 이름, 색깔. 「왜」보다 「어떻게」를 먼저 쓴다.
 *
 * 인쇄해서 사무실 벽에 붙일 수 있어야 한다 — 막혔을 때 화면을 못 여는 경우가
 * 있기 때문이다. 그래서 print 스타일을 따로 둔다.
 */
import { useState } from 'react';

const SECTIONS = [
  { id: 'start', title: '시작하기' },
  { id: 'write', title: '일보 쓰기' },
  { id: 'red', title: '빨간 칸이 나오면' },
  { id: 'submit', title: '제출과 확정' },
  { id: 'paper', title: '종이 출력과 보관' },
  { id: 'people', title: '담당 바꾸기' },
  { id: 'trouble', title: '문제가 생기면' },
];

export function Help() {
  const [open, setOpen] = useState('start');

  return (
    <div className="help">
      <div className="help-head">
        <h1>사용 설명서</h1>
        <p>부여GP 일보 시스템</p>
        <span className="spacer" />
        <button className="btn" onClick={() => window.print()}>인쇄</button>
      </div>

      <nav className="help-toc">
        {SECTIONS.map((s, i) => (
          <a key={s.id} href={`#h-${s.id}`}
             onClick={() => setOpen(s.id)}>
            <b>{i + 1}</b>{s.title}
          </a>
        ))}
      </nav>

      <section id="h-start">
        <h2><i>1</i>시작하기</h2>

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
           쓰던 내용은 <b>임시저장</b>한 것까지 남습니다.</p>

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

      <section id="h-write">
        <h2><i>2</i>일보 쓰기</h2>

        <ol className="big">
          <li>위 탭에서 <b>돈사</b>를 고릅니다.</li>
          <li>날짜가 맞는지 봅니다. 틀리면 <b>‹ 전날</b> · <b>다음날 ›</b> 로 옮깁니다.</li>
          <li><b>일보 시작</b>을 누릅니다. 누르기 전에는 칸에 글씨가 안 써집니다.</li>
          <li>바뀐 두수만 넣습니다.</li>
          <li><b>제출</b>을 누릅니다.</li>
        </ol>

        <h3>넣는 칸과 넣지 않는 칸</h3>
        <table className="k">
          <thead><tr><th>칸</th><th>누가 넣나</th></tr></thead>
          <tbody>
            <tr><td>전일두수</td><td className="auto">시스템이 넣습니다 (회색)</td></tr>
            <tr><td>전입 · 전출 · 내부이동 · 판매</td><td className="you">내가 넣습니다</td></tr>
            <tr><td>폐사 · 도태</td><td className="auto">폐사 등록 화면에서 넘어옵니다 (회색)</td></tr>
            <tr><td>당일두수</td><td className="auto">시스템이 계산합니다 (회색)</td></tr>
            <tr><td>보고두수</td><td className="you">직접 센 두수 (안 세었으면 비워 둡니다)</td></tr>
          </tbody>
        </table>

        <p className="warn-line">
          <b>빈칸으로 두지 않습니다.</b> 변동이 없었으면 <b>0</b> 을 넣습니다.
          빈칸은 「없었다」인지 「아직 안 봤다」인지 알 수 없습니다.
        </p>

        <h3>키보드</h3>
        <table className="k keys">
          <tbody>
            <tr><td><kbd>Tab</kbd></td><td>다음 칸</td></tr>
            <tr><td><kbd>Enter</kbd></td><td>다음 줄, 같은 칸</td></tr>
            <tr><td><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd></td><td>칸 옮기기</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>Enter</kbd></td><td><b>이 줄은 변동 없음</b> — 빈칸을 0 으로 채우고 다음 줄로</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>임시저장</td></tr>
          </tbody>
        </table>
        <p>숫자판(키보드 오른쪽 숫자)을 쓰면 빠릅니다.</p>

        <h3>줄 왼쪽에 빨간 선이 있으면</h3>
        <p>아직 안 넣은 줄입니다. 전부 없어져야 제출할 수 있습니다.</p>
      </section>

      <section id="h-red">
        <h2><i>3</i>빨간 칸이 나오면</h2>
        <p>시스템이 <b>틀렸다고 막는 것</b>입니다. 그냥 넘어갈 수 없습니다. 고쳐야 합니다.</p>

        <table className="k">
          <thead><tr><th>화면</th><th>뜻</th><th>할 일</th></tr></thead>
          <tbody>
            <tr>
              <td>당일두수가 빨갛다</td>
              <td>있는 것보다 많이 나갔습니다</td>
              <td>전출·판매 두수를 다시 봅니다</td>
            </tr>
            <tr>
              <td><b>차이</b> 칸에 <b>−1</b> 같은 숫자</td>
              <td>직접 센 두수와 계산이 다릅니다</td>
              <td><b>사유</b> 칸에 왜 다른지 적습니다</td>
            </tr>
            <tr>
              <td>사유 칸이 빨갛다</td>
              <td>차이가 있는데 사유가 없습니다</td>
              <td>사유를 적습니다</td>
            </tr>
          </tbody>
        </table>

        <p className="warn-line">
          차이가 나면 <b>숫자를 고쳐서 맞추지 않습니다.</b>
          센 대로 넣고 왜 다른지 적습니다. 그게 기록입니다.
        </p>
      </section>

      <section id="h-submit">
        <h2><i>4</i>제출과 확정</h2>
        <div className="flow">
          <span>팀장이 <b>제출</b></span>
          <i>→</i>
          <span>본사가 <b>확정</b></span>
          <i>→</i>
          <span>PDF 출력 · 서명</span>
          <i>→</i>
          <span>3년 보관</span>
        </div>

        <h3>팀장</h3>
        <ul>
          <li>다 넣으면 <b>제출</b>을 누릅니다.</li>
          <li>제출한 뒤에는 <b>고칠 수 없습니다.</b> 누르기 전에 한 번 봅니다.</li>
          <li>틀린 것을 나중에 찾으면 본사에 말합니다. 정정전표로 고칩니다.</li>
        </ul>

        <h3>본사</h3>
        <ul>
          <li><b>제출 현황</b>에서 어느 돈사가 아직 안 냈는지 봅니다.</li>
          <li>돈사를 눌러 일보를 보고 <b>확정</b>을 누릅니다.</li>
          <li>팀장은 확정할 수 없습니다. 쓴 사람과 확인하는 사람이 달라야 합니다.</li>
        </ul>
      </section>

      <section id="h-paper">
        <h2><i>5</i>종이 출력과 보관</h2>
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

      <section id="h-people">
        <h2><i>6</i>담당 바꾸기 <small>관리자 권한이 있는 사람만</small></h2>

        <p>사람이 쉬거나 돈사를 바꿔 맡을 때 <b>계정 관리 → 담당</b> 에서 바꿉니다.</p>
        <ol className="big">
          <li>위쪽 <b>적용일</b> 을 정합니다. 오늘이면 그대로 둡니다.</li>
          <li>표에서 <b>사람 줄 × 돈사 칸</b> 을 누릅니다.</li>
          <li>● 이 생기면 담당, 없어지면 담당이 아닙니다.</li>
        </ol>

        <p className="warn-line">
          <b>적용일을 미래로 둘 수 있습니다.</b> 「10월 1일부터 바꾼다」를 미리 넣어 두면
          그날 기억하지 않아도 알아서 바뀝니다.
        </p>

        <h3>꼭 확인할 것</h3>
        <ul>
          <li>표에서 <b>담당 팀장 「없음」</b> 인 줄이 있으면 안 됩니다. 그 돈사는 아무도 일보를 안 씁니다.</li>
          <li>바꾼 것은 <b>변경 이력</b> 에 남습니다. 지울 수 없습니다.</li>
          <li>담당에서 빠지면 그 돈사의 <b>지난 일보도 안 보입니다.</b> 볼 일이 있으면 본사에 말합니다.</li>
        </ul>

        <h3>계정 만들기 · 비밀번호</h3>
        <ul>
          <li><b>계정</b> 탭 → <b>새 계정</b>. 비밀번호는 시스템이 만들어 <b>한 번만</b> 보여 줍니다.</li>
          <li>비밀번호를 잊었으면 <b>비밀번호 재발급</b>. 새로 만들어 줍니다.</li>
          <li>그만둔 사람은 <b>중지</b> 로 둡니다. <b>지우지 않습니다</b> — 지난 일보에 이름이 남아야 합니다.</li>
          <li><b>등급</b>(팀장·본사 같은 것)은 본사만 바꿉니다.</li>
        </ul>
      </section>

      <section id="h-trouble">
        <h2><i>7</i>문제가 생기면</h2>
        <table className="k">
          <thead><tr><th>이런 때</th><th>이렇게</th></tr></thead>
          <tbody>
            <tr><td>칸에 숫자가 안 써집니다</td>
                <td><b>일보 시작</b> 을 눌렀는지 봅니다. 표 위에 왜 안 되는지 써 있습니다</td></tr>
            <tr><td>내 돈사가 안 보입니다</td>
                <td>담당이 아닙니다. 관리자에게 말합니다</td></tr>
            <tr><td>제출 단추를 못 누릅니다</td>
                <td>빈 줄이나 빨간 칸이 남아 있습니다. 표 위에 몇 줄인지 나옵니다</td></tr>
            <tr><td>제출한 일보를 고치고 싶습니다</td>
                <td>본사에 말합니다. 정정전표로 고칩니다</td></tr>
            <tr><td>비밀번호를 잊었습니다</td>
                <td>관리자에게 말합니다</td></tr>
            <tr><td>「실패가 여러 번 있었습니다」</td>
                <td>15분 기다렸다가 다시 합니다</td></tr>
            <tr><td>화면이 안 열립니다</td>
                <td>인터넷을 봅니다. 그래도 안 되면 본사에 말합니다</td></tr>
          </tbody>
        </table>

        <p className="warn-line">
          안 되는 것을 <b>그냥 넘기지 않습니다.</b> 두수가 한 번 틀리면 그 뒤 모든 날이 틀립니다.
        </p>
      </section>

      <footer className="help-foot">
        부여GP 돈사 일보 시스템 · 농업회사법인 (주) 부여지피
      </footer>
    </div>
  );
}
