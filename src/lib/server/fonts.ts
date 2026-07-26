import type { FontId, Typography } from '$lib/types';

export interface FontDef {
	id: FontId;
	label: string;
	family: string;
	generic: 'serif' | 'sans-serif';
	files: { weight: number; file: string }[]; // static/fonts/ 아래 otf 파일명
}

export const FONTS: FontDef[] = [
	{
		id: 'pretendard',
		label: 'Pretendard (고딕)',
		family: 'Pretendard',
		generic: 'sans-serif',
		files: [
			{ weight: 400, file: 'Pretendard-Regular.otf' },
			{ weight: 700, file: 'Pretendard-Bold.otf' }
		]
	},
	{
		id: 'noto-serif-kr',
		label: 'Noto Serif KR (명조)',
		family: 'Noto Serif KR',
		generic: 'serif',
		files: [
			{ weight: 400, file: 'NotoSerifKR-Regular.otf' },
			{ weight: 700, file: 'NotoSerifKR-Bold.otf' }
		]
	}
];

export function fontById(id: FontId | null): FontDef | null {
	return FONTS.find((f) => f.id === id) ?? null;
}

/**
 * 미리보기와 내보내기가 공유하는 조판 CSS.
 * urlFor: 폰트 파일명 → CSS url (미리보기 '/fonts/x.otf', EPUB '../fonts/x.woff2')
 */
export function typographyCss(
	t: Typography,
	urlFor: (file: string) => string,
	format: 'opentype' | 'woff2',
	/** 미리보기는 늘 밝은 종이 위 — 책의 다크 모드 규칙을 되받아쳐야 한다 */
	preview = false
): string {
	const font = fontById(t.bodyFont);
	const faces = font
		? font.files
				.map(
					(f) =>
						`@font-face{font-family:'${font.family}';font-weight:${f.weight};` +
						`src:url('${urlFor(f.file)}') format('${format}');font-display:swap;}`
				)
				.join('\n')
		: '';
	// 대역본: 번역문 아래에 붙는 원문 (blocks.ts의 SOURCE_CLASS와 짝)
	const bilingual = t.bilingual
		? `.epubeditor-src{
	display:block;
	margin-top:0.3em;
	font-size:${t.sourceScale}em;
	opacity:${t.sourceOpacity};
	line-height:1.45;
	text-indent:0 !important;
}
`
		: '';
	/*
	 * font-family는 body에만 걸면 안 된다. 책이 `#sbo-rt-content div{font-family:Verdana}`
	 * 같은 규칙을 갖고 있으면, 직접 매칭되는 그 규칙이 body에서 *상속된* 값을 이긴다
	 * (조상의 !important는 조상에게만 중요하다). 그래서 본문 요소에 직접 건다.
	 * 등폭 요소는 책의 의도를 존중해 제외. `:not()`은 단일 인자 연쇄 — 구형 리더까지 안전하다.
	 */
	const NOTS = ':not(code):not(pre):not(kbd):not(samp):not(tt)';
	const family = font
		? `body, body *${NOTS}{
	font-family:'${font.family}',${font.generic} !important;
}
`
		: '';
	// 색도 font-family와 같은 이유로 body에만 걸면 안 된다. 링크는 구분되게 두려고 제외.
	const TEXT = `body, body *:not(a)${NOTS}`;
	const color = t.textColor
		? `${TEXT}{
	color:${t.textColor} !important;
}
`
		: '';
	/*
	 * 수식·도형은 위 강제에서 빼야 한다. `body *${NOTS}`가 <mi>·<mo>에 직접 매칭돼
	 * UA의 수학 폰트를 덮으면 수식이 한글 명조로 그려진다.
	 *
	 * CSS에는 "조상이 math가 아닌 것" 선택자가 없으므로 **되받아친다**. 명시도가 관건이다:
	 * `body *${NOTS}`가 (0,0,6)이라 `math *`(0,0,1)이나 `body math *`(0,0,2)를 뒤에 둬도
	 * 아무 일도 안 일어난다. 같은 :not() 사슬을 붙여 (0,0,7)로 올려야 이긴다.
	 * 복합 인자 :not(math *)나 :is()는 쓰지 않는다 — 구형 리더가 선택자를 못 읽으면
	 * 규칙째 버려져 폰트가 통째로 날아간다. revert는 '값'이라 못 읽어도 그 선언만 무시된다.
	 *
	 * 색은 revert가 아니라 inherit이다. 본문 색 도구는 "글씨가 흐려서 안 보인다"를 고치려고
	 * 만든 것이라 수식만 UA 기본색으로 되돌아가면 목적이 깨진다.
	 */
	const mathSel =
		font || t.textColor
			? ['math', 'math *', 'svg', 'svg *'].map((s) => `body ${s}${NOTS}`).join(', ')
			: '';
	const mathRevert = mathSel
		? `${mathSel}{
	${font ? 'font-family:revert !important;' : ''}${t.textColor ? '\n\tcolor:inherit !important;' : ''}
}
`
		: '';
	/*
	 * 책들이 흔히 @media (prefers-color-scheme: dark)로 본문을 옅은 회색(#d6d7db 등)으로 바꾼다.
	 * 어두운 배경을 전제한 색인데 미리보기 종이는 늘 밝아서, OS가 다크면 글씨가 사라진다.
	 * `color-scheme`으로는 막을 수 없다(문서에도 iframe에도 걸어봤지만 prefers-color-scheme은 그대로다).
	 * 그래서 같은 미디어 쿼리로 되받아친다 — 미리보기 전용이다. 내보낸 EPUB은 리더가 배경까지
	 * 다크로 바꾸므로 책의 다크 규칙이 맞다.
	 */
	const previewDark = preview
		? `@media (prefers-color-scheme: dark){
	${TEXT}{ color:${t.textColor ?? '#1c1b18'} !important; }
}
`
		: '';
	/*
	 * 미리보기 창은 화면 절반이라 책이 전제한 폭보다 훨씬 좁다 — 넓은 코드블록·표가
	 * 페이지를 가로로 밀어낸다. 내보낸 EPUB에는 넣지 않는다(리더가 알아서 맞춘다).
	 * img에 height:auto를 주지 않는 이유: 인라인 수식이 style="height:1.53em"으로 높이를
	 * 정하는데 굳이 겹칠 이유가 없다. !important도 쓰지 않아 책의 의도가 이긴다.
	 */
	const previewFit = preview
		? `pre{ overflow-x:auto; max-width:100%; }
table{ display:block; overflow-x:auto; max-width:100%; }
img, svg{ max-width:100%; }
`
		: '';
	return `${faces}
${family}${color}${mathRevert}${previewDark}${previewFit}html{font-size:${t.fontSizePercent}%;}
body{
	line-height:${t.lineHeight} !important;
	padding-left:${t.marginPercent}% !important;
	padding-right:${t.marginPercent}% !important;
}
p{
	line-height:${t.lineHeight} !important;
	margin-top:${t.paraSpacingEm}em !important;
	margin-bottom:${t.paraSpacingEm}em !important;
	text-indent:${t.textIndentEm}em !important;
}
${bilingual}`;
}
