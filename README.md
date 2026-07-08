# g-chat · 동해시 시설관리공단 카카오톡 챗봇 (RAG)

**Supabase**(pgvector) + **OpenAI**로 구현한 RAG(검색 증강 생성) 챗봇입니다.
동해시시설관리공단의 공지·시설 안내 데이터를 벡터 DB에 적재하고, 사용자가 **카카오톡 채널**로 질문하면 관련 문서를 검색해 LLM(`gpt-4.1-nano`)이 답변을 생성합니다.

> `kakao` 브랜치는 카카오톡 채널 연동 버전입니다. Supabase Edge Function(`kakao-bot`)이 카카오 스킬 서버 역할을 합니다.

---

## 🧩 동작 구조

```
사용자(카카오톡 채널)
   │  질문
   ▼
카카오 i 오픈빌더 (스킬 → 콜백)
   │  POST
   ▼
Supabase Edge Function: kakao-bot
   ├─ [A] 질문 임베딩 (text-embedding-3-small)
   ├─ [B] 벡터 검색 (match_documents RPC)
   ├─ [B-2] 사용자별 최근 대화 기록 로드 (conversations)
   ├─ [C] 답변 생성 (gpt-4.1-nano) + 대화 저장
   └─ [D] 카카오 콜백 URL로 최종 답변 전송
```

- **콜백 방식**: 카카오 타임아웃(5초)을 피하려 즉시 `useCallback: true`로 응답하고, RAG 처리는 `EdgeRuntime.waitUntil()`로 백그라운드에서 끝낸 뒤 콜백 URL로 답을 보냅니다.
- **대화 맥락**: 사용자 ID(`userRequest.user.id`) 기준으로 최근 6턴을 기억해 후속 질문·번역 요청을 이해합니다.
- **가독성**: 카카오톡은 마크다운을 렌더링하지 않으므로, 서식 기호는 제거하고 줄바꿈 + 이모지 라벨로 답변합니다.

---

## 📁 주요 파일

* **[supabase/functions/kakao-bot/index.ts](file:///C:/Users/nlp/Documents/g-chat/supabase/functions/kakao-bot/index.ts)**:
  * 카카오 스킬 요청을 받아 RAG 검색 → 답변 생성 → 콜백 전송하는 Edge Function. 대화 맥락 기억, 마크다운 제거, 이모지 가독성 프롬프트 포함.
* **[ingest.js](file:///C:/Users/nlp/Documents/g-chat/ingest.js)**:
  * `documents.txt`를 **문서 단위로 파싱**(제목·URL·종류 메타데이터 보존)하여 청크로 나눈 뒤, OpenAI 임베딩으로 벡터화해 `documents` 테이블에 적재합니다. 제목을 본문 앞에 붙여 검색 정확도를 높입니다.
* **[documents.txt](file:///C:/Users/nlp/Documents/g-chat/documents.txt)**:
  * 동해시시설관리공단 공지/시설 안내 원본 데이터. `[DOC_ID]`, `[DOC_TYPE]`, `[TITLE]`, `[URL]`, `[CONTENT]` 필드를 `====` 구분선으로 나눈 형식.
* **[check_db.js](file:///C:/Users/nlp/Documents/g-chat/check_db.js)**:
  * `documents` 테이블 적재 상태(문서 수, 최근 문서 미리보기, 임베딩 차원)를 검증하는 스크립트.
* **[rag_pipeline.js](file:///C:/Users/nlp/Documents/g-chat/rag_pipeline.js)**:
  * 터미널에서 RAG 파이프라인(검색+답변)을 직접 테스트하는 스크립트. 참고한 컨텍스트를 출력합니다.
* **[.gitignore](file:///C:/Users/nlp/Documents/g-chat/.gitignore)**:
  * `node_modules`, `.vscode`, 비밀키 `.env`, 로컬 설정 `.claude/` 등을 Git에서 제외합니다.

---

## ⚙️ 사전 요구사항 (Supabase)

`pgvector` 확장이 활성화된 Supabase 프로젝트에 다음이 정의되어 있어야 합니다.

1. **`documents` 테이블**:
   * `content`: `text` (문서 내용, 제목 포함 저장)
   * `embedding`: `vector(1536)` (text-embedding-3-small 차원)
   * `metadata`: `jsonb` (제목·URL·doc_id·종류 등)

2. **`match_documents` RPC 함수**:
   * 질문 임베딩과 유사한 상위 문서를 반환하는 PostgreSQL 함수. (`match_threshold` 0.3, `match_count` 5 사용)

3. **`conversations` 테이블** (대화 맥락 기억용):
   ```sql
   create table if not exists conversations (
     id bigserial primary key,
     user_id text not null,
     role text not null,          -- 'user' | 'assistant'
     content text not null,
     created_at timestamptz default now()
   );
   create index if not exists idx_conversations_user
     on conversations (user_id, created_at desc);
   ```

---

## 🚀 설치 및 실행

### 1. 패키지 설치
```bash
npm install
```

### 2. 환경 변수 설정
루트에 `.env` 파일을 만들고 채웁니다.
```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
OPENAI_API_KEY=your_openai_api_key
```
> **주의**: `.env`는 `.gitignore`로 자동 제외됩니다. 특히 `SUPABASE_SERVICE_ROLE_KEY`는 RLS를 우회하는 강력한 권한이므로 유출에 주의하세요.

### 3. 데이터 적재 (Ingest)
`documents.txt`를 임베딩해 `documents` 테이블에 적재합니다.
```bash
node ingest.js
```
> `ingest.js`의 `RESET_TABLE = true`는 적재 전 기존 데이터를 모두 삭제합니다. 재구축이 아니라면 `false`로 두세요.

적재 결과 확인:
```bash
node check_db.js
```

### 4. 카카오봇 Edge Function 배포
```bash
# 시크릿 등록 (최초 1회)
npx supabase secrets set OPENAI_API_KEY=sk-xxxx

# 배포 — 카카오는 인증 헤더를 안 붙이므로 --no-verify-jwt 필수
npx supabase functions deploy kakao-bot --no-verify-jwt
```
배포되면 함수 URL: `https://<project-ref>.supabase.co/functions/v1/kakao-bot`

### 5. 카카오 i 오픈빌더 연결
1. [i.kakao.com](https://i.kakao.com)에서 챗봇 생성
2. **스킬** 등록 → URL에 위 함수 주소 입력
3. 블록 응답을 **"콜백 사용"**으로 설정 (필수)
4. **배포** → 카카오톡 채널 연결

---

## 🔧 로컬 질의 테스트

카카오 연동 없이 터미널에서 RAG를 확인할 수 있습니다.
```bash
node rag_pipeline.js
```
