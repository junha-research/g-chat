import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import fs from 'fs';
import dotenv from 'dotenv';

// .env 파일 로드
dotenv.config();

// 1. Supabase 및 OpenAI 클라이언트 초기화
// RLS(보안)를 우회하기 위해 반드시 SERVICE_ROLE_KEY를 사용해야 합니다.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY 
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * 2. 텍스트를 청크(조각)로 분할하는 함수
 * @param {string} text - 원본 텍스트
 * @param {number} chunkSize - 청크 하나당 최대 글자 수
 * @param {number} overlap - 청크 간 겹치는 글자 수 (문맥 단절 방지)
 */
function chunkText(text, chunkSize = 400, overlap = 50) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += (chunkSize - overlap);
  }
  return chunks;
}

/**
 * 3. 메인 적재 프로세스
 */
async function processAndIngest() {
  console.log('🚀 데이터 적재 파이프라인 시작...');

  try {
    // 텍스트 파일 읽기 (파일명은 상황에 맞게 변경하세요)
    const rawText = fs.readFileSync('knowledge.txt', 'utf-8');
    
    // 청크 분할
    const chunks = chunkText(rawText);
    console.log(`총 ${chunks.length}개의 청크가 생성되었습니다. 임베딩 및 저장을 시작합니다.`);

    // 각 청크를 순회하며 임베딩 및 DB 삽입
    let successCount = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i].trim();
      if (chunk.length < 10) continue; // 너무 짧은 쓰레기 데이터 스킵

      // [핵심] 임베딩 생성 (백엔드와 반드시 동일한 모델 사용!)
      const embedResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small', 
        input: chunk,
      });
      const embeddingVector = embedResponse.data[0].embedding; // 1536차원 배열

      // Supabase 저장
      const { error } = await supabase
        .from('documents')
        .insert({
          content: chunk,
          embedding: embeddingVector,
          metadata: { 
            source: 'knowledge.txt', 
            chunk_index: i,
            inserted_at: new Date().toISOString()
          }
        });

      if (error) {
        console.error(`❌ [${i+1}/${chunks.length}] 저장 실패:`, error.message);
      } else {
        console.log(`✅ [${i+1}/${chunks.length}] 저장 성공`);
        successCount++;
      }
      
      // API Rate Limit 방지를 위한 약간의 대기 (선택사항)
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`🎉 모든 작업 완료! 총 ${successCount}개의 데이터가 DB에 적재되었습니다.`);
    
  } catch (err) {
    console.error('파이프라인 실행 중 치명적 에러 발생:', err);
  }
}

// 스크립트 실행
processAndIngest();