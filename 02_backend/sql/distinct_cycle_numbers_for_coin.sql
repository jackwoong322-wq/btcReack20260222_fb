-- Supabase SQL Editor에서 한 번 실행하세요.
-- /api/cycle-menu 의 사이클 목록을 DISTINCT 한 번으로 가져오기 위해 사용합니다.
-- 테이블명을 바꾼 경우(CYCLE_TABLE_NAME) 이 함수 본문의 alt_cycle_data 를 맞추거나,
-- RPC 없이 백엔드가 페이지 스캔 폴백만 씁니다.

CREATE OR REPLACE FUNCTION public.distinct_cycle_numbers_for_coin(p_coin_id text)
RETURNS TABLE (cycle_number integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT t.cycle_number::integer
  FROM public.alt_cycle_data AS t
  WHERE t.coin_id = p_coin_id
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.distinct_cycle_numbers_for_coin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.distinct_cycle_numbers_for_coin(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.distinct_cycle_numbers_for_coin(text) TO authenticated;
