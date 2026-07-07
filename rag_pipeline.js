import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

// 초기화
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * 1. 질문을 벡터로 변환하는 함수
 */
async function getEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

/**
 * 2. Supabase에서 유사한 문서(컨텍스트)를 찾아오는 함수
 */
async function retrieveContext(queryText) {
  const queryEmbedding = await getEmbedding(queryText);

  // Supabase에 생성해 둔 match_documents 함수 호출
  const { data: documents, error } = await supabase.rpc("match_documents", {
    query_embedding: queryEmbedding,
    match_threshold: 0.6, // 유사도 매칭 기준 (필요에 따라 조절)
    match_count: 3, // 상위 몇 개의 문서를 가져올지 설정
  });

  if (error) {
    console.error("Supabase Retrieval Error:", error);
    throw error;
  }

  return documents;
}

/**
 * 3. 최종 RAG 답변 생성 파이프라인
 */
async function runRagPipeline(userQuestion) {
  try {
    // 컨텍스트 조회
    const retrievedDocs = await retrieveContext(userQuestion);

    // 가져온 문서들을 하나의 컨텍스트 문자열로 병합
    const contextText = retrievedDocs
      .map((doc) => `- 문맥: ${doc.content}`)
      .join("\n\n");

    // 프롬프트 구성
    const systemPrompt = `당신은 제공된 문맥(Context)만을 바탕으로 정직하게 답변하는 어시스턴트입니다. 
주어진 문맥에서 답을 찾을 수 없다면 확실하지 않다고 명시하세요. 절대 거짓말을 지어내지 마세요.

[Context]
${contextText}`;

    // LLM 호출
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // 데모용 가성비 모델 추천
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userQuestion },
      ],
      temperature: 0.2, // 일관된 답변을 위해 낮게 설정
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error("RAG Pipeline Error:", error);
    return "답변을 생성하는 중에 오류가 발생했습니다.";
  }
}
export { runRagPipeline };

// 실행 예시
const question = "수파베이스와 오픈AI를 연동할 때 주의할 점이 뭐야?";
runRagPipeline(question).then((answer) => {
  console.log("\n=== 대답 ===\n", answer);
});
