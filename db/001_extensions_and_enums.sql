-- =====================================================================
-- 부여GP 돈사 일보 시스템 — 001 확장 및 열거형
-- 설계문서 v2.4 기준 / PostgreSQL 15 이상
--   · UNIQUE NULLS NOT DISTINCT (PG15+)
--   · GENERATED ALWAYS AS ... STORED (PG12+)
-- =====================================================================

-- Supabase 는 확장을 extensions 스키마에 설치한다. 로컬 PostgreSQL 에서도 같은
-- 배치가 되도록 스키마를 먼저 만들고 그쪽에 설치한 뒤 search_path 에 넣는다.
-- (이미 설치돼 있으면 IF NOT EXISTS 로 넘어가므로 양쪽에서 동일하게 동작한다)
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto   WITH SCHEMA extensions;  -- crypt, gen_salt
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;  -- 기간 배타 제약

-- ── 스키마 분리 ──────────────────────────────────────────────────────
-- app        : 업무 데이터 (admin 계정 접근 불가 — SoD-3)
-- sec        : 계정·권한·감사 (admin 계정 관리 영역)
-- extensions : 확장 (Supabase 규약)
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS sec;

SET search_path = app, sec, extensions, public;

-- ── 마스터 ───────────────────────────────────────────────────────────
-- §4.1 돈사 구분. 회신 57번 — 신설·폐쇄 없음. 고정 집합이므로 enum.
CREATE TYPE house_type AS ENUM
  ('순치사','종부사','임신사','분만사','자돈사','육성사','검정사','비육사','계류장');

CREATE TYPE sex_mix AS ENUM ('암','수','암수');

-- 일보의 두수 행을 무엇으로 쪼개는가. 현행 일보 5종 판독 결과 돈사마다 다르다.
--   pen          돈방 단위            자돈사·육성사·검정사·비육사
--   pen_category 돈방 × 축종구분      분만1동·분만2동 (분만대기/포유모돈/포유자돈/이유자돈)
--   category     돈사 × 축종구분      순치사·종부사·임신1동·임신2동 (돈방 구분 없음)
--   house        돈사 1행             계류장
CREATE TYPE count_basis AS ENUM ('pen','pen_category','category','house');

-- ── 돈군 §4.2 ────────────────────────────────────────────────────────
CREATE TYPE batch_status AS ENUM ('active','closed');

-- ── 일보 §4.11 ───────────────────────────────────────────────────────
CREATE TYPE report_status AS ENUM ('draft','submitted','confirmed','locked');

-- ── 이동 §4.3 / §4.5 ─────────────────────────────────────────────────
-- 돈사간전출 = 파트동 경계를 넘는 이동(전출)
-- 내부이동   = 파트동 안 돈방 간 이동(내부전출)
CREATE TYPE move_type AS ENUM
  ('이유전입','돈사간전출','내부이동','되돌림','출하','분양','위탁전출');

CREATE TYPE movement_status AS ENUM ('pending','matched','disputed','cancelled');

-- ── 번식 §4.6 ────────────────────────────────────────────────────────
CREATE TYPE mating_session AS ENUM ('AM','PM');          -- 종부일 접미사 A/P
CREATE TYPE mating_kind    AS ENUM ('일반','순종');      -- 대장의 'Y' = 순종교배(YY)
CREATE TYPE diagnosis_result AS ENUM ('미실시','임신','불임','의심');  -- ○ / X / △
CREATE TYPE breeding_outcome AS ENUM ('진행중','임신','재발','유산','불임','도태');
CREATE TYPE breeding_action_type AS ENUM ('재종부','도태','도태예정','기타');
CREATE TYPE farrow_type AS ENUM ('정상','조산','난산','유산');
CREATE TYPE sow_status AS ENUM ('후보','임신','포유','체류','도태예정','도태','폐사');
CREATE TYPE piglet_transfer_dir AS ENUM ('전입','전출');

-- ── 백신 §4.6.4 ──────────────────────────────────────────────────────
CREATE TYPE vaccine_target AS ENUM
  ('후보돈','임신돈','포유돈','포유자돈','자돈','육성','비육','웅돈','번식돈','전체');

CREATE TYPE vaccine_basis AS ENUM
  ('일령','이유후주차','생후주차','분만전주차','분만후주차','연간고정');

-- ── 약품 §4.9 ────────────────────────────────────────────────────────
-- 설계문서는 §4.1과 §4.9.2에서 '구분'을 서로 다른 축으로 쓴다.
-- §4.1  주사제/첨가제/…  → 제형(form)
-- §4.9.2 항생제/소염제/… → 약효분류(category, 거래명세표 인쇄값)
-- 두 축을 분리해 보관한다.
CREATE TYPE medicine_category AS ENUM
  ('항생제','소염제','해열제','호르몬제','백신','보조','대사촉진','외품','소독','기타');

CREATE TYPE medicine_form AS ENUM
  ('주사제','첨가제','수용산','경구제','외용제','백신','소독제','기타');

CREATE TYPE request_status AS ENUM ('요청','주문완료','입고완료');
CREATE TYPE order_kind AS ENUM ('정기','긴급');

-- ── 출하 §4.10 ───────────────────────────────────────────────────────
CREATE TYPE shipment_channel AS ENUM
  ('자돈출하','종돈출하_농협종돈개량','종돈출하_기타','탈락돈','비육위탁','모돈도태');

CREATE TYPE market_price_source AS ENUM ('manual','kape');  -- Q19 기본값 manual

-- ── 권한·통제 §4.12 / §6 ─────────────────────────────────────────────
CREATE TYPE app_role AS ENUM
  ('worker','team_lead','farm_manager','hq_staff','hq_manager','admin','auditor');

CREATE TYPE user_status AS ENUM ('active','suspended','left');

CREATE TYPE adjustment_status AS ENUM ('draft','pending','approved','rejected','applied');

-- L4 경고 / L1~L3 차단
CREATE TYPE exception_severity AS ENUM ('info','warn','block');
CREATE TYPE exception_status   AS ENUM ('open','acknowledged','resolved','waived');

CREATE TYPE audit_action AS ENUM
  ('INSERT','UPDATE','DELETE','LOGIN','LOGOUT','LOGIN_FAIL',
   'EXPORT','PRINT','CONFIRM','UNCONFIRM','CLOSE','REOPEN','SIGN');
