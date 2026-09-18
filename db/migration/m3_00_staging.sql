-- =====================================================================
-- M3-00 과거 데이터 스테이징 — 설계문서 §9
--
-- 현행 일보 엑셀 5종을 판독한 원문을 그대로 받는 자리다.
-- 판독값을 버리지 않고 남겨야 나중에 「왜 이 숫자가 여기 있나」를 되짚을 수 있다.
--
-- 생성: db/tools/parse_daily_reports.py → db/migration/m3_pen_daily.csv
-- =====================================================================
SET search_path = app, sec, extensions, public;

DROP TABLE IF EXISTS app.m3_daily_raw;

CREATE TABLE app.m3_daily_raw (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  house_code          text NOT NULL,
  pen_code            text NOT NULL DEFAULT '',
  category_code       text NOT NULL DEFAULT '',
  report_date         date NOT NULL,

  opening_head        int  NOT NULL DEFAULT 0,
  in_head             int  NOT NULL DEFAULT 0,
  out_head            int  NOT NULL DEFAULT 0,
  internal_out_head   int  NOT NULL DEFAULT 0,
  sold_head           int  NOT NULL DEFAULT 0,
  dead_head           int  NOT NULL DEFAULT 0,

  -- 엑셀이 수식으로 계산해 둔 당일두수. 검증용이며 pen_daily 로 넘기지 않는다
  excel_closing       int,

  -- 두수가 빠지지 않는 소유권 이전 (육성사 위탁판매). 등식에서 빼면 안 된다
  owner_transfer_head int  NOT NULL DEFAULT 0,
  -- 분만사 이유전출 — out_head 에 이미 포함돼 있고, 여기 따로 남겨 weaning 시드로 쓴다
  weaned_out_head     int  NOT NULL DEFAULT 0,

  -- 종부사 사고내역. 셋의 합이 internal_out_head 다 (축종 간 이동으로 본다)
  recurred_head       int  NOT NULL DEFAULT 0,
  aborted_head        int  NOT NULL DEFAULT 0,
  infertile_head      int  NOT NULL DEFAULT 0,

  entry_date          text NOT NULL DEFAULT '',
  birth_date_avg      text NOT NULL DEFAULT '',
  entry_weight        text NOT NULL DEFAULT '',
  sex_mix             text NOT NULL DEFAULT '',
  note                text NOT NULL DEFAULT '',

  UNIQUE (house_code, pen_code, category_code, report_date)
);

COMMENT ON TABLE app.m3_daily_raw IS
  '과거 일보 판독 원문. 적재가 끝나도 지우지 않는다 — pen_daily 의 계산값과
   엑셀 기재값이 다른 행을 나중에 다시 확인할 근거가 여기에만 있다';
COMMENT ON COLUMN app.m3_daily_raw.excel_closing IS
  '엑셀 「당일두수」. 전 행이 수식이며 사람이 계산한 값이 아니다.
   pen_daily.closing_head(생성열)와 비교해 차이를 찾는 용도';
COMMENT ON COLUMN app.m3_daily_raw.owner_transfer_head IS
  '육성사 「위탁판매(외부)」. 소유권만 중앙축산으로 넘어가고 돼지는 그대로 있어
   두수가 빠지지 않는다 (§4.10 소유권 이전: 자돈 75일령, 숫퇘지에 한함)';

CREATE INDEX ON app.m3_daily_raw (report_date, house_code);
