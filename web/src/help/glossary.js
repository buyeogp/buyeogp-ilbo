/**
 * 용어 카드 — 화면에 나오는 낱말
 *
 * 화면은 한국어로 둔다 (§3.3 — 현행 일보와 같아야 하고, HACCP 출력물도
 * 한국어여야 한다). 그러면 낱말을 읽는 일이 남는다. 그 다리가 이 카드다.
 *
 * 낱말은 명사라 뜻이 하나로 떨어진다. 문장과 달리 **맞는지 확인하기 쉽다.**
 * 그래서 다국어를 여기서부터 시작한다.
 *
 * 네팔어 칸은 **일부러 비워 두었다.** 지어내면 현장에서 아무도 검증할 수 없다.
 * 인쇄해서 네팔 팀장께 드리고 손으로 채워 달라고 하는 편이 낫다 —
 * 실제 쓰는 사람의 말로 적힌다. 받은 뒤에 이 파일에 옮기면 화면에도 나온다.
 */

/** ko: 화면에 나오는 그대로 · en: 뜻 · ne: 현장에서 받아 채운다 */
const w = (ko, en, ne = '') => ({ ko, en, ne });

export const GLOSSARY = [
  {
    title: { ko: '두수', en: 'Head counts' },
    words: [
      w('전일두수', 'Opening count — head at the start of the day'),
      w('전입', 'Moved in'),
      w('전출', 'Moved out'),
      w('내부이동', 'Internal transfer — moved within the same house'),
      w('판매', 'Sold'),
      w('폐사', 'Died'),
      w('도태', 'Culled'),
      w('당일두수', 'Closing count — head at the end of the day'),
      w('보고두수', 'Counted head — the number you counted yourself'),
      w('차이', 'Difference'),
      w('사유', 'Reason'),
      w('합계', 'Total'),
    ],
  },
  {
    title: { ko: '돈사와 돈방', en: 'Houses and pens' },
    words: [
      w('돈사', 'House'),
      w('돈방', 'Pen'),
      w('축종', 'Pig category'),
      w('분만대기돈', 'Sow waiting to farrow'),
      w('포유모돈', 'Nursing sow'),
      w('포유자돈', 'Suckling piglet'),
      w('이유자돈', 'Weaned piglet'),
      w('계류장', 'Holding pen — before shipping'),
    ],
  },
  {
    title: { ko: '일보의 상태', en: 'Report states' },
    words: [
      w('일보', 'Daily report'),
      w('미시작', 'Not started'),
      w('작성 중', 'Being written'),
      w('제출됨', 'Submitted'),
      w('확정', 'Confirmed — fixed, cannot be changed'),
      w('마감', 'Closed for the month'),
      w('정정전표', 'Correction voucher — used to fix a confirmed report'),
    ],
  },
  {
    title: { ko: '단추와 화면', en: 'Buttons and screens' },
    words: [
      w('일보 시작', 'Start report'),
      w('제출', 'Submit'),
      w('확정 해제', 'Undo confirm'),
      w('저장됨', 'Saved'),
      w('전날 · 다음날', 'Previous day · Next day'),
      w('제출 현황', 'Submission status board'),
      w('계정 관리', 'Account management'),
      w('담당', 'Assignment — who looks after which house'),
      w('적용일', 'Effective date — the day a change starts'),
      w('변경 이력', 'Change log'),
      w('설명서', 'User guide'),
    ],
  },
  {
    title: { ko: '알아두면 좋은 말', en: 'Worth knowing' },
    words: [
      w('휴약기간', 'Withdrawal period — days after medicine before a pig may be shipped'),
      w('실사', 'Physical count — counting the pigs yourself'),
      w('비고', 'Note'),
      w('등급', 'Role — what a person is allowed to do'),
      w('중지', 'Suspended — the account cannot log in'),
    ],
  },
];

export const GLOSSARY_UI = {
  title: { ko: '용어 카드', en: 'Word card' },
  lead: {
    ko: '화면에 나오는 낱말입니다. 인쇄해서 컴퓨터 옆에 붙여 두십시오.',
    en: 'The words you see on screen. Print this and keep it next to the computer.',
  },
  fill: {
    ko: '네팔어 칸은 비어 있습니다. 직접 적어 주십시오 — 쓰는 사람의 말이 가장 정확합니다.',
    en: 'The Nepali column is blank on purpose. Please write it yourself — your own words are the most accurate.',
  },
  cols: {
    ko: ['화면에 나오는 말', '영어', '네팔어 (직접 적어 주십시오)'],
    en: ['On the screen', 'English', 'नेपाली (please write)'],
  },
};
