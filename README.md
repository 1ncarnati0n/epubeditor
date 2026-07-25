# epubeditor

영어 EPUB을 블록(문단) 단위로 분해해 **Codex가 MCP로 한국어 번역**을 채워 넣고, 2단 대역 UI에서 검수·수정한 뒤, 한국어 폰트를 임베드해 번역된 EPUB으로 내보내는 로컬 에디터.

```
브라우저 (Svelte 5 UI) ──HTTP/SSE──┐
                                   ├── SvelteKit 서버 (127.0.0.1:5173)
Codex CLI ──MCP(Streamable HTTP)────┘     메모리 상태 + data/ 영속화
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
2. 상단 `Codex MCP` → `MCP 연결` 클릭 (최초 1회)
3. `번역 지침`에 문체·용어 규칙을 적고, `Codex MCP → 실행 설정`에서 모델·추론 강도·배치 크기 지정 (선택, 책마다 저장됨)
4. 현재 chapter 또는 책 전체 선택 → 번역 시작. Codex가 배치 단위로 번역하면 UI에 실시간으로 흘러들어옴 (치자색 = 초벌)
   - 한 문단만 손보고 싶으면 그 행의 거터 `▸` 버튼 — 블록 하나만 번역/재번역. 연속으로 눌러도 큐에 쌓여 차례로 처리됨
5. 오른쪽 칸에서 직접 수정(자동 검수됨) 또는 거터의 점을 눌러 검수 완료 (쪽빛 = 검수됨) — 검수된 블록은 chapter/책 번역이 덮어쓰지 못함 (블록 버튼은 명시적 의사이므로 덮어씀)
6. `조판`에서 출력 형식(번역만 / 원문 병기)·폰트·크기·행간·여백 조정 → `미리보기`로 확인
7. `내보내기` → 번역 주입 + 선택 폰트 서브셋(woff2) 임베드된 EPUB 다운로드 (epubcheck 통과)

## 검수 흐름

초벌을 검수하는 일은 수천 번 반복되므로 손이 키보드를 떠나지 않게 만들었다.

| 키 | 동작 |
|---|---|
| `↑ ↓` · `J K` | 블록 이동 (필터가 걸리면 보이는 행 사이에서만) |
| `Enter` | 번역 칸 편집 시작 · `Esc` 끝내기(저장됨) |
| `⌘ Enter` | **검수 완료 + 다음 초벌로** — 챕터가 끝나면 초벌이 남은 다음 챕터를 자동으로 연다 |
| `T` | 이 블록만 Codex로 다시 번역 |
| `⌘ F` | 책 전체에서 찾기 · `⌘ S` 지금 저장 · `?` 단축키 |

글을 치는 중에는 한 글자 단축키가 동작하지 않는다. 컬럼 머리글이 곧 필터다 — `전체 / 미번역 / 초벌 / 원문 바뀜`에 각 개수가 붙어 있고, `초벌`을 고르면 검수할 것만 남는다.

## 검색·치환

`⌘F`로 책 전체에서 찾는다(번역·원문 선택). **치환은 번역문에만** 적용되고 — 원문 보호 원칙과 같다 — `<em>`이나 `<a href>` 안쪽이 치환어와 겹쳐도 **텍스트 노드만 바꾸므로 마크업이 깨지지 않는다.** 바꾸기 전에 몇 개가 바뀔지 먼저 세어 보고, 실행하면 스냅샷이 자동으로 남는다.

## 번역 지침

`번역 지침` 패널에 문체·호칭·고유명사 표기 규칙을 적어두면 **어느 경로로 번역하든 같은 규칙이 적용된다.**

- **Codex** — 번역 요청 프롬프트에 함께 전달
- **다른 MCP 클라이언트** (Claude Code 등) — `get_blocks` 응답의 `translationGuide` 필드로 전달. 번역 직전에 매번 호출되는 자리라 지침을 고치면 **이미 연결된 세션에도 즉시** 반영된다 (서버 `instructions`와 툴 설명은 클라이언트가 캐시하므로 새 세션에만 반영)

책마다 따로 저장되고 작업파일에 함께 담긴다.

## 출력 형식

| 형식 | 결과 | 파일명 |
|---|---|---|
| 번역만 | 원문을 번역문으로 대체 | `{제목}-ko.epub` |
| 원문 병기 | 번역문 아래에 원문을 작게(0.85em·60%) 병기 | `{제목}-대역.epub` |

병기는 형제 요소가 아니라 같은 블록 안의 `<span class="epubeditor-src">`다 — `li`·`td` 같은 블록에서도 목록 번호나 표 열이 깨지지 않는다. 미리보기와 내보내기가 같은 주입 함수(`epub/blocks.ts`의 `injectTranslations`)를 쓰므로 화면에서 본 것이 그대로 나간다.

## Codex 실행 설정

| 항목 | 설명 |
|---|---|
| 모델 | `~/.codex/models_cache.json`을 읽어 목록을 만든다 — 하드코딩하지 않으므로 `codex update` 후 새 모델이 그대로 뜬다. 비워두면 Codex CLI 기본값 |
| 추론 강도 | 고른 모델이 지원하는 값만 표시 (`model_reasoning_effort`) |
| 배치 크기 | 한 번의 `codex exec`가 처리할 블록 수 (1~50) |

앱은 `codex exec --ignore-user-config`로 실행한다(사용자 config의 notify 훅·trust 설정이 딸려오지 않도록). 위 설정만 `-m` / `-c`로 명시 전달된다.

## 원문 보호

**원문은 저장하지 않는다.** `data/<bookId>/source.epub` 한 파일이 유일한 원본이고, 블록은 열 때마다 거기서 다시 파싱한다(13MB 책 기준 26ms). 지킬 사본이 없으니 손상될 사본도 없다.

- `project.json`은 **번역만** 담는다 — 원문 텍스트 0바이트. 실측 1,489KB → 350KB
- 번역마다 **그때 원문의 지문(`srcHash`)** 을 새긴다. 열 때 현재 원문과 대조해 다르면 그 블록을 `stale`로 표시하고, 하나라도 있으면 **내보내기를 차단**한다(배너에서 `그대로 확정` 또는 `번역 버리기`로 해소)
- `source.epub`이 통째로 바뀌면 `epubSha256` 불일치로 **프로젝트를 열지 않는다**
- 편집기로 나가는 원문은 표시용으로만 새니타이즈한다 — 악성 EPUB의 `<img onerror>`가 앱에서 실행되지 않는다. 내보내기·MCP는 원문 그대로(충실도)
- 왼쪽 칸은 읽기 전용. `원본 EPUB 내려받기`로 처음 올린 파일을 언제든 되찾을 수 있다

옛 형식(v1)은 처음 열 때 자동 변환되며, **그때 저장돼 있던 원문으로 지문을 계산**하므로 변환이 곧 기존 작업 전체에 대한 무결성 감사가 된다.

## 저장·되돌리기

편집·번역은 500ms debounce로 `data/<bookId>/project.json`에 원자적으로(tmp→rename) 자동 저장된다. 서버를 정상 종료(`Ctrl-C`/SIGTERM)하면 대기 중이던 저장까지 디스크에 남는다 — `SIGKILL`만은 마지막 500ms를 잃을 수 있다. 헤더의 `저장됨` 표시를 누르면 패널이 열린다.

- **지금 저장** (`⌘S`) — debounce를 기다리지 않고 즉시
- **작업파일** — 번역만 담긴 JSON 내보내기/불러오기(원문은 들어 있지 않다). 불러오기는 같은 `bookId`일 때만 받고, 스키마에 원문 필드가 없어 구조적으로 원문을 되돌려 넣을 수 없다
- **스냅샷** — 되돌릴 지점. chapter/책 번역 시작 직전, 작업파일 불러오기 직전, 되돌리기 직전에 자동으로 남고 최대 20개 보관

## MCP 연결

- **Codex**: UI의 `MCP 연결`이 `codex mcp add epub-editor --url http://localhost:5173/mcp`를 실행. Codex CLI 로그인 필요
- **Claude Code (이 레포)**: 기존 `.mcp.json`으로 자동 인식
- **Claude Code (다른 위치)**: `claude mcp add --transport http --scope user epub-editor http://localhost:5173/mcp`
- **Claude Desktop**: 커스텀 커넥터는 localhost 불가 → `claude_desktop_config.json`에 stdio 브리지 등록:
  ```json
  { "mcpServers": { "epub-editor": { "command": "npx", "args": ["mcp-remote", "http://localhost:5173/mcp"] } } }
  ```

