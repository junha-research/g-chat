import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import OpenAI from "https://esm.sh/openai@4"

// 카카오톡 simpleText는 마크다운을 렌더링하지 않으므로 서식 기호를 제거한다.
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")            // # 제목
    .replace(/\*\*(.+?)\*\*/g, "$1")        // **굵게**
    .replace(/__(.+?)__/g, "$1")            // __굵게__
    .replace(/\*(.+?)\*/g, "$1")            // *기울임*
    .replace(/_(.+?)_/g, "$1")              // _기울임_
    .replace(/`([^`]+)`/g, "$1")            // `코드`
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```[a-z]*\n?/gi, "")) // ```코드블록```
    .replace(/^\s*[-*+]\s+/gm, "• ")        // - 목록 → •
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)") // [텍스트](링크)
    .replace(/^\s*>\s+/gm, "")              // > 인용
    .trim();
}

serve(async (req) => {
  // 1. 카카오톡에서 보낸 데이터 파싱
  //    본문이 비어 있는 요청(헬스체크·크롤러·GET 등)은 여기서 걸러낸다.
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ version: "2.0" }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
  const userMessage = payload.userRequest?.utterance; // 유저가 친 채팅
  const callbackUrl = payload.userRequest?.callbackUrl; // 카카오톡 콜백 주소
  const userId = payload.userRequest?.user?.id ?? 'anonymous'; // 대화 맥락 구분용 사용자 ID

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
        match_threshold: 0.3, // text-embedding-3-small 한국어는 0.3~0.55 범위
        match_count: 5,
      });

      const contextText = documents?.map((d: any) => d.content).join('\n\n') || "관련 문서가 없습니다.";

      // [B-2] 이 사용자의 최근 대화 기록 불러오기 (맥락 유지)
      const { data: historyRows } = await supabase
        .from('conversations')
        .select('role, content')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(6); // 최근 6턴
      // 최신순으로 받아왔으므로 시간순으로 뒤집는다
      const history = (historyRows ?? [])
        .reverse()
        .map((h: any) => ({ role: h.role, content: h.content }));

      // [C] OpenAI 답변 생성
      const completion = await openai.chat.completions.create({
        model: 'gpt-4.1-nano',
        messages: [
          {
            role: 'system',
            content: `당신은 동해시시설관리공단 안내 챗봇입니다. 아래 문맥을 바탕으로 정확하게 답변하세요.
문맥에 없는 내용은 지어내지 말고, 모르면 담당 기관 문의를 안내하세요.
반드시 한국어로 답변하세요. 단, 사용자가 명시적으로 번역이나 다른 언어를 요청하면 그 요청을 따르세요.
이전 대화 맥락을 고려해 자연스럽게 이어서 답변하세요.

[답변 형식 규칙 - 카카오톡 메시지]
- 마크다운(**, #, - 등) 서식은 절대 쓰지 마세요. 카카오톡에서 깨져 보입니다.
- 대신 줄바꿈과 이모지로 가독성을 높이세요.
- 정보가 여러 항목이면 항목마다 줄을 바꾸고, 앞에 어울리는 이모지 하나를 라벨로 붙이세요.
  예) 📅 기간 / 📍 장소 / 💰 비용 / 📄 서류 / 📞 문의 / ⏰ 시간 / ℹ️ 참고
- 이모지는 항목 라벨 용도로만 절제해서 사용하세요. 공공기관이므로 남발하지 마세요.
- 첫 줄에 핵심을 한 문장으로 요약하고, 그 아래에 세부 항목을 나열하세요.

[문맥]
${contextText}`,
          },
          ...history,
          { role: 'user', content: userMessage }
        ],
      });
      const answer = stripMarkdown(completion.choices[0].message.content ?? "");

      // [C-2] 이번 대화(질문 + 답변)를 기록에 저장
      await supabase.from('conversations').insert([
        { user_id: userId, role: 'user', content: userMessage },
        { user_id: userId, role: 'assistant', content: answer },
      ]);

      // [D] 카카오톡 콜백 URL로 최종 답변 전송
      if (callbackUrl) {
        const cbRes = await fetch(callbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            version: "2.0",
            template: {
              outputs: [{ simpleText: { text: answer } }]
            }
          })
        });
        console.log("콜백 전송 결과:", cbRes.status, await cbRes.text());
      }

    } catch (error) {
      console.error("백그라운드 에러:", error);
    }
  };

  // 3. 백그라운드 함수 실행
  //    ⚠️ Edge Function은 Response 반환 시 백그라운드 작업을 종료시키므로
  //    EdgeRuntime.waitUntil()로 응답 이후에도 작업이 끝날 때까지 유지시킨다.
  if (userMessage && callbackUrl) {
    // @ts-ignore: Supabase Edge Runtime 전역
    EdgeRuntime.waitUntil(processRagAndRespond());
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