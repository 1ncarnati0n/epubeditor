import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { RequestHandler } from './$types';
import { createMcpServer } from '$lib/server/mcp';

// stateless: 세션 관리 없음 — 요청마다 서버+트랜스포트 생성, JSON 응답
async function handle(request: Request): Promise<Response> {
	const server = createMcpServer();
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	});
	await server.connect(transport);
	return transport.handleRequest(request);
}

export const POST: RequestHandler = ({ request }) => handle(request);
export const GET: RequestHandler = ({ request }) => handle(request);
export const DELETE: RequestHandler = ({ request }) => handle(request);
