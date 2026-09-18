-- =====================================================================
-- 015 마스터 시드 — M1 마스터 정비 (설계문서 §9)
-- 설계문서에 실제 값이 명시된 것만 넣는다. 돈방 목록·계정처럼 원천이
-- 엑셀·조직도에 있는 것은 넣지 않고 적재 절차만 표시한다.
-- =====================================================================
SET search_path = app, sec, extensions, public;

-- ── 농장 ─────────────────────────────────────────────────────────────
INSERT INTO farm (code, name, close_time)
VALUES ('BUYEO', '농업회사법인 (주) 부여지피', '18:30');

-- ── 소유주체 ─────────────────────────────────────────────────────────
INSERT INTO owner (code, name, is_consign) VALUES
  ('BUYEOGP', '부여GP',   false),
  ('JUNGANG', '중앙축산', true);

-- ── 축종구분 §4.1 ────────────────────────────────────────────────────
-- 설계문서 §4.1 목록 + 현행 일보 5종 판독으로 확인된 실사용 항목
INSERT INTO pig_category (code, name, seq) VALUES
  ('CAND_M','후보(수)',1), ('CAND_F','후보(암)',2), ('BOAR','웅돈',3),
  ('WEAN_SOW','이유모돈',4), ('WEAN_PIG','이유돈',5),
  ('STAY','체류돈',6), ('STAY_S','단기체류',7), ('STAY_L','장기체류',8),
  ('PREG','임신돈',9),
  ('FARROW_WAIT','분만대기돈',10), ('LACT_SOW','포유모돈',11),
  ('SUCK','포유자돈',12), ('WEANED','이유자돈',13), ('PIGLET','자돈',14),
  ('GROW_M','육성(수)',15), ('GROW_F','육성(암)',16), ('TEST_F','검정(암)',17),
  ('FIN_M','비육(수)',18), ('FIN_F','비육(암)',19);
COMMENT ON TABLE pig_category IS
  '축종구분. 설계문서 §4.1 목록에 현행 일보에서만 확인되는 항목을 더했다 —
   이유돈(종부사), 단기체류/장기체류(종부사·임신동. §11.3 종부 미실시 1주 이내/초과),
   분만대기돈·이유자돈(분만사 두수 열)';

-- ── 폐사·도태 사유코드 §4.7 (신규 제정) ──────────────────────────────
INSERT INTO reason_code (code, name, scope, needs_note, seq) VALUES
  ('01','위축',   'both',      false, 1),
  ('02','표피염', 'both',      false, 2),
  ('03','압사',   'mortality', false, 3),
  ('04','아사',   'mortality', false, 4),
  ('05','도태',   'culling',   false, 5),
  ('06','기타',   'both',      true,  6);   -- 현장 요청. 선택 시 사유 텍스트 필수

-- ── 돈사 §1.3 ────────────────────────────────────────────────────────
-- seq = 돼지 이동 순서. 검정사와 비육사는 현행과 순서를 교체한다 (회신 44번)
-- count_basis 는 현행 일보 5종을 판독해 정한 것이다 (README 「일보 판독 결과」 참조)
INSERT INTO house (farm_id, code, name, type, count_basis, seq)
SELECT f.id, v.code, v.name, v.type::house_type, v.basis::count_basis, v.seq
  FROM farm f, (VALUES
    ('SUNCHI',  '순치사',     '순치사', 'category',     10),
    ('JONGBU',  '종부사',     '종부사', 'category',     20),
    ('IMSIN1',  '임신1동',    '임신사', 'category',     30),
    ('IMSIN2',  '임신2동',    '임신사', 'category',     40),
    ('BUNMAN1', '분만1동',    '분만사', 'pen_category', 50),
    ('BUNMAN2', '분만2동',    '분만사', 'pen_category', 60),
    ('JADON',   '자돈사',     '자돈사', 'pen',          70),
    ('YUKSUNG', '육성사',     '육성사', 'pen',          80),
    ('GEOMJUNG','검정사',     '검정사', 'pen',          90),
    ('BIYUK_F', '비육사(암)', '비육사', 'pen',         100),
    ('BIYUK_M', '비육사(수)', '비육사', 'pen',         110),
    ('GYERYU',  '계류장',     '계류장', 'house',       120)
  ) AS v(code, name, type, basis, seq)
 WHERE f.code = 'BUYEO';

