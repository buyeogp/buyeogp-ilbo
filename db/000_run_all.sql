-- =====================================================================
-- 부여GP 일보 시스템 — 전체 스키마 생성
--   psql -v ON_ERROR_STOP=1 -f 000_run_all.sql
-- 요구: PostgreSQL 15 이상
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

\ir 001_extensions_and_enums.sql
\ir 002_master.sql
\ir 003_auth_audit.sql
\ir 004_batch_daily.sql
\ir 005_movement.sql
\ir 006_breeding.sql
\ir 007_health.sql
\ir 008_feed.sql
\ir 009_shipment_settlement.sql
\ir 010_control.sql
\ir 011_functions_triggers.sql
\ir 012_validation.sql
\ir 013_views.sql
\ir 014_rls.sql
\ir 015_seed_master.sql
\ir 016_seed_pen.sql
\ir 017_seed_medicine_feed.sql

COMMIT;

\echo '완료. 다음 단계: 비육사(암) 돈방 확정 (README 「남은 확인 사항」)'
