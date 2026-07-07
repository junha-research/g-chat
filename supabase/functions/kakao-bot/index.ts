import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import OpenAI from "https://esm.sh/openai@4"

serve(async (req) => {
  // 1. 카카오톡에서 보낸 데이터 파싱
  const payload = await req.json();
  const userMessage = payload.userRequest?.utterance; // 유저가 친 채팅
  const callbackUrl = payload.userRequest?.callbackUrl; // 카카오톡 콜백 주소

  // 2. 백그라운드에서 실행될 RAG + LLM 로직 (await 없이 실행됨)
  const processRagAndRespond = async () => {
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' // RLS 우회를 위해 Service Key 사용
      );
      const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });

      // [A] 질문 임베딩
      const embedRes = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: userMessage,
      });
      const queryEmbedding = embedRes.data[0].embedding;

      // [B] Supabase 벡터 검색
      const { data: documents } = await supabase.rpc('match_documents', {
        query_embedding: queryEmbedding,
        match_threshold: 0.6,
        match_count: 3,
      });

      const contextText = documents?.map((d: any) => d.content).join('\n\n') || "관련 문서가 없습니다.";

      // [C] OpenAI 답변 생성
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `다음 문맥을 바탕으로 답변하세요:\n${contextText}` },
          { role: 'user', content: userMessage }
        ],
      });
      const answer = completion.choices[0].message.content;

      // [D] 카카오톡 콜백 URL로 최종 답변 전송
      if (callbackUrl) {
        await fetch(callbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            version: "2.0",
            template: {
              outputs: [{ simpleText: { text: answer } }]
            }
          })
        });
      }

    } catch (error) {
      console.error("백그라운드 에러:", error);
    }
  };

  // 3. 백그라운드 함수 실행 (기다리지 않음)
  if (userMessage && callbackUrl) {
    processRagAndRespond().catch(console.error);
  }

  // 4. 카카오톡 서버에 0.1초 만에 즉시 응답 (타임아웃 방어)
  return new Response(
    JSON.stringify({
      version: "2.0",
      useCallback: true // "나중에 콜백 URL로 진짜 답을 줄게" 라는 카카오 공식 플래그
    }),
    { headers: { "Content-Type": "application/json" } }
  );
})