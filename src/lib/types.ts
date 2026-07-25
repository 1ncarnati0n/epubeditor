export type BlockStatus = 'untranslated' | 'machine' | 'reviewed';

export interface Block {
	/** "s{spineIndex}:b{blockIndex}" — positional; always re-derived from the source epub */
	id: string;
	tag: string;
	/** original innerHTML (inline tags preserved). 저장하지 않고 매번 원본에서 파싱한다 */
	sourceHtml: string;
	targetHtml: string | null;
	status: BlockStatus;
	updatedAt: number;
	/** 번역 당시 원문의 지문 — 이 번역이 어느 원문의 것인지 기록한다. 번역이 없으면 null */
	srcHash: string | null;
	/** srcHash가 지금 원문과 다르다 = 번역한 뒤 원문이 바뀌었다 (파생값, 저장 안 함) */
	stale: boolean;
}

export interface Chapter {
	id: string; // "s{spineIndex}"
	href: string; // path inside the epub zip
	title: string | null;
	blocks: Block[];
}

export type FontId = 'pretendard' | 'noto-serif-kr';

export interface Typography {
	bodyFont: FontId | null; // null = keep the book's original styles
	fontSizePercent: number;
	lineHeight: number;
	paraSpacingEm: number;
	textIndentEm: number;
	marginPercent: number;
	/** 대역본: 번역문 아래에 원문을 작게 병기 (미리보기·내보내기 공통) */
	bilingual: boolean;
}

/** how the editor invokes `codex exec` — per book */
export interface CodexSettings {
	model: string | null; // null = whatever the Codex CLI defaults to
	effort: string | null; // model_reasoning_effort; null = the model's own default
	batchSize: number; // blocks per codex exec run
}

/** 디스크에 남는 것 — 번역과 설정뿐. 원문 텍스트는 한 글자도 담기지 않는다. */
export interface StoredTranslation {
	targetHtml: string;
	status: BlockStatus;
	updatedAt: number;
	srcHash: string;
}

export type BlockFilter = 'all' | 'untranslated' | 'machine' | 'stale';

/** 책마다 덮던 자리 — 다른 책에 갔다 와도 이어서 작업하도록 */
export interface WorkSession {
	chapterId: string | null;
	cursor: string | null;
	filter: BlockFilter;
}

export interface StoredProject {
	version: 2;
	bookId: string;
	/** source.epub 전체 해시 — 파일이 통째로 바뀐 것을 잡는다 */
	epubSha256: string;
	/** 책장 목록을 만들려고 둔 표시용 사본. 진실은 언제나 source.epub이다 */
	title: string;
	creator: string | null;
	updatedAt: number;
	translationGuide: string;
	typography: Typography;
	codex: CodexSettings;
	session: WorkSession;
	translations: Record<string, StoredTranslation>;
}

/** 책장 한 줄 */
export interface BookSummary {
	bookId: string;
	title: string;
	creator: string | null;
	total: number;
	machine: number;
	reviewed: number;
	stale: number;
	updatedAt: number;
	bytes: number;
	active: boolean;
}

export function defaultSession(): WorkSession {
	return { chapterId: null, cursor: null, filter: 'all' };
}

/** 메모리에서 쓰는 모양 — 원본에서 파싱한 블록에 번역을 얹은 것 */
export interface Project {
	version: 1;
	bookId: string; // sha256(source.epub) first 12 hex chars
	title: string;
	language: string;
	creator: string | null;
	/**
	 * 번역 지침 — 문체·용어 규칙. 어느 경로로 번역하든 같은 규칙이 적용되도록
	 * Codex 프롬프트와 MCP(get_blocks 응답·서버 instructions) 양쪽에 실린다. '' = 없음
	 */
	translationGuide: string;
	typography: Typography;
	codex: CodexSettings;
	session: WorkSession;
	chapters: Chapter[];
}

