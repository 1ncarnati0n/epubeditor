// Downloads the Korean fonts (SIL OFL 1.1) used for preview + EPUB embedding.
// Run once: node scripts/fetch-fonts.mjs
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FONTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'fonts');

const FILES = {
	'Pretendard-Regular.otf':
		'https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/public/static/Pretendard-Regular.otf',
	'Pretendard-Bold.otf':
		'https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/public/static/Pretendard-Bold.otf',
	'NotoSerifKR-Regular.otf':
		'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/SubsetOTF/KR/NotoSerifKR-Regular.otf',
	'NotoSerifKR-Bold.otf':
		'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/SubsetOTF/KR/NotoSerifKR-Bold.otf'
};

await mkdir(FONTS_DIR, { recursive: true });
for (const [name, url] of Object.entries(FILES)) {
	const dest = join(FONTS_DIR, name);
	if (await access(dest).then(() => true, () => false)) {
		console.log(`skip ${name} (exists)`);
		continue;
	}
	console.log(`fetch ${name} ...`);
	const res = await fetch(url, { redirect: 'follow' });
	if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
	await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}
console.log(`done -> ${FONTS_DIR}`);
console.log('Licenses: Pretendard & Noto Serif KR are SIL Open Font License 1.1 (embedding allowed).');
