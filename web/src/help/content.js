/**
 * 설명서 내용 — 글과 화면을 분리한다.
 *
 * 문장을 JSX 안에 박아 두면 언어를 하나 늘릴 때마다 화면 코드를 뜯어야 한다.
 * 여기에 데이터로 두면 언어는 열쇠 하나 더 다는 일이 된다.
 *
 * 한국어와 영어를 **나란히** 둔 이유도 있다. 파일이 갈리면 한쪽만 고치고
 * 다른 쪽은 옛말로 남는다. 붙어 있으면 고칠 때 눈에 들어온다.
 *
 * 네팔어(`ne`)는 비워 두었다. 지어내면 현장에서 아무도 검증할 수 없고,
 * 두수나 휴약기간에 관한 지시가 틀리면 결과가 생긴다.
 * 네팔 팀장이 확인해 준 문장만 넣는다 — 비어 있으면 한국어가 나온다.
 *
 * ──────────────────────────────────────────────────────────────────
 * 글 안의 *별표* 는 굵게 나온다.  예: '변동이 없으면 *0* 을 넣습니다'
 */

export const LANGS = [
  { id: 'ko', label: '한국어' },
  { id: 'en', label: 'English' },
];

/** 한 줄 = 한 뜻. 언어를 늘리려면 열쇠만 더 단다. */
const t = (ko, en, ne) => ({ ko, en, ne });

/** 보는 사람의 처지. 직책이 아니라 「무엇을 하는 사람인가」로 나눈다. */
export const VIEWS = [
  { id: 'field', label: t('팀장', 'Team lead'), sub: t('일보를 쓰는 사람', 'writes the report') },
  { id: 'hq', label: t('본사', 'Head office'), sub: t('확인하고 확정하는 사람', 'checks and confirms') },
  { id: 'admin', label: t('관리자', 'Administrator'), sub: t('담당·계정을 고치는 사람', 'manages people') },
];

export const UI = {
  title: t('사용 설명서', 'User Guide'),
  subtitle: t('부여GP 일보 시스템', 'Buyeo GP Daily Report System'),
  who: t('누구를 위한 설명입니까?', 'Who is this for?'),
  lang: t('언어', 'Language'),
  print: t('인쇄', 'Print'),
  glossary: t('용어 카드', 'Word card'),
  footer: t('부여GP 돈사 일보 시스템 · 농업회사법인 (주) 부여지피',
            'Buyeo GP Daily Report System · Buyeo GP Co., Ltd.'),
  // VIEWS 의 label 은 t() 묶음이다. v.ko 가 아니라 v.label.ko 를 봐야 한다.
  forWhom: (v) => t(`${v.label.ko} 용`, `for ${v.label.en}`),
};

