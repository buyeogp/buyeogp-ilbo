/**
 * 테스트 안내 — 발주처 시험 기간 전용
 *
 * 글은 src/help/testguide.js 에 있다. 그림·표·키 목록은 설명서(Help.jsx)와 같은
 * 조각을 쓴다 — 두 페이지의 모양이 갈리지 않게.
 */
import { useMemo, useState } from 'react';
import { LANGS } from '../help/content.js';
import { CONTACT, TG_SECTIONS, TG_UI, TG_VIEWS } from '../help/testguide.js';
import { Block, say } from './Help.jsx';

const HQ = ['hq_staff', 'hq_manager'];

function defaultView(roles = []) {
  if (roles.includes('admin')) return 'admin';
  if (roles.some((r) => HQ.includes(r))) return 'hq';
  if (roles.includes('team_lead')) return 'field';
  return 'all';
}

/** 연락처. 비어 있는 줄은 그리지 않는다 */
function Contact({ lang }) {
  const en = lang === 'en';
  return (
    <table className="k keys contact">
      <tbody>
        {CONTACT.kakao && (
          <tr>
            <td><b>{en ? 'KakaoTalk' : '카카오톡'}</b></td>
            <td>{CONTACT.kakao}</td>
          </tr>
        )}
        {CONTACT.email && (
          <tr>
            <td><b>{en ? 'Email' : '이메일'}</b></td>
            <td><a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function TestGuide({ me }) {
  const [view, setView] = useState(() => defaultView(me?.user?.roles));
  const [lang, setLang] = useState('ko');

  const shown = useMemo(
    () => TG_SECTIONS.filter((s) => view === 'all' || s.views.includes(view)),
    [view]);

  return (
    <div className="help">
      <div className="help-head">
        <h1>{say(TG_UI.title, lang)}</h1>
        <p>{say(TG_UI.subtitle, lang)}</p>
        <span className="spacer" />
        <div className="langpick">
          {LANGS.map((l) => (
            <button key={l.id} type="button"
                    className={lang === l.id ? 'chip sm on' : 'chip sm'}
                    onClick={() => setLang(l.id)}>{l.label}</button>
          ))}
        </div>
        <button className="btn" onClick={() => window.print()}>
          {lang === 'en' ? 'Print' : '인쇄'}
        </button>
      </div>

      <div className="help-who">
        <span>{say(TG_UI.who, lang)}</span>
        {TG_VIEWS.map((v) => (
          <button key={v.id} type="button"
                  className={view === v.id ? 'chip on' : 'chip'}
                  onClick={() => setView(v.id)}>
            {say(v.label, lang)}<i>{say(v.sub, lang)}</i>
          </button>
        ))}
      </div>

      <nav className="help-toc">
        {shown.map((s, i) => (
          <a key={s.id} href={`#t-${s.id}`}><b>{i + 1}</b>{say(s.title, lang)}</a>
        ))}
      </nav>

      {shown.map((s, i) => (
        <section key={s.id} id={`t-${s.id}`}>
          <h2><i>{i + 1}</i>{say(s.title, lang)}</h2>
          {s.blocks.map((b, j) => (b.contact
            ? <Contact key={j} lang={lang} />
            : <Block key={j} b={b} lang={lang} />))}
        </section>
      ))}
    </div>
  );
}
