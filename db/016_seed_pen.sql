-- =====================================================================
-- 016 돈방 · 돈사별 집계행 — M1 마스터 정비
--
-- 현행 일보 5종의 「구분」 열을 직접 판독해 생성했다. 손으로 쓴 값이 아니다.
--   원천 : 자돈사,육성사.xlsx / 분만사일보.xlsx / 검정사일보.xlsx
--          비육사일보.xlsx / 종부사일보.xlsx  (2026-08~09 운영본)
--   생성 : db/tools/gen_016_seed_pen.py
-- =====================================================================
SET search_path = app, sec, extensions, public;

-- ── 돈방 ─────────────────────────────────────────────────────────────
INSERT INTO pen (farm_id, house_id, code, seq, active_from)
SELECT h.farm_id, h.id, v.code, v.seq, DATE '2026-08-06'
  FROM house h
  JOIN (VALUES
    ('BUNMAN1','1-1',10),
    ('BUNMAN1','1-2',20),
    ('BUNMAN1','1-3',30),
    ('BUNMAN1','1-4',40),
    ('BUNMAN1','1-5',50),
    ('BUNMAN1','1-6',60),
    ('BUNMAN1','1-7',70),
    ('BUNMAN1','1-8',80),
    ('BUNMAN1','1-9',90),
    ('BUNMAN1','1-10',100),
    ('BUNMAN1','1-11',110),
    ('BUNMAN2','2-1',10),
    ('BUNMAN2','2-2',20),
    ('BUNMAN2','2-3',30),
    ('BUNMAN2','2-4',40),
    ('BUNMAN2','2-5',50),
    ('BUNMAN2','2-6',60),
    ('BUNMAN2','2-7',70),
    ('BUNMAN2','2-8',80),
    ('BUNMAN2','2-9',90),
    ('BUNMAN2','2-10',100),
    ('BUNMAN2','2-11',110),
    ('JADON','1-1',10),
    ('JADON','1-2',20),
    ('JADON','1-3',30),
    ('JADON','1-4',40),
    ('JADON','1-5',50),
    ('JADON','1-6',60),
    ('JADON','1-7',70),
    ('JADON','1-8',80),
    ('JADON','1-9',90),
    ('JADON','1-10',100),
    ('JADON','1-11',110),
    ('JADON','1-12',120),
    ('JADON','1-13',130),
    ('JADON','1-14',140),
    ('JADON','2-1',150),
    ('JADON','2-2',160),
    ('JADON','2-3',170),
    ('JADON','2-4',180),
    ('JADON','2-5',190),
    ('JADON','2-6',200),
    ('JADON','2-7',210),
    ('JADON','2-8',220),
    ('JADON','2-9',230),
    ('JADON','2-10',240),
    ('JADON','2-11',250),
    ('JADON','2-12',260),
    ('JADON','2-13',270),
    ('JADON','2-14',280),
    ('YUKSUNG','1-1',10),
    ('YUKSUNG','1-2',20),
    ('YUKSUNG','1-3',30),
    ('YUKSUNG','1-4',40),
    ('YUKSUNG','1-5',50),
    ('YUKSUNG','1-6',60),
    ('YUKSUNG','1-7',70),
    ('YUKSUNG','2-1',80),
    ('YUKSUNG','2-2',90),
    ('YUKSUNG','2-3',100),
    ('YUKSUNG','2-4',110),
    ('YUKSUNG','2-5',120),
    ('YUKSUNG','2-6',130),
    ('YUKSUNG','2-7',140),
    ('YUKSUNG','2-8',150),
    ('GEOMJUNG','1-1',10),
    ('GEOMJUNG','1-2',20),
    ('GEOMJUNG','1-3',30),
    ('GEOMJUNG','1-4',40),
    ('GEOMJUNG','1-5',50),
    ('GEOMJUNG','1-6',60),
    ('GEOMJUNG','1-7',70),
    ('GEOMJUNG','1-8',80),
    ('GEOMJUNG','2-1',90),
    ('GEOMJUNG','2-2',100),
    ('GEOMJUNG','2-3',110),
    ('GEOMJUNG','2-4',120),
    ('GEOMJUNG','2-5',130),
    ('GEOMJUNG','2-6',140),
    ('GEOMJUNG','2-7',150),
    ('GEOMJUNG','2-8',160),
    ('GEOMJUNG','3-1',170),
    ('GEOMJUNG','3-2',180),
    ('GEOMJUNG','3-3',190),
    ('GEOMJUNG','3-4',200),
    ('GEOMJUNG','3-5',210),
    ('GEOMJUNG','3-6',220),
    ('GEOMJUNG','3-7',230),
    ('GEOMJUNG','3-8',240),
    ('GEOMJUNG','4-1',250),
    ('GEOMJUNG','4-2',260),
    ('GEOMJUNG','4-3',270),
    ('GEOMJUNG','4-4',280),
    ('GEOMJUNG','4-5',290),
    ('GEOMJUNG','4-6',300),
    ('GEOMJUNG','4-7',310),
    ('GEOMJUNG','4-8',320),
    ('GEOMJUNG','5-1',330),
    ('GEOMJUNG','5-2',340),
    ('GEOMJUNG','5-3',350),
    ('GEOMJUNG','5-4',360),
    ('GEOMJUNG','5-5',370),
    ('GEOMJUNG','5-6',380),
    ('GEOMJUNG','5-7',390),
    ('GEOMJUNG','5-8',400),
    ('BIYUK_M','1-1',10),
    ('BIYUK_M','1-2',20),
    ('BIYUK_M','1-3',30),
    ('BIYUK_M','1-4',40),
    ('BIYUK_M','1-5',50),
    ('BIYUK_M','1-6',60),
    ('BIYUK_M','3-1',70),
    ('BIYUK_M','3-2',80),
    ('BIYUK_M','3-3',90),
    ('BIYUK_M','3-4',100),
    ('BIYUK_M','3-5',110),
    ('BIYUK_M','3-6',120),
    ('BIYUK_M','4-1',130),
    ('BIYUK_M','4-2',140),
    ('BIYUK_M','4-3',150),
    ('BIYUK_M','4-4',160),
    ('BIYUK_M','4-5',170),
    ('BIYUK_M','4-6',180),
    ('BIYUK_M','5-1',190),
    ('BIYUK_M','5-2',200),
    ('BIYUK_M','5-3',210),
    ('BIYUK_M','5-4',220),
    ('BIYUK_M','5-5',230),
    ('BIYUK_M','5-6',240),
    ('BIYUK_M','6-1',250),
    ('BIYUK_M','6-2',260),
    ('BIYUK_M','6-3',270),
    ('BIYUK_M','6-4',280)
  ) AS v(house_code, code, seq) ON v.house_code = h.code
 WHERE h.farm_id = (SELECT id FROM farm WHERE code = 'BUYEO');

