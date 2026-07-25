import type { RequestHandler } from './$types';
import { subscribe } from '$lib/server/events';

export const GET: RequestHandler = () => {
	let unsubscribe: (() => void) | undefined;
	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();
			controller.enqueue(encoder.encode(': connected\n\n'));
			unsubscribe = subscribe((chunk) => controller.enqueue(encoder.encode(chunk)));
		},
		cancel() {
			unsubscribe?.();
		}
	});
	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