-- 돈방·돈사별 집계행은 016_seed_pen.sql 에서 적재한다.
-- 원천은 현행 일보 5종의 「구분」 열이며 실제로 판독해 넣었다.

-- ── 요일 고정 이동 스케줄 §4.4 (회신 65번) ───────────────────────────
INSERT INTO movement_schedule (farm_id, weekday, from_house_id, to_house_id, move_type, label, is_movement)
SELECT f.id, v.wd, hf.id, ht.id, v.mt::move_type, v.label, v.is_mv
  FROM farm f
  CROSS JOIN (VALUES
    (0, 'SUNCHI',  'JONGBU',  '돈사간전출', '일: 순치사 → 종부사',            true),
    (0, 'JONGBU',  'IMSIN1',  '돈사간전출', '일: 종부사 → 임신사',            true),
    (1, 'JADON',   'YUKSUNG', '돈사간전출', '월: 자돈사 → 육성사',            true),
    (2, 'YUKSUNG', 'BIYUK_M', '돈사간전출', '화: 육성사 → 비육사',            true),
    (2, 'YUKSUNG', 'GEOMJUNG','돈사간전출', '화: 육성사 → 검정사',            true),
    (3, NULL,      NULL,      '내부이동',   '수: 이유 두수 파악',             false),
    (4, 'BUNMAN1', 'SUNCHI',  '되돌림',     '목: 분만사(이유모돈) → 순치사',  true),
    (4, 'BUNMAN1', 'JADON',   '이유전입',   '목: 분만사(포유자돈) → 자돈사',  true)
  ) AS v(wd, from_code, to_code, mt, label, is_mv)
  LEFT JOIN house hf ON hf.farm_id = f.id AND hf.code = v.from_code
  LEFT JOIN house ht ON ht.farm_id = f.id AND ht.code = v.to_code
 WHERE f.code = 'BUYEO';

-- ── 업체 §4.9.1 ──────────────────────────────────────────────────────
INSERT INTO supplier (name, biz_no, kind) VALUES
  ('(주)AG동물약품', '710-87-00281', '약품'),
  ('축협',            NULL,           '약품');   -- 구제역 백신 전용 (국가 관리)

-- ── 약품 마스터 ─────────────────────────────────────────────────────
-- 017_seed_medicine_feed.sql 로 옮겼다. 거래명세표 20품목만으로는 부족하고
-- 재고관리(약품).xlsx 에 153품목의 전체 목록이 있기 때문이다.

-- ── 백신 마스터 §4.6.4 (2025년판 프로그램) ───────────────────────────
INSERT INTO vaccine (name, disease, is_national) VALUES
  ('덱토맥스',        '구충',        false),
  ('에리셍 파보',     '단독·파보',   false),
  ('써코플렉스',      '써코',        false),
  ('콜레라',          '돼지열병',    false),
  ('수이셍',          '유행성폐렴',  false),
  ('리니셍',          '위축성비염',  false),
  ('구제역',          '구제역',      true),
  ('수이셍+DA+로타',  '복합',        false),
  ('파보',            '파보',        false),
  ('히프라 비퓨어',   '부종병',      false),
  ('회장염',          '회장염',      false),
  ('흉막',            '흉막폐렴',    false),
  ('일본뇌염',        '일본뇌염',    false),
  ('대장균+TGE+로타', '복합',        false);

