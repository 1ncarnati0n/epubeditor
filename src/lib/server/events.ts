import type { Block, CodexJobStatus } from '$lib/types';

export type ServerEvent =
	| { type: 'blocks'; chapterId: string; blocks: Block[] } // translations arrived/changed
	| { type: 'project' } // reload everything (new upload, settings change)
	| { type: 'codex'; status: CodexJobStatus }
	| { type: 'saved'; at: number }; // project.json hit disk

type Send = (chunk: string) => void;
const subscribers = new Set<Send>();

export function subscribe(send: Send): () => void {
	subscribers.add(send);
	return () => subscribers.delete(send);
}

export function broadcast(event: ServerEvent): void {
	const chunk = `data: ${JSON.stringify(event)}\n\n`;
	for (const send of subscribers) {
		try {
			send(chunk);
		} catch {
			subscribers.delete(send); // client went away
		}
	}
}
