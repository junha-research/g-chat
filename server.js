// server.js
import express from "express";
import { runRagPipeline } from "./rag_pipeline.js";

const app = express();
app.use(express.json());

// 서버 살아있는지 확인용 (브라우저로 접속 테스트)
app.get("/", (req, res) => res.send("Kakao RAG server is running"));

app.post("/kakao/webhook", async (req, res) => {
  const userQuestion = req.body.userRequest?.utterance ?? "";
  const callbackUrl = req.body.userRequest?.callbackUrl;

  // 콜백 미지원이면 동기 방식으로 처리 (5초 넘으면 실패할 수 있음)
  if (!callbackUrl) {
    const answer = await runRagPipeline(userQuestion);
    return res.json(simpleText(answer));
  }

  // 1) 즉시 "준비 중" 응답 (5초 제한 회피)
  res.json({
    version: "2.0",
    useCallback: true,
    data: { text: "학칙을 찾아보고 있어요 ⏳ 잠시만요!" },
  });

  // 2) 백그라운드에서 RAG 실행 후 콜백으로 최종 답변 전송
  (async () => {
    try {
      const answer = await runRagPipeline(userQuestion);
      await fetch(callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(simpleText(answer)),
      });
    } catch (e) {
      console.error("Callback Error:", e);
      await fetch(callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(simpleText("답변 생성 중 오류가 발생했습니다.")),
      });
    }
  })();
});

// 카카오 skillResponse 포맷 헬퍼
function simpleText(text) {
  return {
    version: "2.0",
    template: { outputs: [{ simpleText: { text } }] },
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kakao skill server on :${PORT}`));