-- 표준 접종 계획
INSERT INTO vaccine_schedule (target, basis, offset_value, vaccine_id, is_optional, note)
SELECT v.target::vaccine_target, v.basis::vaccine_basis, v.off, vc.id, v.opt, v.note
  FROM (VALUES
    -- 후보돈 : 입식 선발 150~160일령 기준, 일령으로 관리
    ('후보돈','일령',151,'덱토맥스',    false,'입식 1~2일차 구충'),
    ('후보돈','일령',164,'에리셍 파보', false,'1차'),
    ('후보돈','일령',171,'써코플렉스',  false,NULL),
    ('후보돈','일령',178,'에리셍 파보', false,'2차'),
    ('후보돈','일령',185,'콜레라',      false,NULL),
    ('후보돈','일령',192,'수이셍',      false,NULL),
    ('후보돈','일령',199,'리니셍',      true, '필요시'),
    ('후보돈','일령',206,'구제역',      false,NULL),
    -- 임신돈 : 분만 전 주차 (음수)
    ('임신돈','분만전주차',-6,'수이셍+DA+로타', false,NULL),
    ('임신돈','분만전주차',-5,'구제역',         false,NULL),
    ('임신돈','분만전주차',-4,'리니셍',         true, '필요시'),
    ('임신돈','분만전주차',-3,'수이셍+DA+로타', false,NULL),
    -- 포유돈 : 분만 후 주차
    ('포유돈','분만후주차',2,'파보',    false,NULL),
    ('포유돈','분만후주차',3,'콜레라',  false,NULL),
    -- 포유자돈 : 주령
    ('포유자돈','생후주차',2,'히프라 비퓨어', false,'부종병'),
    ('포유자돈','생후주차',3,'써코플렉스',    false,NULL),
    -- 자돈사 : 이유 후 주차
    ('자돈','이유후주차',6,'회장염', false,'6~10주차 구간 — 시작점'),
    ('자돈','이유후주차',7,'흉막',   false,'1차'),
    -- 육성·비육 : 생후 주차
    ('육성','생후주차', 8,'콜레라', false,NULL),
    ('육성','생후주차', 9,'흉막',   false,'2차'),
    ('육성','생후주차',10,'구제역', false,'1차'),
    ('비육','생후주차',14,'구제역', false,'2차')
  ) AS v(target, basis, off, vname, opt, note)
  JOIN vaccine vc ON vc.name = v.vname;

-- 일괄 접종 (연 단위) — 후보돈·번식돈·웅돈 전체 2회
INSERT INTO vaccine_schedule (target, basis, offset_value, fixed_month, fixed_week, vaccine_id, note)
SELECT '번식돈'::vaccine_target, '연간고정'::vaccine_basis, 0, v.m, v.w, vc.id, v.note
  FROM (VALUES (4, 3, '일본뇌염 1차'), (5, 2, '일본뇌염 2차')) AS v(m, w, note)
  JOIN vaccine vc ON vc.name = '일본뇌염';

-- ── 사료 마스터 ─────────────────────────────────────────────────────
-- 017_seed_medicine_feed.sql 로 옮겼다. 재고관리(사료).xlsx 에서 품목 12개와
-- 10개월치 단가 이력을 실제로 뽑았다 — 015 에 있던 8품목은 추정값이었다.

-- ── 계정 §6.1 ────────────────────────────────────────────────────────
-- 조직도(26.07.20판) 기준. 1단계 발급 대상은 L2 이상 7명.
-- login_id · password_hash 는 실제 발급 시 채운다 — 임의 계정을 만들지 않는다.
--
--   L2 team_lead    배두   종부사 · 임신1동 · 임신2동 · 순치사
--   L2 team_lead    햄     분만1동 · 분만2동
--   L2 team_lead    라주   자돈사
--   L2 team_lead    펨바   육성사 · 비육사 · 검정사
--   L3 farm_manager 최임재 부장  전 돈사 (현장 총괄)
--   L3 farm_manager 신동욱 과장  육성 · 비육 · 검정
--   L5 hq_manager   본사 실장     전체
--
-- 발급 예:
--   INSERT INTO sec.app_user (login_id, name, nationality, password_hash, status)
--   VALUES ('baedu', '배두', 'NP', crypt('<초기PW>', gen_salt('bf')), 'active');
--   INSERT INTO sec.user_role (user_id, role) VALUES (<id>, 'team_lead');
--   INSERT INTO sec.user_scope (user_id, farm_id, house_id)
--   SELECT <id>, h.farm_id, h.id FROM app.house h
--    WHERE h.code IN ('JONGBU','IMSIN1','IMSIN2','SUNCHI');
--
-- 신동욱 과장이 육성/비육/검정에 한국인 관리자로 배치되어 있으므로
-- 해당 파트는 SoD-5(발신·수령 분리)를 실제로 적용할 수 있다 (§6.1).
