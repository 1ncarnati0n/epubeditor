import { persistSync } from '$lib/server/store';

// 자동 저장은 500ms debounce다. 정상 종료(SIGTERM/SIGINT)에서는 대기 중인 타이머가
// 이벤트 루프를 붙잡고 있다가 알아서 저장되지만, vite dev처럼 process.exit()로
// 끊으면 그 타이머는 실행되지 않는다 — 'exit'는 그때도 불리고 동기 작업이 허용된다.
// (SIGKILL은 어떤 훅도 못 도니 debounce 창만큼은 어쩔 수 없다.)
process.on('exit', persistSync);
process.on('sveltekit:shutdown', persistSync);