export function defaultTypography(): Typography {
	return {
		bodyFont: null,
		fontSizePercent: 100,
		lineHeight: 1.7,
		paraSpacingEm: 0.5,
		textIndentEm: 0,
		marginPercent: 5,
		bilingual: false
	};
}

export function defaultCodexSettings(): CodexSettings {
	return { model: null, effort: null, batchSize: 20 };
}

/** a restore point on disk: data/<bookId>/snapshots/<id>.json */
export interface Snapshot {
	id: string;
	at: number;
	label: string;
	/** 번역 시작 전 등 자동으로 남긴 것 — 정리할 때 수동 스냅샷보다 먼저 버린다 */
	auto: boolean;
	done: number; // 번역된 block 수 (untranslated 아닌 것)
	total: number;
}

export interface ChapterSummary {
	id: string;
	href: string;
	title: string | null;
	total: number;
	untranslated: number;
	machine: number;
	reviewed: number;
	/** 번역한 뒤 원문이 바뀐 블록 수 — 0이 아니면 내보내기가 막힌다 */
	stale: number;
}

export function chapterSummary(c: Chapter): ChapterSummary {
	const counts = { untranslated: 0, machine: 0, reviewed: 0 };
	let stale = 0;
	for (const b of c.blocks) {
		counts[b.status]++;
		if (b.stale) stale++;
	}
	return { id: c.id, href: c.href, title: c.title, total: c.blocks.length, stale, ...counts };
}

export interface ProjectSummary {
	bookId: string;
	title: string;
	language: string;
	creator: string | null;
	translationGuide: string;
	typography: Typography;
	codex: CodexSettings;
	session: WorkSession;
	chapters: ChapterSummary[];
}

export type CodexCliState = 'missing' | 'logged-out' | 'ready';
export type CodexConnectionState = 'disconnected' | 'stale' | 'connected';
export type CodexTranslationScope = 'chapter' | 'book' | 'block';
export type CodexJobState =
	| 'idle'
	| 'running'
	| 'stopping'
	| 'completed'
	| 'failed'
	| 'cancelled';

export interface CodexJobStatus {
	state: CodexJobState;
	scope: CodexTranslationScope | null;
	chapterId: string | null;
	chapterTitle: string | null;
	chapterIndex: number;
	chapterCount: number;
	/** block scope: the block currently being translated (for the per-row spinner) */
	blockId: string | null;
	/** block scope: presses waiting behind the current one — ids so each row can show itself */
	queuedIds: string[];
	/** 일시 장애로 같은 batch를 다시 시도 중일 때 1..MAX, 아니면 0 */
	attempt: number;
	/** 다음 재시도까지 남은 초 (0이면 대기 중 아님) */
	retryInSec: number;
	/** 재시도를 다 쓰고 건너뛴 chapter들 — 끝난 뒤 이것만 다시 돌릴 수 있다 */
	failedChapters: { id: string; title: string | null; reason: string }[];
	translated: number;
	total: number;
	startedAt: number | null;
	message: string | null;
	error: string | null;
}

/** one entry of ~/.codex/models_cache.json, trimmed to what the picker needs */
export interface CodexModel {
	slug: string;
	label: string;
	description: string;
	defaultEffort: string | null;
	efforts: string[];
}

export interface CodexStatus {
	cli: CodexCliState;
	connection: CodexConnectionState;
	configuredUrl: string | null;
	expectedUrl: string;
	/** from the Codex model cache; empty when it isn't readable → UI falls back to free text */
	models: CodexModel[];
	/** `model = "…"` in the user's config.toml — shown as the "기본값" label */
	defaultModel: string | null;
	job: CodexJobStatus;
}

export function projectSummary(p: Project): ProjectSummary {
	return {
		bookId: p.bookId,
		title: p.title,
		language: p.language,
		creator: p.creator,
		translationGuide: p.translationGuide,
		typography: p.typography,
		codex: p.codex,
		session: p.session,
		chapters: p.chapters.map(chapterSummary)
	};
}
