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
	format: 'opentype' | 'woff2'
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
	return `${faces}
html{font-size:${t.fontSizePercent}%;}
body{
${font ? `\tfont-family:'${font.family}',${font.generic} !important;` : ''}
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
`;
}
