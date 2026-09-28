// observe.js 가 필요할 때만 불러오는 조각. 쓰는 함수만 이름으로 가져와야
// 번들러가 나머지(화면 녹화·피드백 창 등)를 떨어낸다.
export { init, setUser, captureException } from '@sentry/react';
