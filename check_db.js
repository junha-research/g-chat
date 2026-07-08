import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// RLS 우회를 위해 SERVICE_ROLE_KEY 우선 사용, 없으면 ANON_KEY 사용
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// 미리보기로 출력할 문서 개수
const PREVIEW_COUNT = 5;
// content 미리보기 최대 글자 수
const PREVIEW_LEN = 120;

/**
 * documents 테이블에 텍스트가 잘 올라갔는지 확인하는 스크립트
 */
async function checkDocuments() {
  console.log('🔍 documents 테이블 확인을 시작합니다...\n');

  try {
    // 1. 전체 행 개수 확인
    const { count, error: countError } = await supabase
      .from('documents')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('❌ 개수 조회 실패:', countError.message);
      return;
    }

    console.log(`📊 총 저장된 문서(청크) 수: ${count}개`);

    if (!count || count === 0) {
      console.log('\n⚠️  DB에 저장된 문서가 없습니다. 적재(ingest)가 정상적으로 되었는지 확인하세요.');
      return;
    }

    // 2. 최근 저장된 문서 일부 미리보기
    const { data: docs, error: dataError } = await supabase
      .from('documents')
      .select('id, content, metadata')
      .order('id', { ascending: false })
      .limit(PREVIEW_COUNT);

    if (dataError) {
      console.error('❌ 데이터 조회 실패:', dataError.message);
      return;
    }

    console.log(`\n=== 최근 ${docs.length}개 문서 미리보기 ===\n`);
    docs.forEach((doc, i) => {
      const content = doc.content || '';
      const preview =
        content.length > PREVIEW_LEN
          ? content.slice(0, PREVIEW_LEN) + '...'
          : content;

      console.log(`[${i + 1}] id: ${doc.id}`);
      console.log(`    내용: ${preview}`);
      console.log(`    글자 수: ${content.length}`);
      console.log(`    메타데이터: ${JSON.stringify(doc.metadata)}`);
      console.log('');
    });

    // 3. 임베딩(벡터)이 정상적으로 저장되었는지 확인
    const { data: sample, error: embedError } = await supabase
      .from('documents')
      .select('id, embedding')
      .limit(1)
      .single();

    if (embedError) {
      console.error('⚠️  임베딩 확인 실패:', embedError.message);
    } else if (sample && sample.embedding) {
      // embedding은 문자열 또는 배열로 반환될 수 있으므로 둘 다 처리
      const embedding =
        typeof sample.embedding === 'string'
          ? JSON.parse(sample.embedding)
          : sample.embedding;
      console.log('=== 임베딩(벡터) 확인 ===');
      console.log(`샘플 id: ${sample.id}`);
      console.log(`벡터 차원 수: ${embedding.length} (정상값: 1536)`);
      console.log(`상태: ${embedding.length === 1536 ? '✅ 정상' : '⚠️ 차원 불일치'}`);
    } else {
      console.log('⚠️  임베딩이 비어 있습니다.');
    }

    console.log('\n🎉 확인 완료!');
  } catch (err) {
    console.error('확인 중 치명적 에러 발생:', err);
  }
}

checkDocuments();
