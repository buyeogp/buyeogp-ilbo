import { Component, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.jsx';
import { initObserve, reportError } from './observe.js';
import './styles.css';

initObserve();

/** 화면 코드가 터지면 흰 화면 대신 할 일을 알려 준다. 오류는 onCaughtError 가 보낸다 */
class Crash extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="center">
        <p><b>화면에 문제가 생겼습니다.</b></p>
        <p>입력한 값은 자동 저장된 데까지 남아 있습니다. 새로고침(F5) 하십시오.</p>
        <p>같은 일이 반복되면 관리자에게 알려 주십시오.</p>
        <button type="button" onClick={() => location.reload()}>새로고침</button>
      </div>
    );
  }
}

const onError = (err, info) => reportError(err, { componentStack: info?.componentStack });

createRoot(document.getElementById('root'), {
  onCaughtError: onError,
  onUncaughtError: onError,
}).render(
  <StrictMode>
    <Crash>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Crash>
  </StrictMode>,
);
