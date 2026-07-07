# g-chat (Supabase & OpenAI RAG Pipeline)

Node.js 환경에서 **Supabase**와 **OpenAI**를 연동하여 구현한 RAG(Retrieval-Augmented Generation, 검색 증강 생성) 파이프라인 프로젝트입니다. 
데이터베이스에 저장된 관련 문서를 찾아와 LLM(gpt-4o-mini)에 컨텍스트로 제공함으로써, 정확하고 신뢰성 높은 답변을 생성합니다.

---

## 📁 주요 파일 및 디렉토리 구성

* **[rag_pipeline.js](file:///C:/Users/nlp/Documents/g-chat/rag_pipeline.js)**: 
  * 사용자 질문의 임베딩을 생성하고 Supabase에서 유사도가 높은 관련 문서를 검색합니다.
  * 검색된 컨텍스트를 기반으로 OpenAI GPT 모델을 통해 답변을 생성하는 RAG의 핵심 파이프라인 소스코드입니다.
* **[test_connect.js](file:///C:/Users/nlp/Documents/g-chat/test_connect.js)**: 
  * Supabase 데이터베이스와의 연결을 확인하고 `documents` 테이블에 더미 데이터 및 1536차원의 임베딩 데이터를 성공적으로 삽입하는지 테스트하는 스크립트입니다.
* **[package.json](file:///C:/Users/nlp/Documents/g-chat/package.json)**:
  * 프로젝트의 메타데이터 정보와 필요한 패키지(`@supabase/supabase-js`, `dotenv`, `openai`)의 의존성이 설정되어 있습니다.
  * ESM(ES Modules) 사용을 위해 `"type": "module"`로 설정되어 있습니다.
* **[.gitignore](file:///C:/Users/nlp/Documents/g-chat/.gitignore)**:
  * 깃(Git) 버전 관리에서 제외할 의존성 폴더(`node_modules`), 에디터 설정(`.vscode`), 비밀키가 포함된 환경변수 파일(`.env`) 등을 지정합니다.

---

## ⚙️ 사전 요구사항 (Supabase)

이 프로젝트는 Supabase 데이터베이스에 다음 테이블 및 RPC 함수가 사전에 정의되어 있어야 작동합니다.

1. **`documents` 테이블**:
   * `content`: `text` (문서의 실제 내용)
   * `embedding`: `vector(1536)` (임베딩 벡터 데이터, `pgvector` 확장 활성화 필요)

2. **`match_documents` RPC 함수**:
   * 사용자 질문의 임베딩과 가장 유사한 상위 매칭 문서를 찾아 반환하는 PostgreSQL 함수입니다.

---

## 🚀 의존성 설치 및 실행 방법

### 1. 패키지 설치
프로젝트에 필요한 Node.js 의존성 라이브러리를 설치합니다.
```bash
npm install
```

### 2. 환경 변수 설정
프로젝트 루트 폴더에 `.env` 파일을 생성하고 아래의 키값들을 본인의 Supabase 및 OpenAI 정보로 채워줍니다.
```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
OPENAI_API_KEY=your_openai_api_key
```
> **주의**: `.env` 파일은 민감한 인증 정보를 포함하고 있으므로 절대로 Git 저장소에 커밋하거나 공유하지 마십시오. (`.gitignore`에 의해 자동 제외됩니다.)

### 3. 기능 실행

* **Supabase 연결 확인 및 테스트 데이터 삽입**:
  ```bash
  node test_connect.js
  ```

* **RAG 파이프라인 질의 테스트 실행**:
  ```bash
  node rag_pipeline.js
  ```