툴 3종: `list_chapters`(진행률 겸용) · `get_blocks`(미번역 필터·페이지네이션, `blockIds`로 특정 블록 지정, 응답에 `translationGuide` 동봉) · `submit_translations`(배치 ≤50, 인라인 태그 보존 규약은 툴 설명에 내장).

## 테스트

```sh
npm run check                          # 타입 검사
node scripts/smoke.mjs sample.epub     # 서버 실행 상태에서: 업로드→MCP 번역→내보내기 검증
npm run smoke:codex                    # fake Codex로 E2E: 실행 설정·지침 전달·블록 번역·큐·작업파일·스냅샷·대역본·중지
```

## 구조 메모

- 블록 = spine 문서에서 `p, h1–h6, li, blockquote, …` 중 리프 요소. ID `s{spine}:b{block}`는 원본 불변 + 결정적 추출이라 안정
- 상태: `untranslated → machine(LLM 초벌) → reviewed(사람 검수)` — 내보내기는 초벌+검수 모두 반영
- 번역 HTML은 서버에서 인라인 태그 allowlist로 새니타이즈 (미허용 태그는 unwrap, script/style 삭제)
- EPUB 3.3의 `font/woff2` 코어 미디어 타입으로 폰트 임베드 — 구형 EPUB2 전용 리더에서는 폰트가 무시될 수 있음
