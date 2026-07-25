# epubeditor

영어 EPUB을 블록(문단) 단위로 분해해 **Claude가 MCP로 한국어 번역**을 채워 넣고, 2단 대역 UI에서 검수·수정한 뒤, 한국어 폰트를 임베드해 번역된 EPUB으로 내보내는 로컬 에디터.

```
브라우저 (Svelte 5 UI) ──HTTP/SSE──┐
                                   ├── SvelteKit 서버 (127.0.0.1:5173)
Claude Code ──MCP(Streamable HTTP)─┘     메모리 상태 + data/ 영속화
```

## 설치·실행

```sh
npm install
npm run fonts        # Pretendard·Noto Serif KR 다운로드 (최초 1회, OFL 라이선스)
npm run dev          # http://localhost:5173
```

프로덕션: `npm run build && npm start` (같은 포트 — `BODY_SIZE_LIMIT`/`ORIGIN` 포함).

## 사용 흐름

1. 브라우저에서 EPUB을 끌어다 놓기 → 챕터·블록으로 분해됨 (진행 상태는 `data/`에 저장, 같은 파일 재업로드 시 이어하기)
2. **이 레포에서 Claude Code 실행** → `.mcp.json`의 `epub-editor` 서버 승인 (최초 1회)
3. Claude에게: *"1장 미번역 블록 번역해줘"* — Claude가 `get_blocks` → 번역 → `submit_translations` 루프를 돌면 UI에 실시간으로 흘러들어옴 (치자색 = 초벌)
4. 오른쪽 칸에서 직접 수정(자동 검수됨) 또는 거터의 점을 눌러 검수 완료 (쪽빛 = 검수됨) — 검수된 블록은 LLM이 덮어쓰지 못함
5. `조판`에서 폰트·크기·행간·여백 조정 → `미리보기`로 확인
6. `내보내기` → 번역 주입 + 선택 폰트 서브셋(woff2) 임베드된 `*-ko.epub` 다운로드 (epubcheck 통과)

## MCP 연결

- **Claude Code (이 레포)**: `.mcp.json`으로 자동 인식 — 승인만 하면 됨
- **Claude Code (다른 위치)**: `claude mcp add --transport http --scope user epub-editor http://localhost:5173/mcp`
- **Claude Desktop**: 커스텀 커넥터는 localhost 불가 → `claude_desktop_config.json`에 stdio 브리지 등록:
  ```json
  { "mcpServers": { "epub-editor": { "command": "npx", "args": ["mcp-remote", "http://localhost:5173/mcp"] } } }
  ```

툴 3종: `list_chapters`(진행률 겸용) · `get_blocks`(미번역 필터·페이지네이션) · `submit_translations`(배치 ≤50, 인라인 태그 보존 규약은 툴 설명에 내장).

## 테스트

```sh
npm run check                          # 타입 검사
node scripts/smoke.mjs sample.epub     # 서버 실행 상태에서: 업로드→MCP 번역→내보내기 검증
```

## 구조 메모

- 블록 = spine 문서에서 `p, h1–h6, li, blockquote, …` 중 리프 요소. ID `s{spine}:b{block}`는 원본 불변 + 결정적 추출이라 안정
- 상태: `untranslated → machine(LLM 초벌) → reviewed(사람 검수)` — 내보내기는 초벌+검수 모두 반영
- 번역 HTML은 서버에서 인라인 태그 allowlist로 새니타이즈 (미허용 태그는 unwrap, script/style 삭제)
- EPUB 3.3의 `font/woff2` 코어 미디어 타입으로 폰트 임베드 — 구형 EPUB2 전용 리더에서는 폰트가 무시될 수 있음