export const SECTIONS = [
  /* ── 1. 시작하기 ──────────────────────────────────────────────── */
  {
    id: 'start',
    views: ['field', 'hq', 'admin'],
    title: t('시작하기', 'Getting started'),
    blocks: [
      { h3: t('로그인', 'Log in') },
      { ol: [
        t('아이디와 비밀번호를 넣습니다.', 'Enter your ID and password.'),
        t('비밀번호를 모르면 *관리자*에게 말합니다. 새로 만들어 줍니다.',
          'If you do not know your password, tell the *administrator*. They will make a new one.'),
      ] },
      { warn: t('계정은 *같이 쓰지 않습니다.* 한 사람에 한 계정입니다. 누가 썼는지 기록이 남아야 하기 때문입니다.',
                'Do *not share accounts.* One account per person. The system must record who entered what.') },

      { h3: t('화면이 잠기면', 'If the screen locks') },
      { p: t('*15분* 동안 아무것도 누르지 않으면 잠깁니다. 다시 로그인하면 됩니다. *넣던 내용은 저절로 저장되어 있습니다.*',
             'The screen locks after *15 minutes* with no activity. Just log in again. *What you typed is already saved.*') },

      { h3: t('돈사 바꾸기', 'Switching houses') },
      { p: t('맡은 돈사가 여러 개면 화면 맨 위에 탭이 나옵니다. 누르면 바뀝니다. 로그아웃하지 않아도 됩니다.',
             'If you look after several houses, tabs appear at the top. Click one to switch. No need to log out.') },
      { table: {
        rows: [
          [t('● 초록', '● Green'), t('확정된 일보', 'Confirmed report')],
          [t('● 주황', '● Orange'), t('쓰는 중이거나 제출됨', 'In progress or submitted')],
          [t('● 회색', '● Grey'), t('아직 시작하지 않음', 'Not started yet')],
        ],
      } },
    ],
  },

  /* ── 2. 일보 쓰기 ─────────────────────────────────────────────── */
  {
    id: 'write',
    views: ['field'],
    title: t('일보 쓰기', 'Writing the daily report'),
    blocks: [
      { h3: t('먼저 「일보 시작」을 누릅니다', 'First press "일보 시작" (Start report)') },
      { p: t('누르기 전에는 *칸에 글씨가 안 써집니다.* 이 화면이 나오면 아직 시작 전입니다.',
             'Before you press it, *you cannot type in the cells.* This screen means the report has not started.') },
      { figure: {
        src: '/help/notstarted.png',
        alt: t('아직 시작하지 않은 일보 화면', 'A report that has not been started'),
        marks: [{ x: 19, y: 7.3 }, { x: 45, y: 11.9 }, { x: 96.4, y: 96.7 }],
        legend: [
          t('「미시작」 — 아직 일보가 없습니다', '"미시작" (Not started) — there is no report yet'),
          t('왜 안 써지는지 여기에 나옵니다', 'This line tells you why you cannot type'),
          t('이 단추를 누르면 입력할 수 있습니다', 'Press this button to start entering'),
        ],
      } },

      { h3: t('바뀐 두수만 넣습니다', 'Enter only what changed') },
      { figure: {
        src: '/help/grid.png',
        alt: t('일보 입력 화면 — 표 왼쪽 부분', 'The entry table — left side'),
        marks: [{ x: 22.8, y: 16 }, { x: 33, y: 16 }, { x: 59.6, y: 16 }, { x: 67.7, y: 16 }],
        legend: [
          t('전일두수 — 시스템이 넣습니다. 고칠 수 없습니다 (회색)',
            'Opening count — the system fills this. You cannot change it (grey)'),
          t('전입·전출·내부이동·판매 — 여기만 내가 넣습니다 (흰색)',
            'In / out / internal transfer / sold — *you* enter only these (white)'),
          t('폐사·도태 — *칸을 눌러* 등록합니다 (아래 「폐사·도태 등록」)',
            'Deaths and culls — *click the cell* to record them (see "Recording deaths and culls")'),
          t('당일두수 — 시스템이 계산합니다 (회색)',
            'Closing count — the system calculates it (grey)'),
        ],
      } },
      { table: {
        head: [t('칸', 'Column'), t('누가 넣나', 'Who fills it')],
        rows: [
          [t('전일두수', 'Opening count'), t('시스템 (회색)', 'System (grey)'), 'auto'],
          [t('전입 · 전출 · 내부이동 · 판매', 'In · Out · Internal · Sold'),
           t('내가 넣습니다', 'You enter it'), 'you'],
          [t('폐사 · 도태', 'Deaths · Culls'),
           t('칸을 눌러 등록 창에서 넣습니다', 'Click the cell and add them in the form'), 'you'],
          [t('당일두수', 'Closing count'), t('시스템이 계산 (회색)', 'System calculates (grey)'), 'auto'],
          [t('보고두수', 'Counted head'),
           t('직접 센 두수 (안 세었으면 비워 둡니다)',
             'The number you counted yourself (leave empty if you did not count)'), 'you'],
        ],
      } },
      { warn: t('*빈칸으로 두지 않습니다.* 변동이 없었으면 *0* 을 넣습니다. 빈칸은 「없었다」인지 「아직 안 봤다」인지 알 수 없습니다.',
                '*Never leave a cell empty.* If nothing changed, enter *0*. An empty cell cannot tell "nothing happened" from "I have not looked yet".') },

      { h3: t('저장은 저절로 됩니다', 'Saving happens by itself') },
      { p: t('숫자를 넣고 *1~2초 지나면 저절로 저장*됩니다. 저장 단추를 누르지 않아도 됩니다. 화면 *오른쪽 아래*를 보면 지금 어떤 상태인지 나옵니다.',
             'About *1–2 seconds* after you type, it *saves by itself*. You do not need a save button. Look at the *bottom right* of the screen to see the state.') },
      { figure: {
        src: '/help/savebar.png',
        alt: t('화면 아래 단추 줄', 'The bar at the bottom of the screen'),
        marks: [{ x: 2.5, y: 24 }, { x: 13, y: 72 }, { x: 91.5, y: 72 }],
        legend: [
          t('합계 — 전체 두수', 'Total — the whole house'),
          t('쓸 수 있는 키', 'Keys you can use'),
          t('저장 상태 — 여기를 봅니다', 'Save state — look here'),
        ],
      } },
      { table: {
        rows: [
          [t('저장 중…', 'Saving…'), t('보내는 중입니다', 'Sending now')],
          [t('17:32 저장됨', '17:32 Saved'), t('다 저장됐습니다', 'Everything is saved'), 'auto'],
          [t('17:32 저장 · 1행은 고쳐야 저장됩니다', '17:32 Saved · 1 row needs fixing'),
           t('빨간 칸이 있는 줄만 아직 안 됐습니다. *고치면 바로 저장됩니다*',
             'Only the row with a red cell is not saved. *Fix it and it saves at once*'), 'you'],
          [t('저장 못 했습니다', 'Could not save'),
           t('인터넷을 봅니다. 화면을 닫지 마십시오', 'Check the network. Do not close the screen')],
        ],
      } },

      { h3: t('키보드', 'Keyboard') },
      { keys: [
        [['Tab'], t('다음 칸', 'Next cell')],
        [['Enter'], t('다음 줄, 같은 칸', 'Next row, same column')],
        [['↑', '↓', '←', '→'], t('칸 옮기기', 'Move between cells')],
        [['Ctrl', 'Enter'], t('*이 줄은 변동 없음* — 빈칸을 0 으로 채우고 다음 줄로',
                              '*No change in this row* — fills the empty cells with 0 and moves down')],
        [['Ctrl', 'S'], t('지금 바로 저장 (안 눌러도 저절로 됩니다)',
                          'Save right now (it saves by itself anyway)')],
      ] },
      { p: t('숫자판(키보드 오른쪽 숫자)을 쓰면 빠릅니다.', 'The number pad on the right is faster.') },

      { h3: t('줄 왼쪽에 빨간 선이 있으면', 'A red line on the left of a row') },
      { p: t('아직 안 넣은 줄입니다. 전부 없어져야 제출할 수 있습니다.',
             'That row is not filled in yet. All of them must be gone before you can submit.') },
    ],
  },

  /* ── 3. 빨간 칸 ───────────────────────────────────────────────── */
  {
    id: 'red',
    views: ['field'],
    title: t('빨간 칸이 나오면', 'When a cell turns red'),
    blocks: [
      { p: t('시스템이 *틀렸다고 막는 것*입니다. 그냥 넘어갈 수 없습니다.',
             'The system is *stopping you because something is wrong*. You cannot skip it.') },
      { figure: {
        src: '/help/red.png',
        alt: t('차이가 나서 사유를 적어야 하는 화면', 'A row where the counts differ and a reason is required'),
        marks: [{ x: 14, y: 29 }, { x: 45, y: 73 }, { x: 60, y: 73 }],
        legend: [
          t('무엇이 잘못됐는지 위에 나옵니다', 'What is wrong is written at the top'),
          t('차이 −2 — 직접 센 두수(12)와 계산(14)이 다릅니다',
            'Difference −2 — what you counted (12) is not what the system calculated (14)'),
          t('사유 칸이 빨갛습니다. 여기에 왜 다른지 적으면 사라집니다',
            'The reason cell is red. Write why they differ and the red goes away'),
        ],
      } },
      { table: {
        head: [t('화면', 'On screen'), t('뜻', 'Meaning'), t('할 일', 'What to do')],
        rows: [
          [t('당일두수가 빨갛다', 'Closing count is red'),
           t('있는 것보다 많이 나갔습니다', 'More went out than you had'),
           t('전출·판매 두수를 다시 봅니다', 'Check the out and sold numbers again')],
          [t('*차이* 칸에 숫자', 'A number in the *difference* cell'),
           t('직접 센 두수와 계산이 다릅니다', 'Your count and the calculation differ'),
           t('*사유* 칸에 왜 다른지 적습니다', 'Write why in the *reason* cell')],
          [t('사유 칸이 빨갛다', 'The reason cell is red'),
           t('차이가 있는데 사유가 없습니다', 'There is a difference but no reason'),
           t('사유를 적습니다', 'Write the reason')],
        ],
      } },
      { warn: t('차이가 나면 *숫자를 고쳐서 맞추지 않습니다.* 센 대로 넣고 왜 다른지 적습니다. 그게 기록입니다.',
                'When there is a difference, *do not change the number to make it match.* Enter what you counted and write why. That is the record.') },
    ],
  },

  /* ── 폐사·도태 ────────────────────────────────────────────────── */
  {
    id: 'deaths',
    views: ['field'],
    title: t('폐사·도태 등록', 'Recording deaths and culls'),
    blocks: [
      { p: t('폐사·도태는 표 칸에 숫자를 치지 않습니다. *그 줄의 「폐사·도태」 칸을 누르면* 등록 창이 열리고, 거기서 한 건씩 넣습니다. 칸의 숫자는 *넣은 기록의 합*입니다.',
             'Do not type deaths or culls into the table. *Click the "폐사·도태" cell of that row* to open a form and add them one by one. The number in the cell is *the total of what you recorded*.') },
      { p: t('칸에 *점선 밑줄*이 있으면 누를 수 있다는 뜻입니다. 칸 오른쪽 위에 *주황 점*이 있으면 사진이 아직 안 붙은 폐사가 있다는 뜻입니다.',
             'A *dotted underline* means you can click it. An *orange dot* in the corner means a death in that row still has no photo.') },

      { h3: t('한 건 넣기', 'Adding one') },
      { big: [
        t('*종류* — 폐사(죽음) 또는 도태(내보냄)를 고릅니다.', '*Type* — choose 폐사 (died) or 도태 (culled).'),
        t('*두수* — 몇 마리인지 넣습니다.', '*Head count* — how many.'),
        t('*사유* — 아래 표에서 고릅니다. 「06 기타」는 사유를 글로 적어야 합니다.',
          '*Reason* — pick from the table below. "06 기타" (other) needs a written reason.'),
        t('*사진* — 폐사는 사진이 *꼭* 있어야 합니다. 「사진 찍기 · 고르기」를 누릅니다. 도태는 사진이 없어도 됩니다.',
          '*Photo* — a death *must* have a photo. Press "사진 찍기 · 고르기". A cull does not need one.'),
        t('*이각번호* — 모돈처럼 번호가 있으면 적습니다. 없으면 비워 둡니다.', '*Ear tag* — write it if the pig has one (e.g. a sow). Otherwise leave it empty.'),
        t('아래 *「폐사 1두 등록」* 단추를 누릅니다. 칸 숫자와 당일두수가 바로 바뀝니다.',
          'Press the *"폐사 1두 등록"* button. The cell and the closing count change at once.'),
      ] },
      { table: {
        head: [t('사유', 'Reason'), t('폐사', 'Death'), t('도태', 'Cull')],
        rows: [
          [t('01 위축', '01 Wasting'), t('○', '○'), t('○', '○')],
          [t('02 표피염', '02 Skin infection'), t('○', '○'), t('○', '○')],
          [t('03 압사', '03 Crushed'), t('○', '○'), t('—', '—')],
          [t('04 아사', '04 Starved'), t('○', '○'), t('—', '—')],
          [t('05 도태', '05 Cull'), t('—', '—'), t('○', '○')],
          [t('06 기타 (사유를 적습니다)', '06 Other (write the reason)'), t('○', '○'), t('○', '○')],
        ],
      } },
      { p: t('종류에 맞지 않는 사유는 목록에 나오지 않습니다 (예: 도태를 고르면 「압사」가 없습니다).',
             'Reasons that do not fit the type are not shown (e.g. "압사" is not offered for a cull).') },

      { h3: t('사진을 못 찍었으면', 'If you could not take a photo') },
      { ol: [
        t('「사진을 못 찍었습니다 — 24시간 안에 붙이겠습니다」에 표시합니다.', 'Tick "사진을 못 찍었습니다 — 24시간 안에 붙이겠습니다".'),
        t('못 찍은 사유를 적고 등록합니다. 그 기록에 *보완 기한(24시간 뒤)* 이 붙습니다.', 'Write why and add it. The record gets a *deadline 24 hours later*.'),
        t('사진을 찍으면 그 칸을 다시 눌러, 기록 옆 *「사진 붙이기」* 를 누릅니다. 두수는 바뀌지 않으므로 *제출한 뒤에도* 붙일 수 있습니다.',
          'When you have the photo, click the cell again and press *"사진 붙이기"* next to the record. The count does not change, so you can attach it *even after submitting*.'),
      ] },
      { warn: t('사진 없는 폐사는 본사 화면에 *주황 ●* 로 계속 보입니다. 카톡으로 따로 보내지 말고 *이 창에 붙여 주십시오.*',
                'A death without a photo keeps showing an *orange ●* on the head-office screen. Do not send it by KakaoTalk — *attach it here.*') },

      { h3: t('휴대폰으로 넣기', 'Using a phone') },
      { p: t('휴대폰으로 이 사이트를 열면 숫자는 *보기만* 되지만, 돈방 카드마다 *「폐사·도태」* 단추가 있습니다. 사진 칸을 누르면 *카메라가 바로 열립니다* — 돈방에서 찍어 바로 올리면 됩니다.',
             'On a phone you can only *view* the numbers, but each pen card has a *"폐사·도태"* button. The photo field *opens the camera directly* — take it in the pen and upload it right away.') },

      { h3: t('잘못 넣었으면', 'If you made a mistake') },
      { p: t('창에서 그 기록의 *「빼기」* 를 누르고 *「뺍니다」* 로 한 번 더 확인합니다. *제출하기 전까지만* 됩니다. 제출한 뒤에 찾으면 본사에 말합니다.',
             'Press *"빼기"* (remove) on that record, then confirm with *"뺍니다"*. This works *only until you submit*. After that, tell the head office.') },

      { h3: t('그날 기록 모아 보기', 'Seeing the whole day') },
      { p: t('폐사·도태가 있으면 표 위에 *「오늘 폐사 N두 · 도태 M두」* 줄이 나옵니다. *「일지 · 사진 보기」* 를 누르면 그 돈사의 그날 기록이 사진과 함께 한 화면에 나옵니다. 사진을 누르면 *크게* 보입니다 (Esc 로 닫습니다).',
             'When there are deaths or culls, a line *"오늘 폐사 N두 · 도태 M두"* appears above the table. Press *"일지 · 사진 보기"* to see all of the day’s records for the house with photos. Click a photo to *enlarge* it (Esc closes it).') },
    ],
  },

  /* ── 4. 제출 ──────────────────────────────────────────────────── */
  {
    id: 'submit',
    views: ['field'],
    title: t('제출하기', 'Submitting'),
    blocks: [
      { flow: [
        t('*내가* 제출', '*You* submit'),
        t('본사가 확정', 'Head office confirms'),
        t('PDF 출력 · 서명', 'Print PDF · sign'),
        t('3년 보관', 'Keep 3 years'),
      ] },
      { ul: [
        t('다 넣으면 오른쪽 아래 *제출*을 누릅니다.',
          'When everything is entered, press *제출* (Submit) at the bottom right.'),
        t('빈 줄이나 빨간 칸이 남아 있으면 *제출을 누를 수 없습니다.* 몇 줄이 남았는지 표 위에 나옵니다.',
          'If empty rows or red cells remain, *you cannot submit.* The number of rows left is shown above the table.'),
        t('제출한 뒤에는 *고칠 수 없습니다.* 누르기 전에 한 번 봅니다.',
          'After you submit, *you cannot change it.* Look once before you press.'),
        t('틀린 것을 나중에 찾으면 *본사에 말합니다.* 정정전표로 고칩니다.',
          'If you find a mistake later, *tell the head office.* It is fixed with a correction voucher.'),
      ] },
      { p: t('확정은 본사가 합니다. 내가 쓴 일보를 내가 확정할 수는 없습니다 — 쓴 사람과 확인하는 사람이 달라야 하기 때문입니다.',
             'The head office confirms. You cannot confirm your own report — the person who writes and the person who checks must be different.') },
    ],
  },

  /* ── 확정 (본사) ──────────────────────────────────────────────── */
  {
    id: 'confirm',
    views: ['hq'],
    title: t('확인하고 확정하기', 'Checking and confirming'),
    blocks: [
      { h3: t('제출 현황에서 시작합니다', 'Start from the status board') },
      { p: t('아침에 이 화면을 먼저 봅니다. *어느 돈사가 아직 안 냈나*를 한 장으로 답합니다.',
             'Look at this screen first in the morning. It answers *which house has not submitted yet* on one page.') },
      { figure: {
        src: '/help/status.png',
        alt: t('제출 현황 화면', 'The submission status board'),
        marks: [{ x: 20.5, y: 6.4 }, { x: 40, y: 47 }, { x: 76, y: 47 }],
        legend: [
          t('오늘 12개 돈사 중 몇 개가 확정됐나', 'How many of the 12 houses are confirmed today'),
          t('입력 — 있어야 할 줄 중 몇 줄이 들어왔나 (44 / 44 이면 다 됨)',
            'Entered — how many of the required rows are in (44 / 44 means complete)'),
          t('상태 — 누르면 그 돈사 일보로 갑니다', 'Status — click to open that house’s report'),
        ],
      } },
      { h3: t('확정', 'Confirming') },
      { big: [
        t('돈사를 눌러 일보를 엽니다.', 'Click a house to open its report.'),
        t('*차이* 칸에 숫자가 있으면 *사유*를 읽습니다. 그게 확인의 핵심입니다.',
          'If a *difference* is shown, read the *reason*. That is the heart of checking.'),
        t('오른쪽 아래 *확정*을 누릅니다.', 'Press *확정* (Confirm) at the bottom right.'),
      ] },
      { warn: t('확정하면 *원본이 고정됩니다.* 그 뒤에는 팀장도 본사도 직접 못 고칩니다. 고쳐야 하면 정정전표를 발행합니다.',
                'Once confirmed, *the record is locked.* After that neither the team lead nor the head office can edit it directly. Issue a correction voucher instead.') },
      { p: t('잘못 확정했으면 *확정 해제*로 되돌릴 수 있습니다. 그 기록도 남습니다.',
             'If you confirmed by mistake, you can undo it with *확정 해제* (Unconfirm). That is recorded too.') },

      { h3: t('폐사·도태와 사진 확인', 'Checking deaths, culls and photos') },
      { ul: [
        t('제출 현황 표의 *폐사 · 도태* 열에 돈사별 두수가 나옵니다. *주황 ●* 은 사진이 아직 안 붙은 폐사가 있는 돈사입니다.',
          'The *폐사 · 도태* columns on the status board show counts per house. An *orange ●* marks a house with a death still missing a photo.'),
        t('오른쪽 위 *「폐사·도태 일지」* 를 누르면 그 날 전 돈사의 기록이 *사진과 함께* 한 장에 나옵니다. 사진 보완이 남은 돈사가 맨 위에 옵니다.',
          'Press *"폐사·도태 일지"* at the top right to see every house’s records for the day *with photos*. Houses still missing a photo come first.'),
        t('사진을 누르면 크게 보입니다. 돈사 옆 *「일보 열기」* 로 그 일보로 갑니다.',
          'Click a photo to enlarge it. *"일보 열기"* next to a house opens its report.'),
        t('일보 안에서도 *폐사·도태 칸*을 누르면 그 줄의 기록과 사진을 볼 수 있습니다 (본사는 보기만).',
          'Inside a report, clicking a *폐사·도태 cell* shows that row’s records and photos (head office can only view).'),
      ] },
      { p: t('사진 보완 기한(24시간)이 지난 폐사는 팀장에게 알려 주십시오.',
             'If a death passes its 24-hour photo deadline, remind the team lead.') },
    ],
  },

  /* ── 종이 ─────────────────────────────────────────────────────── */
  {
    id: 'paper',
    views: ['field', 'hq'],
    title: t('종이 출력과 보관', 'Printing and keeping paper'),
    blocks: [
      { warn: t('*컴퓨터에 넣은 것만으로는 안 됩니다.* HACCP 심사는 종이를 봅니다. 출력해서 서명하고 *3년* 보관합니다.',
                '*Entering it in the computer is not enough.* The HACCP audit looks at paper. Print it, sign it, and keep it for *3 years*.') },
      { ol: [
        t('확정된 일보를 PDF 로 출력합니다.', 'Print the confirmed report as a PDF.'),
        t('작성자와 확인자가 서명합니다.', 'The writer and the checker sign it.'),
        t('돈사별 사무실에 보관합니다.', 'Keep it in the office of each house.'),
      ] },
      { p: t('출력물에는 확인 번호가 찍힙니다. 종이와 컴퓨터의 내용이 같다는 표시입니다. *종이를 손으로 고치지 않습니다.* 고치면 번호가 안 맞습니다.',
             'The printout carries a check number. It proves the paper and the computer hold the same data. *Do not correct the paper by hand.* If you do, the number will not match.') },
    ],
  },

  /* ── 담당 바꾸기 (관리자) ─────────────────────────────────────── */
  {
    id: 'scope',
    views: ['admin'],
    title: t('담당 바꾸기', 'Changing who looks after a house'),
    blocks: [
      { p: t('사람이 쉬거나 돈사를 바꿔 맡을 때 *계정 관리 → 담당* 에서 바꿉니다.',
             'When someone is away or takes over another house, change it in *계정 관리 → 담당* (Accounts → Assignment).') },
      { h3: t('먼저 적용일을 정합니다', 'First set the effective date') },
      { p: t('화면 *오른쪽 위*에 있습니다. 오늘부터면 그대로 둡니다.',
             'It is at the *top right* of the screen. Leave it if the change starts today.') },
      { figure: {
        src: '/help/scopedate.png',
        alt: t('적용일 고르는 칸', 'The effective-date field'),
        caption: t('적용일을 미래로 두면 그날부터 바뀝니다 — 「10월 1일부터 넘긴다」를 미리 넣어 두면 그날 기억하지 않아도 됩니다.',
                   'Set a future date and the change takes effect on that day — enter "hand over from 1 October" in advance and nobody has to remember on the day.'),
      } },
      { h3: t('칸을 누릅니다', 'Click a cell') },
      { figure: {
        src: '/help/scope.png',
        alt: t('돈사와 사람이 만나는 담당 표', 'The grid of houses and people'),
        marks: [{ x: 5, y: 12 }, { x: 31, y: 30 }, { x: 5, y: 82 }, { x: 30, y: 89 }],
        legend: [
          t('왼쪽은 돈사, 위쪽은 사람입니다', 'Houses on the left, people across the top'),
          t('● 이 있으면 담당입니다. *빈 칸은 누르면 바로 담당*이 되고, ● 칸은 그 자리에서 뺄지 묻습니다',
            'A ● means they look after it. *Click an empty cell to assign at once*; click a ● and it asks right there whether to remove'),
          t('왼쪽에 빨간 선 — 담당이 없는 돈사입니다', 'A red line on the left — no one is assigned'),
          t('담당이 없으면 아래에 경고가 나옵니다', 'A warning appears below if anyone is missing'),
        ],
      } },
      { warn: t('표에서 *담당 팀장 「없음」* 인 줄이 있으면 안 됩니다. 그 돈사는 *아무도 일보를 쓰지 않습니다.*',
                'No row may show *"없음" (none)* under team lead. *Nobody would write that house’s report.*') },
      { h3: t('알아둘 것', 'Things to know') },
      { ul: [
        t('바꾼 것은 *변경 이력* 에 남습니다. *지울 수 없습니다.*',
          'Every change is kept in the *change log*. *It cannot be deleted.*'),
        t('담당에서 빠지면 그 돈사의 *지난 일보도 안 보입니다.* 볼 일이 있으면 본사에 말합니다.',
          'Once removed, that person *can no longer see past reports* for the house. Ask the head office if you need them.'),
        t('부장·본사처럼 *전 돈사* 를 맡는 사람은 칸으로 안 그립니다. 표 아래에 적힙니다.',
          'People who cover *all houses* are not drawn as cells. They are listed below the table.'),
      ] },
    ],
  },

  /* ── 계정 (관리자) ────────────────────────────────────────────── */
  {
    id: 'account',
    views: ['admin'],
    title: t('계정과 비밀번호', 'Accounts and passwords'),
    blocks: [
      { h3: t('새 계정', 'New account') },
      { big: [
        t('*계정* 탭 → *새 계정*.', 'The *계정* (Accounts) tab → *새 계정* (New account).'),
        t('아이디(영문 소문자·숫자)와 이름을 넣습니다.',
          'Enter an ID (lowercase letters and digits) and a name.'),
        t('비밀번호는 시스템이 만들어 *한 번만* 보여 줍니다.',
          'The system creates the password and shows it *only once*.'),
      ] },
      { warn: t('비밀번호는 *그 화면을 닫으면 다시 못 봅니다.* 본인에게 전달하고, 잊었으면 새로 만들어 줍니다.',
                'Once you close that screen *the password cannot be seen again.* Give it to the person; if they forget it, make a new one.') },
      { h3: t('그만둔 사람', 'People who leave') },
      { p: t('*지우지 않습니다. 「중지」로 둡니다.* 지난 일보에 그 사람 이름이 남아 있어야 하기 때문입니다. 중지하면 바로 로그인이 안 되고, 열려 있던 화면도 끊깁니다.',
             '*Do not delete them. Set them to "중지" (suspended).* Their name must stay on past reports. Suspending blocks login at once and closes any open session.') },
      { h3: t('등급', 'Roles') },
      { p: t('등급 바꾸기는 *본사만* 합니다. 관리자여도 못 바꿉니다.',
             'Only the *head office* can change roles. Even an administrator cannot.') },
      { p: t('팀장이 스스로 본사 등급을 가질 수 있으면 *자기가 쓴 일보를 자기가 확정*하게 됩니다. 그것을 막는 한 줄입니다.',
             'If a team lead could give themselves the head-office role, they could *confirm their own report*. This one rule prevents that.') },
      { h3: t('변경 이력', 'Change log') },
      { p: t('계정·담당을 바꾼 기록은 *변경 이력* 탭에 남습니다. 누가 언제 무엇을 바꿨는지 전부 나오고, *지울 수 없습니다* — HACCP 심사에서 요구하는 기록입니다.',
             'Every account and assignment change is kept in the *change log* tab. It shows who changed what and when, and *it cannot be deleted* — the HACCP audit requires this.') },
    ],
  },

  /* ── 문제 ─────────────────────────────────────────────────────── */
  {
    id: 'trouble',
    views: ['field', 'hq', 'admin'],
    title: t('문제가 생기면', 'If something goes wrong'),
    blocks: [
      { table: {
        head: [t('이런 때', 'When this happens'), t('이렇게', 'Do this')],
        rows: [
          [t('폐사·도태 칸에 숫자가 안 써집니다', 'I cannot type in the deaths/culls cell'),
           t('그 칸은 치는 곳이 아닙니다. *눌러서* 등록 창을 엽니다',
             'That cell is not for typing. *Click it* to open the form')],
          [t('폐사 등록이 안 됩니다', 'I cannot add a death'),
           t('사진이 있거나, 「사진을 못 찍었습니다」와 사유가 있어야 합니다. 제출한 일보에는 넣을 수 없습니다',
             'You need a photo, or "사진을 못 찍었습니다" with a reason. A submitted report cannot take new records')],
          [t('칸에 숫자가 안 써집니다', 'I cannot type in the cells'),
           t('*일보 시작* 을 눌렀는지 봅니다. 표 위에 왜 안 되는지 써 있습니다',
             'Check whether you pressed *일보 시작* (Start report). The reason is written above the table')],
          [t('내 돈사가 안 보입니다', 'I cannot see my house'),
           t('담당이 아닙니다. 관리자에게 말합니다',
             'You are not assigned to it. Tell the administrator')],
          [t('제출 단추를 못 누릅니다', 'The submit button does not work'),
           t('빈 줄이나 빨간 칸이 남아 있습니다. 표 위에 몇 줄인지 나옵니다',
             'Empty rows or red cells remain. The count is shown above the table')],
          [t('제출한 일보를 고치고 싶습니다', 'I want to change a submitted report'),
           t('본사에 말합니다. 정정전표로 고칩니다',
             'Tell the head office. It is fixed with a correction voucher')],
          [t('비밀번호를 잊었습니다', 'I forgot my password'),
           t('관리자에게 말합니다', 'Tell the administrator')],
          [t('「실패가 여러 번 있었습니다」', '"Too many failed attempts"'),
           t('15분 기다렸다가 다시 합니다', 'Wait 15 minutes and try again')],
          [t('「저장 못 했습니다」가 뜹니다', '"Could not save" appears'),
           t('인터넷을 봅니다. *화면을 닫지 마십시오* — 열어 두면 다시 보냅니다',
             'Check the network. *Do not close the screen* — leave it open and it will retry')],
          [t('화면이 안 열립니다', 'The screen will not open'),
           t('인터넷을 봅니다. 그래도 안 되면 본사에 말합니다',
             'Check the network. If it still fails, tell the head office')],
        ],
      } },
      { warn: t('안 되는 것을 *그냥 넘기지 않습니다.* 두수가 한 번 틀리면 그 뒤 모든 날이 틀립니다.',
                '*Never skip something that is not working.* One wrong head count makes every day after it wrong.') },
    ],
  },
];
