/**
 * 테스트 안내 — 발주처 시험 기간에만 쓰는 페이지
 *
 * 설명서(content.js)는 「이 화면을 어떻게 쓰나」, 이 파일은 「시험 기간에 무엇을
 * 해 보고 무엇을 알려 달라는가」다. 읽는 분들은 지금까지 엑셀과 수기로 일보를
 * 써 왔고 이 시스템을 처음 본다 — 엑셀과 무엇이 같고 다른지부터 말한다.
 *
 * 형식은 content.js 와 같다. t(한국어, 영어). *별표* 는 굵게.
 * 정식 가동하면 메뉴에서 내린다 (App.jsx 의 「테스트 안내」).
 */

const t = (ko, en, ne) => ({ ko, en, ne });

/**
 * 연락처 — 비어 있는 것은 화면에 나오지 않는다.
 * 채팅이나 저장소에 개인 연락처를 남기지 않으려면 배포 직전에 채운다.
 */
export const CONTACT = {
  email: '',
  kakao: '부여GP 일보 테스트 단톡방',
};

export const TG_UI = {
  title: t('테스트 안내', 'Test guide'),
  subtitle: t('시험 기간에 해 주실 일과 알려 주실 곳', 'What to try during the test, and where to report'),
  who: t('누구를 위한 안내입니까?', 'Who is this for?'),
  all: t('모두', 'Everyone'),
  allSub: t('전체 읽기', 'read everything'),
};

/** 역할별 보기. 'all' 은 공통 절만이 아니라 전부를 보여 준다 */
export const TG_VIEWS = [
  { id: 'all', label: TG_UI.all, sub: TG_UI.allSub },
  { id: 'field', label: t('팀장', 'Team lead'), sub: t('일보를 쓰는 사람', 'writes the report') },
  { id: 'hq', label: t('본사', 'Head office'), sub: t('확인하고 확정하는 사람', 'checks and confirms') },
  { id: 'admin', label: t('관리자', 'Administrator'), sub: t('담당·계정을 고치는 사람', 'manages people') },
];

const ALL = ['field', 'hq', 'admin'];