COMMENT ON COLUMN pen.active_from IS
  '2026-08-06 — 엑셀 일보 운영 개시일. 그 이전은 전량 종이 작성이므로 적재 대상이 아니다 (§1.1)';

-- ── 돈사별 집계행 (count_basis = category / pen_category) ────────────
INSERT INTO house_category (farm_id, house_id, category_id, seq)
SELECT h.farm_id, h.id, c.id, v.seq
  FROM house h
  JOIN (VALUES
    ('SUNCHI','CAND_M',10),
    ('SUNCHI','CAND_F',20),
    ('SUNCHI','WEAN_SOW',30),
    ('SUNCHI','STAY',40),
    ('SUNCHI','PREG',50),
    ('JONGBU','BOAR',10),
    ('JONGBU','CAND_F',20),
    ('JONGBU','WEAN_PIG',30),
    ('JONGBU','STAY_S',40),
    ('JONGBU','STAY_L',50),
    ('JONGBU','PREG',60),
    ('IMSIN1','CAND_F',10),
    ('IMSIN1','STAY_S',20),
    ('IMSIN1','PREG',30),
    ('IMSIN2','CAND_F',10),
    ('IMSIN2','STAY_S',20),
    ('IMSIN2','PREG',30),
    ('BUNMAN1','FARROW_WAIT',10),
    ('BUNMAN1','LACT_SOW',20),
    ('BUNMAN1','SUCK',30),
    ('BUNMAN1','WEANED',40),
    ('BUNMAN2','FARROW_WAIT',10),
    ('BUNMAN2','LACT_SOW',20),
    ('BUNMAN2','SUCK',30),
    ('BUNMAN2','WEANED',40)
  ) AS v(house_code, cat_code, seq) ON v.house_code = h.code
  JOIN pig_category c ON c.code = v.cat_code
 WHERE h.farm_id = (SELECT id FROM farm WHERE code = 'BUYEO');

-- ── 적재 검증 ────────────────────────────────────────────────────────
DO $$
DECLARE r record; v_expect jsonb := '{"분만1동":11,"분만2동":11,"자돈사":28,"육성사":15,"검정사":40,"비육사(수)":28}'::jsonb;
BEGIN
  FOR r IN SELECT h.name, count(p.id) AS n FROM house h
             LEFT JOIN pen p ON p.house_id = h.id GROUP BY h.name LOOP
    IF jsonb_exists(v_expect, r.name) AND (v_expect ->> r.name)::int <> r.n THEN
      RAISE EXCEPTION '돈방 적재 불일치: % 기대 % / 실제 %',
        r.name, v_expect ->> r.name, r.n;
    END IF;
  END LOOP;
  RAISE NOTICE '돈방 % 개, 집계행 % 개 적재',
    (SELECT count(*) FROM pen), (SELECT count(*) FROM house_category);
END $$;

