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

// ─────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────
const SOURCE_FILE = 'documents.txt';
// true면 적재 전에 documents 테이블을 비웁니다(학칙 → 동해시 공단 재구축).
const RESET_TABLE = true;

/**
 * 2. documents.txt를 문서 단위로 파싱
 * 형식:
 *   ==============================
 *   [DOC_ID] 1
 *   [DOC_TYPE] notice
 *   [TITLE] ...
 *   [URL] ...
 *   [CONTENT]
 *   ...본문...
 */
function parseDocuments(raw) {
  // 구분선으로 문서 분리
  const blocks = raw
    .split(/^={10,}\s*$/m)
    .map((b) => b.trim())
    .filter(Boolean);

  const docs = [];
  for (const block of blocks) {
    const docId = block.match(/^\[DOC_ID\]\s*(.+)$/m)?.[1]?.trim();
    const docType = block.match(/^\[DOC_TYPE\]\s*(.+)$/m)?.[1]?.trim();
    const title = block.match(/^\[TITLE\]\s*(.+)$/m)?.[1]?.trim();
    const url = block.match(/^\[URL\]\s*(.+)$/m)?.[1]?.trim();

    // [CONTENT] 이후 ~ 블록 끝까지가 본문
    const contentMatch = block.match(/^\[CONTENT\]\s*\n([\s\S]*)$/m);
    const content = contentMatch?.[1]?.trim() ?? '';

    if (!content) continue;

    docs.push({ docId, docType, title: title ?? '', url: url ?? '', content });
  }
  return docs;
}

/**
 * 3. 텍스트를 청크(조각)로 분할
 */
function chunkText(text, chunkSize = 500, overlap = 80) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize - overlap;
  }
  return chunks;
}

/**
 * 4. 메인 적재 프로세스
 */
async function processAndIngest() {
  console.log('🚀 데이터 적재 파이프라인 시작...');

  try {
    const rawText = fs.readFileSync(SOURCE_FILE, 'utf-8');
    const docs = parseDocuments(rawText);
    console.log(`📄 ${docs.length}개 문서를 파싱했습니다.`);

    // (선택) 기존 데이터 초기화
    if (RESET_TABLE) {
      console.log('🧹 기존 documents 테이블을 비웁니다...');
      // id > 0 조건으로 전체 삭제 (Supabase는 조건 없는 delete를 막음)
      const { error: delError } = await supabase
        .from('documents')
        .delete()
        .neq('id', 0);
      if (delError) {
        console.error('⚠️ 초기화 실패:', delError.message);
      } else {
        console.log('✅ 테이블 초기화 완료.');
      }
    }

    let successCount = 0;
    let totalChunks = 0;

    // 문서 순회 → 문서별로 청크 분할
    for (const doc of docs) {
      const chunks = chunkText(doc.content);

      for (let c = 0; c < chunks.length; c++) {
        const body = chunks[c].trim();
        if (body.length < 10) continue; // 너무 짧은 쓰레기 스킵
        totalChunks++;

        // [핵심] 제목을 본문 앞에 붙여 임베딩 → 제목 기반 검색 정확도 향상
        const embedInput = doc.title ? `제목: ${doc.title}\n\n${body}` : body;

        const embedResponse = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: embedInput,
        });
        const embeddingVector = embedResponse.data[0].embedding; // 1536차원

        const { error } = await supabase.from('documents').insert({
          content: embedInput, // 검색 시 제목까지 보이도록 함께 저장
          embedding: embeddingVector,
          metadata: {
            source: SOURCE_FILE,
            doc_id: doc.docId,
            doc_type: doc.docType,
            title: doc.title,
            url: doc.url,
            chunk_index: c,
            inserted_at: new Date().toISOString(),
          },
        });

        if (error) {
          console.error(`❌ [문서 ${doc.docId} · 청크 ${c}] 저장 실패:`, error.message);
        } else {
          successCount++;
          console.log(`✅ [문서 ${doc.docId} · 청크 ${c}] "${doc.title?.slice(0, 30)}"`);
        }

        // API Rate Limit 방지
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }

    console.log(
      `\n🎉 완료! 문서 ${docs.length}개 → 청크 ${totalChunks}개 중 ${successCount}개 적재 성공.`
    );
  } catch (err) {
    console.error('파이프라인 실행 중 치명적 에러 발생:', err);
  }
}

// 스크립트 실행
processAndIngest();