export const TG_SECTIONS = [
  /* ── 1. 테스트란 ───────────────────────────────────────────────── */
  {
    id: 'about',
    views: ALL,
    title: t('이번 테스트는', 'About this test'),
    blocks: [
      { p: t('지금까지 엑셀과 종이로 쓰던 *돈사 일보를 이 화면에서 써 보는* 시험입니다. 실제로 쓰기 전에 *숫자가 맞게 나오는지, 쓰기 불편한 곳은 없는지* 확인하려는 것입니다.',
             'This is a trial of writing the *daily house report on this screen* instead of Excel and paper. Before real use, we want to check that *the numbers come out right and nothing is hard to use*.') },
      { ul: [
        t('주소: *https://ilbo.piggp.com* — 사무실 PC 의 *크롬(Chrome)* 이나 *엣지(Edge)* 로 엽니다.',
          'Address: *https://ilbo.piggp.com* — open it in *Chrome* or *Edge* on the office PC.'),
        t('아이디와 비밀번호는 *관리자*가 한 사람씩 따로 드립니다. 계정은 같이 쓰지 않습니다.',
          'The *administrator* gives each person their own ID and password. Do not share accounts.'),
        t('*테스트 기간에도 엑셀 일보는 평소대로 씁니다.* 두 쪽 숫자를 맞춰 보는 것이 이번 시험의 핵심입니다.',
          '*Keep writing the Excel report as usual during the test.* Comparing the two is the main point of this test.'),
        t('테스트 기간에 넣은 숫자는 *정식 기록으로 쓰지 않습니다.* 정식 가동 전에 정리하고, 엑셀 원본으로 다시 채웁니다. 마음 놓고 눌러 보십시오.',
          'Numbers entered during the test *will not be kept as official records.* They are cleared before go-live and refilled from the Excel originals. Feel free to try things.'),
      ] },
      { h3: t('엑셀과 같은 점, 다른 점', 'Same as Excel, and different') },
      { table: {
        head: [t('', ''), t('엑셀', 'Excel'), t('이 화면', 'This screen')],
        rows: [
          [t('돈방·축종 줄', 'Pen and category rows'), t('같습니다', 'Same'), t('같습니다', 'Same')],
          [t('전일두수', 'Opening count'), t('손으로 옮겨 적음', 'Copied by hand'),
           t('*어제 확정된 당일두수가 저절로* 들어옵니다 (고칠 수 없음)', '*Filled automatically* from yesterday’s confirmed closing (cannot be changed)'), 'auto'],
          [t('당일두수', 'Closing count'), t('수식', 'Formula'),
           t('*저절로 계산*됩니다', '*Calculated automatically*'), 'auto'],
          [t('변동 없는 칸', 'Cells with no change'), t('비워 둠', 'Left empty'),
           t('*0 을 넣어야* 합니다 — 비워 두면 「아직 안 봤다」로 봅니다', '*Must be 0* — an empty cell means "not checked yet"'), 'you'],
          [t('저장', 'Saving'), t('Ctrl+S', 'Ctrl+S'),
           t('*1~2초 뒤 저절로* 저장됩니다', '*Saves by itself* after 1–2 seconds'), 'auto'],
          [t('틀린 숫자', 'Wrong numbers'), t('나중에 본사가 찾음', 'Found later by head office'),
           t('*넣는 순간 빨갛게* 알려 줍니다', '*Turns red the moment* you type it'), 'you'],
        ],
      } },
    ],
  },

  /* ── 아직 없는 기능 ─────────────────────────────────────────────── */
  // 없는 것을 먼저 말한다. 모르고 찾다 보면 「고장」으로 알고, 폐사 두수 차이는 오류로 신고된다
  {
    id: 'notyet',
    views: ALL,
    title: t('아직 만들어지지 않은 기능', 'Not built yet'),
    blocks: [
      { p: t('아래 기능은 *아직 없습니다.* 찾으셔도 화면에 없는 것이 정상입니다. 테스트 결과를 보고 순서대로 만듭니다.',
             'The features below *do not exist yet.* It is normal not to find them. We will build them in order after the test.') },
      { h3: t('이번 테스트에 영향이 있는 것', 'These affect the test') },
      { table: {
        head: [t('기능', 'Feature'), t('테스트 중에는', 'During the test')],
        rows: [
          [t('일보 PDF 의 *일부 칸*', 'Some parts of the PDF report'),
           t('PDF 출력은 됩니다. 다만 *분만사 하위 표*(분만·이유·도폐사 현황), 종부·임신사의 *사고 내역·종부* 칸, *백신 기록*은 아직 비어 나옵니다. 종부·임신사를 한 장에 싣는 양식은 *「하루치 PDF」에서만* 나옵니다 (일보 화면의 출력은 돈사마다 한 장).',
             'PDF printing works. But the *farrowing sub-tables*, the *incidents and matings* columns of the breeding houses, and the *vaccination log* are still blank. The four-houses-on-one-page breeding sheet appears *only in "하루치 PDF"* (the report screen prints one page per house).'), 'you'],
          [t('*제출·확정한 일보 고치기* (정정전표)', '*Correcting a submitted/confirmed report* (correction voucher)'),
           t('없습니다. 제출 뒤 틀린 것을 찾으면 *알려 주십시오.* 테스트 기간에는 개발자가 정리합니다.',
             'Not yet. If you find a mistake after submitting, *tell us.* During the test the developer fixes it.'), 'you'],
          [t('*돈사 간 이동 맞추기* — 한 돈사의 전출과 받은 돈사의 전입이 같은지 자동 확인',
             '*Matching moves between houses* — checking that one house’s "out" equals the receiving house’s "in"'),
           t('자동 확인은 아직 없습니다. 두 돈사 숫자가 안 맞으면 알려 주십시오.',
             'Not checked automatically yet. Tell us if two houses do not match.')],
        ],
      } },
      { h3: t('그다음에 만들 것 (이번 테스트와는 관계없음)', 'Coming later (not part of this test)') },
      { ul: [
        t('약품 사용·*휴약기간*, 백신 기록', 'Medicine use and *withdrawal periods*, vaccination records'),
        t('분만사 하위 표 — 분만·이유·도폐사 현황', 'Farrowing-house sub-tables — farrowing, weaning, deaths'),
        t('본사 *실시간 알림*(이상 있는 일보가 바로 뜨는 목록), 미제출 알림(웹 알림·카카오 알림톡)',
          'Head office *live alerts* (a list of reports with problems), reminders for unsubmitted reports (web push, KakaoTalk)'),
        t('*비밀번호를 본인이 바꾸기*, 본사 계정 2단계 인증 — 지금은 관리자가 재발급합니다',
          '*Changing your own password*, two-step login for head office — for now the administrator issues new ones'),
        t('용어 카드의 *네팔어* 칸 — 팀장께 부탁드려 채웁니다', 'The *Nepali* column of the word card — to be filled with a team lead’s help'),
      ] },
    ],
  },

  /* ── 2. 하루 흐름 ──────────────────────────────────────────────── */
  {
    id: 'flow',
    views: ALL,
    title: t('하루 흐름', 'How a day goes'),
    blocks: [
      { flow: [
        t('팀장: 일보 시작', 'Team lead: start the report'),
        t('숫자 입력 (자동 저장)', 'Enter numbers (auto-save)'),
        t('팀장: 제출', 'Team lead: submit'),
        t('본사: 확인 · 확정', 'Head office: check and confirm'),
        t('다음 날 일보를 시작할 수 있음', 'The next day can start'),
      ] },
      { warn: t('*본사가 확정해야 다음 날 일보를 시작할 수 있습니다.* 오늘 일보가 확정되지 않으면 내일 「일보 시작」을 눌렀을 때 「앞 일보(날짜)가 아직 확정되지 않았습니다」가 나옵니다. 틀린 숫자가 다음 날로 넘어가지 않게 하는 장치입니다. 테스트 중에도 *본사는 매일 확정*해 주십시오.',
                '*The next day cannot start until head office confirms.* If today is not confirmed, pressing "일보 시작" tomorrow shows "the previous report (date) is not confirmed yet". This stops a wrong number from carrying into the next day. During the test too, *head office please confirm every day*.') },
    ],
  },

  /* ── 3. 팀장 ───────────────────────────────────────────────────── */
  {
    id: 'lead',
    views: ['field'],
    title: t('팀장이 해 주실 일', 'For team leads'),
    blocks: [
      { h3: t('1. 돈사를 고르고 「일보 시작」', '1. Pick your house and press "일보 시작"') },
      { p: t('위쪽 돈사 이름 중 *내 돈사*를 누릅니다. 오늘 날짜가 열립니다. 「일보 시작」을 누르기 전에는 칸에 글씨가 써지지 않습니다.',
             'Click *your house* in the row of house names at the top. Today’s date opens. You cannot type until you press "일보 시작".') },
      { figure: {
        src: '/help/notstarted.png',
        alt: t('아직 시작하지 않은 일보', 'A report not started yet'),
        marks: [{ x: 19, y: 7.3 }, { x: 45, y: 11.9 }, { x: 96.4, y: 96.7 }],
        legend: [
          t('「미시작」 — 아직 일보가 없습니다', '"미시작" — no report yet'),
          t('왜 안 써지는지 여기에 나옵니다', 'Why you cannot type is written here'),
          t('이 단추를 누릅니다', 'Press this button'),
        ],
      } },

      { h3: t('2. 엑셀에 쓰던 대로 숫자를 넣습니다', '2. Enter the numbers as you did in Excel') },
      { p: t('*흰 칸(전입·전출·내부이동·판매)만* 넣습니다. 회색 칸은 시스템이 채웁니다. 엑셀 일보를 옆에 두고 같은 돈방·같은 축종 줄에 같은 숫자를 넣으십시오.',
             'Enter *only the white cells (in, out, internal transfer, sold)*. The grey cells are filled by the system. Keep the Excel report next to you and put the same numbers in the same pen and category row.') },
      { figure: {
        src: '/help/grid.png',
        alt: t('일보 입력 표', 'The entry table'),
        marks: [{ x: 22.8, y: 16 }, { x: 33, y: 16 }, { x: 59.6, y: 16 }, { x: 67.7, y: 16 }],
        legend: [
          t('전일두수 — 저절로 들어옵니다 (회색)', 'Opening count — filled automatically (grey)'),
          t('전입·전출·내부이동·판매 — *여기만 넣습니다*', 'In / out / internal / sold — *enter only these*'),
          t('폐사·도태 — 폐사 등록에서 넘어옵니다 (회색)', 'Deaths and culls — from the mortality screen (grey)'),
          t('당일두수 — 저절로 계산됩니다', 'Closing count — calculated automatically'),
        ],
      } },
      { p: t('입력하는 돈방은 *돈방 이름 칸이 청록색*으로 바뀌고, 돈방마다 바탕이 번갈아 칠해져 있습니다. 옆 돈방 줄에 넣지 않았는지 한 번씩 보십시오.',
             'The pen you are typing in has its *name cell turned green*, and pens alternate in background colour. Glance at it so you do not type into the next pen’s row.') },

      { h3: t('3. 변동이 없으면 0 — 「Ctrl + Enter」', '3. No change means 0 — "Ctrl + Enter"') },
      { p: t('줄 왼쪽의 *빨간 세로선*은 「아직 안 끝난 줄」입니다. 그 줄의 *흰 칸 4개가 모두 채워져야* 사라집니다. 빈칸은 「없었다」인지 「안 봤다」인지 알 수 없기 때문입니다.',
             'A *red vertical line* on the left of a row means "this row is not finished". It goes away only when *all 4 white cells in the row are filled*. An empty cell cannot tell "nothing happened" from "not checked".') },
      { keys: [
        [['Ctrl', 'Enter'], t('*그 줄의 빈칸을 모두 0 으로* 채우고 다음 줄로 갑니다. 이미 넣은 숫자는 그대로 둡니다.',
                              '*Fills every empty cell in that row with 0* and moves to the next row. Numbers you already typed stay.')],
        [['Tab'], t('다음 칸', 'Next cell')],
        [['Enter'], t('아래 줄 같은 칸', 'Same cell in the next row')],
      ] },
      { p: t('*숫자를 하나라도 넣은 줄*은 다른 줄로 옮기면 나머지 빈칸이 *저절로 0* 이 됩니다. 예: 전입 1, 전출 1 을 넣고 아래 줄로 가면 내부이동·판매가 0 이 되고 빨간 선이 사라집니다.',
             'In *a row where you typed any number*, the remaining empty cells *become 0 by themselves* when you move to another row. Example: type in 1, out 1, move down — internal and sold become 0 and the red line disappears.') },
      { p: t('*아무것도 안 넣은 줄*(변동 없는 줄)은 두 가지 방법이 있습니다: 그 줄에서 *Ctrl + Enter*, 또는 오른쪽 아래 *「빈칸 0으로 채우기」* 로 남은 줄을 한꺼번에. 한꺼번에 채우면 *몇 줄을 채웠는지 본사 화면에 남습니다* — 정말 변동이 없었던 줄만 남았을 때 쓰십시오.',
             'For *rows you did not touch* (no change), either press *Ctrl + Enter* in that row, or use *"빈칸 0으로 채우기"* at the bottom right to fill all remaining rows at once. Filling at once *is recorded for head office* with the number of rows — use it only when the remaining rows really had no change.') },

      { h3: t('4. 폐사·도태는 그 칸을 눌러 등록합니다', '4. Record deaths and culls by clicking that cell') },
      { p: t('표의 *폐사·도태* 칸(점선 밑줄)을 누르면 그 줄의 등록 창이 열립니다. 숫자를 칸에 직접 치지 않습니다 — *등록한 기록의 합*이 칸에 들어갑니다.',
             'Click the *폐사·도태* cell (dotted underline) to open the form for that row. You do not type the number into the cell — the cell shows *the total of what you record*.') },
      { ol: [
        t('*폐사* 또는 *도태*를 고르고 두수를 넣습니다. 모돈처럼 번호가 있으면 *이각번호*도 적습니다.',
          'Choose *폐사* (death) or *도태* (cull) and enter the head count. Add the *ear tag* if the pig has one (e.g. a sow).'),
        t('*사유*를 고릅니다 (01 위축 · 02 표피염 · 03 압사 · 04 아사 · 05 도태 · 06 기타). 「기타」는 사유를 적어야 합니다.',
          'Pick a *reason* (01–06). "06 기타" (other) needs a written reason.'),
        t('폐사는 *사진이 있어야* 등록됩니다 (도태는 없어도 됩니다). 못 찍었으면 「사진을 못 찍었습니다」에 표시하고 사유를 적습니다 — *24시간 안에* 사진을 붙여야 합니다. 사진이 빠진 줄은 칸 오른쪽 위에 *주황 점*이 보입니다.',
          'A death *needs a photo* (a cull does not). If you could not take one, tick "사진을 못 찍었습니다" and write why — attach the photo *within 24 hours*. Rows missing a photo show an *orange dot* in the corner.'),
        t('사진은 나중에 붙일 수 있습니다: 그 칸을 다시 눌러 기록 옆 *「사진 붙이기」*. 두수가 바뀌지 않으므로 *제출한 뒤에도* 됩니다.',
          'You can attach the photo later: click the cell again and press *"사진 붙이기"* next to the record. The count does not change, so this works *even after submitting*.'),
        t('*휴대폰*으로 이 사이트를 열면 돈방 카드마다 「폐사·도태」 단추가 있고, 사진 칸이 *카메라를 바로 엽니다.* 돈방에서 찍어 바로 올리면 카톡으로 보낼 필요가 없습니다.',
          'On a *phone*, each pen card has a "폐사·도태" button and the photo field *opens the camera directly.* Take and upload it in the pen — no need to send it by KakaoTalk.'),
      ] },
      { p: t('잘못 넣었으면 창에서 *빼기* → *뺍니다*를 누릅니다 (제출 전까지만). 휴대폰에서는 숫자 입력은 안 되고 *폐사·도태만* 넣을 수 있습니다.',
             'If you made a mistake, press *빼기* then *뺍니다* in the form — until you submit. On a phone you cannot enter numbers, *only deaths and culls*.') },
      { p: t('폐사·도태가 있으면 표 위에 *「오늘 폐사 N두 · 도태 M두」* 줄이 생깁니다. *「일지 · 사진 보기」* 로 그날 기록을 사진과 함께 모아 보고, 사진을 누르면 크게 보입니다.',
             'When there are deaths or culls, a line *"오늘 폐사 N두 · 도태 M두"* appears above the table. Use *"일지 · 사진 보기"* to see the day’s records with photos; click a photo to enlarge it.') },
      { p: t('*해 보실 것*: 폐사 한 건을 사진 없이(사유만) 넣고, 나중에 「사진 붙이기」로 보완해 보십시오. 휴대폰으로도 한 건 넣어 보십시오.',
             '*Please try*: add one death without a photo (reason only) and attach the photo later with "사진 붙이기". Also try adding one from a phone.') },

      { h3: t('5. 숫자가 틀리면 빨갛게 나옵니다', '5. Wrong numbers turn red') },
      { figure: {
        src: '/help/red.png',
        alt: t('빨간 칸과 위쪽 안내', 'A red cell and the message at the top'),
        marks: [{ x: 14, y: 29 }, { x: 45, y: 73 }, { x: 60, y: 73 }],
        legend: [
          t('*무엇이 잘못됐는지* 표 위 분홍 줄에 나옵니다', '*What is wrong* is written in the pink bar above the table'),
          t('차이 — 직접 센 두수와 계산이 다릅니다', 'Difference — your count and the calculation do not match'),
          t('빨간 칸을 고치면 바로 사라집니다', 'Fix the red cell and it disappears at once'),
        ],
      } },
      { ul: [
        t('*당일두수가 빨갛다* — 있는 것보다 많이 나갔습니다. 전출·판매를 다시 봅니다.',
          '*Closing count is red* — more went out than you had. Check out and sold again.'),
        t('*보고두수*(직접 센 두수)를 넣었는데 계산과 다르면 *차이*가 나오고 *사유*를 적어야 합니다.',
          'If you enter a *counted head* and it differs from the calculation, a *difference* appears and you must write a *reason*.'),
        t('빨간 칸이 있는 줄은 *저장되지 않습니다.* 고치면 바로 저장됩니다. 오른쪽 아래 저장 상태를 보십시오.',
          'A row with a red cell *is not saved.* It saves as soon as you fix it. Watch the save state at the bottom right.'),
      ] },

      { h3: t('6. 제출 전에 PDF 로 엑셀과 맞춰 보기', '6. Before submitting, compare the PDF with Excel') },
      { p: t('오른쪽 아래 *「PDF 미리보기」* 를 누르면 인쇄 모양이 새 탭에 열립니다. 확정 전이라 *「확정 전 미리보기」* 표시가 찍힙니다 — 공식 종이가 아닙니다. 엑셀 일보와 나란히 놓고 숫자가 같은지 보십시오.',
             'Press *"PDF 미리보기"* at the bottom right to open the print layout in a new tab. It carries a *"확정 전 미리보기"* (preview) mark — it is not the official paper. Put it next to the Excel report and check the numbers.') },

      { h3: t('7. 다 넣었으면 「제출」', '7. When everything is in, press "제출" (Submit)') },
      { p: t('빨간 선과 빨간 칸이 모두 없어지면 오른쪽 아래 *제출*이 눌립니다.',
             'When all red lines and red cells are gone, *제출* at the bottom right can be pressed.') },
      { warn: t('*제출하면 팀장은 더 고칠 수 없습니다.* 제출 전에 엑셀과 한 번 더 맞춰 보십시오. 제출 뒤에 틀린 것을 찾으면 *고치지 말고 알려 주십시오* — 어느 돈사·날짜·줄인지만 적어 주시면 됩니다.',
                '*After submitting, the team lead cannot edit any more.* Compare with Excel once more before submitting. If you find a mistake afterwards, *do not try to fix it — tell us*: just the house, date and row.') },

      { h3: t('해 보고 알려 주실 것', 'Please try and tell us') },
      { ol: [
        t('돈방·축종 줄이 *실제 돈사와 같습니까?* 없는 돈방이나 빠진 돈방이 있으면 알려 주십시오.',
          'Do the pen and category rows *match the real house?* Tell us about missing or extra pens.'),
        t('폐사·도태까지 같은 숫자를 넣었을 때 *당일두수와 합계가 엑셀과 같습니까?*',
          'With the same numbers, are *the closing counts and totals the same as Excel?*'),
        t('*전일두수*가 어제 엑셀의 당일두수와 같습니까? (아래 「과거 엑셀 자료」를 먼저 읽어 주십시오)',
          'Is the *opening count* the same as yesterday’s Excel closing? (Read "Past Excel data" below first)'),
        t('*PDF 미리보기*의 숫자와 모양이 엑셀 일보와 같습니까?', 'Do the numbers and layout of the *PDF preview* match the Excel report?'),
        t('엑셀보다 *느리거나 불편한 곳*, 뜻을 모르겠는 낱말이 있습니까?',
          'Is anything *slower or harder* than Excel, or any word you do not understand?'),
      ] },
    ],
  },

  /* ── 4. 본사 ───────────────────────────────────────────────────── */
  {
    id: 'hq',
    views: ['hq'],
    title: t('본사가 해 주실 일', 'For head office'),
    blocks: [
      { h3: t('1. 「제출 현황」을 봅니다', '1. Open "제출 현황" (Status)') },
      { p: t('위쪽 *제출 현황*을 누르면 12개 돈사가 한 장에 나옵니다. 어느 돈사가 아직 안 냈는지 여기서 봅니다.',
             'Press *제출 현황* at the top to see all 12 houses on one page — which have not submitted yet.') },
      { figure: {
        src: '/help/status.png',
        alt: t('제출 현황', 'Status board'),
        marks: [{ x: 20.5, y: 6.4 }, { x: 40, y: 47 }, { x: 76, y: 47 }],
        legend: [
          t('오늘 몇 개 돈사가 확정됐나', 'How many houses are confirmed today'),
          t('입력 — 있어야 할 줄 중 몇 줄이 들어왔나', 'Entered — how many required rows are in'),
          t('상태 — 누르면 그 일보로 갑니다', 'Status — click to open that report'),
        ],
      } },
      { h3: t('2. 엑셀과 맞춰 보고 「확정」', '2. Compare with Excel, then "확정" (Confirm)') },
      { big: [
        t('제출된 돈사를 눌러 엽니다.', 'Open a submitted house.'),
        t('*당일두수·합계*가 그 돈사 엑셀 일보와 같은지 봅니다.', 'Check that *closing counts and totals* match that house’s Excel report.'),
        t('*차이*가 있는 줄은 *사유*를 읽습니다.', 'For rows with a *difference*, read the *reason*.'),
        t('일보 위에 *「일괄 0」* 안내가 있으면 팀장이 빈칸을 한꺼번에 0 으로 채운 것입니다. 그 돈방들이 정말 변동이 없었는지 확인합니다.',
          'If a *"일괄 0"* note is shown, the team lead filled empty rows with 0 all at once. Check that those pens really had no change.'),
        t('오른쪽 아래 *확정*을 누릅니다.', 'Press *확정* at the bottom right.'),
      ] },
      { h3: t('3. 폐사·도태와 사진 확인', '3. Check deaths, culls and photos') },
      { p: t('제출 현황 오른쪽 위 *폐사·도태 일지*를 누르면 그 날 전 돈사의 폐사·도태가 *사진과 함께* 한 장에 나옵니다. 사진을 누르면 크게 보입니다. 표의 *주황 ●* 은 사진 보완이 남은 돈사입니다.',
             'Press *폐사·도태 일지* at the top right of the status board to see every house’s deaths and culls for the day *with photos* on one page. Click a photo to enlarge it. An *orange ●* marks a house still missing a photo.') },
      { h3: t('4. 확정한 일보 PDF 출력', '4. Printing the confirmed report') },
      { p: t('확정하면 오른쪽 아래 단추가 *「PDF 출력」* 으로 바뀝니다. 누르면 새 탭에 열리고, 거기서 인쇄합니다. 출력하면 제출 현황의 *출력* 칸에 표시되고, 종이 맨 아래에 *무결성 값*이 찍힙니다 — 같은 숫자면 몇 번을 뽑아도 같은 값입니다. 출력물 모양이 엑셀 일보와 다른 곳이 있으면 알려 주십시오.',
             'Once confirmed, the button becomes *"PDF 출력"*. It opens in a new tab; print from there. Printing marks the *출력* column on the status board, and an *integrity value* is printed at the bottom — the same numbers always give the same value. Tell us where the layout differs from the Excel report.') },
      { p: t('하루치를 한꺼번에 뽑으려면 제출 현황 위쪽 *「하루치 PDF」* 를 누릅니다. 확정된 돈사만 한 파일에 실리고, *종부·임신사 네 돈사는 엑셀처럼 한 장*입니다. 빠진 돈사가 있으면 첫 쪽에 목록이 나옵니다.',
             'To print the whole day, press *"하루치 PDF"* at the top of the status board. Only confirmed houses are included, and *the four breeding houses share one page* as in Excel. A first page lists any house left out.') },
      { warn: t('*매일 확정해 주십시오.* 확정이 빠지면 그 돈사는 다음 날 일보를 시작할 수 없습니다.',
                '*Please confirm every day.* If a house is not confirmed, it cannot start the next day.') },
      { p: t('잘못 확정했으면 *확정 해제*로 되돌릴 수 있습니다. 숫자가 틀린 일보를 찾으면 확정하지 말고 알려 주십시오 — 테스트 기간에는 개발자가 정리합니다.',
             'If you confirmed by mistake, *확정 해제* undoes it. If a report has wrong numbers, do not confirm it — tell us; during the test the developer will sort it out.') },
    ],
  },

  /* ── 5. 관리자 ─────────────────────────────────────────────────── */
  {
    id: 'admin',
    views: ['admin'],
    title: t('관리자가 해 주실 일', 'For administrators'),
    blocks: [
      { p: t('관리자는 *누가 어느 돈사를 맡는지*와 *계정*을 고칩니다. 위쪽 *계정 관리*를 누릅니다.',
             'Administrators change *who handles which house* and *accounts*. Press *계정 관리* at the top.') },
      { h3: t('1. 팀장 비밀번호 만들어 드리기', '1. Give team leads their passwords') },
      { big: [
        t('*계정* 탭에서 팀장 이름 옆 *비밀번호 재발급*을 누릅니다.', 'In the *계정* (Accounts) tab, press *비밀번호 재발급* (New password) next to the team lead.'),
        t('새 비밀번호가 *한 번만* 화면에 나옵니다. 적어서 *본인에게 직접* 전해 주십시오.', 'The new password appears *only once*. Write it down and give it *to that person directly*.'),
        t('단톡방에는 올리지 마십시오. 비밀번호를 모르면 언제든 다시 재발급하면 됩니다.', 'Do not post it in the group chat. If it is lost, just issue a new one.'),
      ] },
      { h3: t('2. 담당 돈사 확인', '2. Check who handles which house') },
      { p: t('*담당* 탭은 돈사 × 사람 표입니다. *빈 칸을 누르면 바로 담당이 되고*, ● 칸을 누르면 그 자리에서 뺄지 묻습니다. 방금 바뀐 칸 옆에 결과가 잠깐 뜹니다.',
             'The *담당* (Assignments) tab is a house × person table. *Click an empty cell to assign at once*; click a ● to be asked, right there, whether to remove it. The result shows briefly next to the cell.') },
      { ul: [
        t('*담당 팀장이 「없음」인 돈사*가 있으면 그 돈사는 아무도 일보를 쓰지 않습니다. 테스트 전에 채워 주십시오.',
          'A house with *"없음" (none)* has nobody writing its report. Fill it before the test.'),
        t('오른쪽 위 *적용일*을 미래로 두면 그 날부터 바뀝니다 (○ 와 날짜로 보입니다).',
          'Set *적용일* (effective date) at the top right to a future date and the change starts that day (shown as ○ with the date).'),
        t('모든 변경은 *변경 이력* 탭에 누가·언제로 남습니다.', 'Every change is kept in the *변경 이력* (History) tab with who and when.'),
      ] },
    ],
  },

  /* ── 6. 과거 엑셀 ──────────────────────────────────────────────── */
  {
    id: 'past',
    views: ALL,
    title: t('과거 엑셀 자료', 'Past Excel data'),
    blocks: [
      { p: t('시스템에는 *9월 2일까지의 일보*가 들어 있습니다. 그 뒤부터 시험 시작 전날까지는 *지난번처럼 엑셀 일보 파일을 보내 주시면 한꺼번에 등록*합니다. 손으로 다시 넣으실 필요는 없습니다.',
             'The system has reports *up to 2 September*. For the days after that until the test starts, *send the Excel report files as before and we load them all at once*. You do not need to type them in again.') },
      { ul: [
        t('보내실 것: 돈사별 *일보 엑셀 파일* (날짜가 빠짐없이). 폴더째 압축해 주셔도 됩니다.',
          'What to send: the *daily report Excel files* for each house (no missing dates). A zipped folder is fine.'),
        t('등록 전에는 *전일두수가 9월 2일 기준*으로 나와 엑셀과 다릅니다. *오류가 아닙니다.* 등록하면 이어집니다.',
          'Until they are loaded, the *opening count comes from 2 September* and will not match Excel. *This is not an error.* It connects once loaded.'),
        t('*비육사(암)*과 *계류장*은 들어 있는 과거 일보가 없어 전일두수가 *0* 으로 나옵니다. 이 두 돈사는 엑셀 파일이 특히 필요합니다.',
          '*비육사(암)* and *계류장* have no past reports yet, so their opening count shows *0*. We especially need the Excel files for these two.'),
        t('정식 가동 때도 같은 방식입니다 — 가동 전날까지의 엑셀을 받아 등록하고, 그 다음 날부터 이 화면으로 씁니다.',
          'Go-live works the same way — we load Excel up to the day before, and from the next day you use this screen.'),
      ] },
    ],
  },

  /* ── 7. 알려 주실 곳 ───────────────────────────────────────────── */
  {
    id: 'report',
    views: ALL,
    title: t('불편한 점·오류·요청은 어디로', 'Where to send problems and requests'),
    blocks: [
      { p: t('*무엇이든 좋습니다.* 오류, 불편한 점, 모르는 낱말, 「이렇게 바뀌면 좋겠다」까지 전부 알려 주십시오. 사소해 보여도 현장에서 매일 쓰는 화면이라 작은 것이 큽니다.',
             '*Anything is welcome.* Errors, awkward spots, words you do not understand, "it would be better if…" — tell us all of it. Small things matter on a screen used every day.') },
      { contact: true },
      { h3: t('보내실 때 함께 적어 주시면 빨리 고칩니다', 'Include these and we fix it faster') },
      { ol: [
        t('*돈사와 날짜* (예: 분만1동, 9월 29일)', '*House and date* (e.g. 분만1동, 29 Sept)'),
        t('*무엇을 하다가* (예: 1-3 포유자돈 줄에 전출을 넣었더니)', '*What you were doing* (e.g. entered "out" in row 1-3 포유자돈)'),
        t('*어떻게 됐는지* — 기대한 것과 실제로 나온 것', '*What happened* — what you expected and what you got'),
        t('*화면 캡처* — 키보드 *Windows + Shift + S* 로 찍어 붙여 넣으면 됩니다', '*A screenshot* — press *Windows + Shift + S* and paste it'),
      ] },
      { p: t('화면이 멈추거나 오류가 나면 *개발자에게 자동으로 기록*됩니다. 다만 *무엇을 하던 중이었는지*는 알려 주셔야 원인을 찾을 수 있습니다.',
             'If the screen freezes or shows an error, *it is recorded for the developer automatically*. But we still need to know *what you were doing* to find the cause.') },
    ],
  },
];
