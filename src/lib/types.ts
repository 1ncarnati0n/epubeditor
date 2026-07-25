export type BlockStatus = 'untranslated' | 'machine' | 'reviewed';

export interface Block {
	/** "s{spineIndex}:b{blockIndex}" — stable because the source epub is immutable and extraction is deterministic */
	id: string;
	tag: string;
	/** original innerHTML (inline tags preserved) */
	sourceHtml: string;
	targetHtml: string | null;
	status: BlockStatus;
	updatedAt: number;
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
}

export interface Project {
	version: 1;
	bookId: string; // sha256(source.epub) first 12 hex chars
	title: string;
	language: string;
	creator: string | null;
	typography: Typography;
	chapters: Chapter[];
}

export function defaultTypography(): Typography {
	return {
		bodyFont: null,
		fontSizePercent: 100,
		lineHeight: 1.7,
		paraSpacingEm: 0.5,
		textIndentEm: 0,
		marginPercent: 5
	};
}

export interface ChapterSummary {
	id: string;
	href: string;
	title: string | null;
	total: number;
	untranslated: number;
	machine: number;
	reviewed: number;
}

export function chapterSummary(c: Chapter): ChapterSummary {
	const counts = { untranslated: 0, machine: 0, reviewed: 0 };
	for (const b of c.blocks) counts[b.status]++;
	return { id: c.id, href: c.href, title: c.title, total: c.blocks.length, ...counts };
}

export interface ProjectSummary {
	bookId: string;
	title: string;
	language: string;
	creator: string | null;
	typography: Typography;
	chapters: ChapterSummary[];
}

export function projectSummary(p: Project): ProjectSummary {
	return {
		bookId: p.bookId,
		title: p.title,
		language: p.language,
		creator: p.creator,
		typography: p.typography,
		chapters: p.chapters.map(chapterSummary)
	};
}
