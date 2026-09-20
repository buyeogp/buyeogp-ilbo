-- =====================================================================
-- 018 Storage 버킷 — 설계문서 §4.7 / §4.9.2 / §6.5
--
-- Supabase 전용이다. storage 스키마가 없는 로컬 PostgreSQL 에서는 건너뛴다.
-- 대시보드에서 만들어도 되지만 여기 두면 프로젝트를 다시 만들 때 함께 복원된다.
--
-- 셋 다 **비공개**다. 공개 버킷은 URL 만 알면 누구나 받아가므로,
-- API 가 서명 URL 로만 내주도록 막아 둔다.
-- =====================================================================
SET search_path = app, sec, extensions, public;

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage 스키마가 없습니다 — Supabase 가 아니므로 건너뜁니다';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES
    -- V10: 사진 없이 폐사 등록을 완료할 수 없다. 카톡 전송 중 누락되던 것을 막는다
    ('mortality-photo',   'mortality-photo',   false, 10485760,
     ARRAY['image/jpeg','image/png','image/webp','image/heic']),
    -- 약품 휴약기간의 원천. 최장 35일 품목이 있다 (§4.9.2)
    ('medicine-invoice',  'medicine-invoice',  false, 20971520,
     ARRAY['image/jpeg','image/png','image/webp','application/pdf']),
    -- HACCP 3년 보관 출력물 (§6.5)
    ('daily-report-pdf',  'daily-report-pdf',  false, 20971520,
     ARRAY['application/pdf'])
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Storage 버킷 3종을 확인했습니다 (전부 비공개)';
END $$;

-- 객체 접근 정책은 두지 않는다.
-- API 가 service_role 키로만 읽고 쓰며, 현장에는 서명 URL 로 내준다.
-- anon·authenticated 에게 정책을 열면 그 순간 URL 을 아는 누구나 받아갈 수 있다.
