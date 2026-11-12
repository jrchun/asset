// Supabase 연결 정보. 둘 다 공개해도 되는 값이다(데이터 보호는 supabase/schema.sql의 RLS가 맡는다).
// 서비스 키(secret, service_role)는 절대 여기에 넣지 않는다.
export const SUPABASE_URL = '__SUPABASE_URL__';
export const SUPABASE_KEY = '__SUPABASE_PUBLISHABLE_KEY__';
