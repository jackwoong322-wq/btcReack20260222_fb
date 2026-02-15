import { createClient } from '@supabase/supabase-js'

// Vite 환경 변수 사용
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase 환경 변수가 설정되지 않았습니다.')
  console.error('VITE_SUPABASE_URL과 VITE_SUPABASE_ANON_KEY를 .env 파일에 설정하세요.')
}

export const supabase = createClient(supabaseUrl || '', supabaseKey || '')
