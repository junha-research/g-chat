import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// .env 파일의 환경변수 로드
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Supabase 클라이언트 초기화
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testInsert() {
  console.log('Supabase 연결 시도 중...');
  
  // 임의의 1536차원 더미 벡터 생성 (RAG 테이블 구조에 맞추기 위함)
  const dummyEmbedding = Array(1536).fill(0.1);

  const { data, error } = await supabase
    .from('documents')
    .insert([
      { 
        content: '수파베이스와 Node.js가 성공적으로 연결되었습니다.', 
        embedding: dummyEmbedding 
      }
    ])
    .select();

  if (error) {
    console.error('연결 실패 혹은 에러 발생:', error.message);
  } else {
    console.log('🎉 연결 성공! 데이터가 데이터베이스에 저장되었습니다:', data);
  }
}

testInsert();