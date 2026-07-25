declare module 'subset-font' {
	export default function subsetFont(
		buffer: Buffer,
		text: string,
		options: { targetFormat: 'sfnt' | 'woff' | 'woff2'; preserveNameIds?: number[] }
	): Promise<Buffer>;
}
