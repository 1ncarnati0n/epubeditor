import { unzipSync, strFromU8 } from 'fflate';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Block, Chapter, Project } from '$lib/types';
import {
	defaultCodexSettings,
	defaultSession,
	defaultTranslationGuide,
	defaultTypography
} from '$lib/types';
import { findBlockElements } from './blocks';
import { innerXml, loadXml } from '$lib/server/xml';

export interface ParsedEpub {
	project: Project;
	entries: Record<string, Uint8Array>;
	opfPath: string;
}

/**
 * 번역이 어느 원문의 것인지 기록하는 지문. 우발적 변경 감지가 목적이라 8자(32bit)면 충분하다
 * (위조 방지용이 아니다 — 로컬 단일 사용자 도구).
 */
export function sourceHash(sourceHtml: string): string {
	return createHash('sha256').update(sourceHtml).digest('hex').slice(0, 8);
}

export function epubSha256(data: Uint8Array): string {
	return createHash('sha256').update(data).digest('hex');
}

function readText(entries: Record<string, Uint8Array>, name: string): string {
	const bytes = entries[name];
	if (!bytes) throw new Error(`missing ${name}`);
	return strFromU8(bytes);
}

/** resolve a (possibly url-encoded) manifest href against the OPF directory */
export function resolveHref(baseDir: string, href: string): string {
	const clean = decodeURIComponent(href.split('#')[0].split('?')[0]);
	return path.posix.normalize(path.posix.join(baseDir, clean));
}

export function findOpfPath(entries: Record<string, Uint8Array>): string {
	const $c = loadXml(readText(entries, 'META-INF/container.xml'));
	const opfPath = $c('rootfile').first().attr('full-path');
	if (!opfPath) throw new Error('missing rootfile in container.xml');
	return opfPath;
}

export function parseEpub(data: Uint8Array): ParsedEpub {
	const entries = unzipSync(data);
	const opfPath = findOpfPath(entries);
	const opfDir = path.posix.dirname(opfPath);
	const $opf = loadXml(readText(entries, opfPath));

	const title = $opf('dc\\:title').first().text().trim() || 'Untitled';
	const language = $opf('dc\\:language').first().text().trim() || 'en';
	const creator = $opf('dc\\:creator').first().text().trim() || null;

	const manifest = new Map<string, string>();
	$opf('manifest item').each((_, el) => {
		if (el.attribs['id'] && el.attribs['href']) manifest.set(el.attribs['id'], el.attribs['href']);
	});

	const chapters: Chapter[] = [];
	$opf('spine itemref').each((i, el) => {
		const href = manifest.get(el.attribs['idref'] ?? '');
		if (!href) return;
		const docPath = resolveHref(opfDir, href);
		const bytes = entries[docPath];
		if (!bytes) return;
		const $doc = loadXml(strFromU8(bytes));
		const blocks: Block[] = [];
		findBlockElements($doc).each((j, blockEl) => {
			blocks.push({
				id: `s${i}:b${j}`,
				tag: blockEl.tagName?.toLowerCase() ?? 'p',
				sourceHtml: innerXml($doc(blockEl)),
				targetHtml: null,
				status: 'untranslated',
				updatedAt: 0,
				srcHash: null,
				stale: false
			});
		});
		chapters.push({
			id: `s${i}`,
			href: docPath,
			title: $doc('h1,h2,h3').first().text().trim() || null,
			blocks
		});
	});
	if (chapters.length === 0) throw new Error('no spine documents found');

	const bookId = epubSha256(data).slice(0, 12);
	return {
		project: {
			version: 1,
			bookId,
			title,
			language,
			creator,
			translationGuide: defaultTranslationGuide(),
			typography: defaultTypography(),
			codex: defaultCodexSettings(),
			session: defaultSession(),
			chapters
		},
		entries,
		opfPath
	};
}
