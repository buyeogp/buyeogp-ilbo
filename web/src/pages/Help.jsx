/**
 * 사용 설명서 — 설계문서 §6.4 P10
 *
 * 이 파일에는 **글이 없다.** 글은 `src/help/content.js` 에 데이터로 있다.
 * 언어를 늘릴 때 화면 코드를 뜯지 않기 위해서다.
 *
 * 설계문서 C3 은 다국어를 요건에서 뺐다. 다만 그 근거(회신 15·16·18·19·21)는
 * 「한국어 **항목명**을 읽고 아라비아 숫자로 기입한다」로, **화면**에 대한
 * 확인이다. 설명서는 설계문서에 없던 것이라 그 결정이 다루지 않았다.
 * 항목명 30개를 아는 것과 조건문이 섞인 글을 읽는 것은 다른 일이므로,
 * 설명서만 언어를 갖춘다. 화면은 한국어로 둔다 (§3.3 · HACCP 출력물).
 */
import { useMemo, useState } from 'react';
import { LANGS, SECTIONS, UI, VIEWS } from '../help/content.js';
import { GLOSSARY, GLOSSARY_UI } from '../help/glossary.js';

const HQ = ['hq_staff', 'hq_manager'];

/** 없는 말은 한국어로 — 빈칸보다 낫다 */
const say = (o, lang) => (o == null ? '' : (o[lang] || o.ko || ''));

/** *별표* 안은 굵게. 문장을 데이터로 두면서 강조만 살리는 가장 싼 방법. */
function rich(s) {
  return String(s).split('*').map((part, i) => (
    i % 2 ? <b key={i}>{part}</b> : <span key={i}>{part}</span>
  ));
}

const T = ({ v, lang }) => <>{rich(say(v, lang))}</>;

function defaultView(roles = []) {
  if (roles.includes('admin')) return 'admin';
  if (roles.some((r) => HQ.includes(r))) return 'hq';
  return 'field';
}

/**
 * 화면 그림. 번호는 그림 위에 얹는다 — 구워 넣으면 글자가 뭉개지고,
 * 무엇보다 언어를 바꿀 수 없다.
 */
function Figure({ fig, lang }) {
  return (
    <figure className="shot">
      <div className="shot-img">
        <img src={fig.src} alt={say(fig.alt, lang)} />
        {(fig.marks ?? []).map((m, i) => (
          <span key={i} className="mark" style={{ left: `${m.x}%`, top: `${m.y}%` }}>{i + 1}</span>
        ))}
      </div>
      {fig.legend && (
        <ol className="shot-legend">
          {fig.legend.map((l, i) => <li key={i}><T v={l} lang={lang} /></li>)}
        </ol>
      )}
      {fig.caption && <figcaption><T v={fig.caption} lang={lang} /></figcaption>}
    </figure>
  );
}

function Block({ b, lang }) {
  if (b.h3) return <h3><T v={b.h3} lang={lang} /></h3>;
  if (b.p) return <p><T v={b.p} lang={lang} /></p>;
  if (b.warn) return <p className="warn-line"><T v={b.warn} lang={lang} /></p>;
  if (b.figure) return <Figure fig={b.figure} lang={lang} />;

  if (b.ol) return <ol>{b.ol.map((x, i) => <li key={i}><T v={x} lang={lang} /></li>)}</ol>;
  if (b.ul) return <ul>{b.ul.map((x, i) => <li key={i}><T v={x} lang={lang} /></li>)}</ul>;
  if (b.big) {
    return <ol className="big">{b.big.map((x, i) => <li key={i}><T v={x} lang={lang} /></li>)}</ol>;
  }

  if (b.flow) {
    return (
      <div className="flow">
        {b.flow.map((x, i) => (
          <span key={i} style={{ display: 'contents' }}>
            {i > 0 && <i>→</i>}
            <span><T v={x} lang={lang} /></span>
          </span>
        ))}
      </div>
    );
  }

  if (b.keys) {
    return (
      <table className="k keys">
        <tbody>
          {b.keys.map(([ks, desc], i) => (
            <tr key={i}>
              <td>{ks.map((k, j) => (
                <span key={j}>{j > 0 && '+'}<kbd>{k}</kbd></span>
              ))}</td>
              <td><T v={desc} lang={lang} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (b.table) {
    return (
      <table className="k">
        {b.table.head && (
          <thead>
            <tr>{b.table.head.map((h, i) => <th key={i}><T v={h} lang={lang} /></th>)}</tr>
          </thead>
        )}
        <tbody>
          {b.table.rows.map((row, i) => {
            const cells = row.filter((c) => typeof c === 'object');
            const tone = row.find((c) => typeof c === 'string');
            return (
              <tr key={i}>
                {cells.map((c, j) => (
                  <td key={j} className={j > 0 ? tone : undefined}><T v={c} lang={lang} /></td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
  return null;
}

/**
 * 용어 카드.
 *
 * 네팔어 칸은 비워 둔다. 인쇄해서 팀장께 드리고 손으로 채워 달라고 한다 —
 * 실제 쓰는 사람의 말이 가장 정확하고, 그 편이 검증이 필요 없다.
 */
function Glossary({ lang }) {
  const col = GLOSSARY_UI.cols[lang] ?? GLOSSARY_UI.cols.ko;
  return (
    <section id="h-glossary" className="glossary">
      <h2><i>{'★'}</i>{say(GLOSSARY_UI.title, lang)}</h2>
      <p>{say(GLOSSARY_UI.lead, lang)}</p>
      <p className="warn-line">{say(GLOSSARY_UI.fill, lang)}</p>

      {GLOSSARY.map((g) => (
        <div key={g.title.ko} className="gl-group">
          <h3>{say(g.title, lang)}</h3>
          <table className="k gl">
            <thead>
              <tr><th>{col[0]}</th><th>{col[1]}</th><th>{col[2]}</th></tr>
            </thead>
            <tbody>
              {g.words.map((x) => (
                <tr key={x.ko}>
                  <td className="ko">{x.ko}</td>
                  <td>{x.en}</td>
                  <td className="blank">{x.ne}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

export function Help({ me }) {
  const roles = me?.user?.roles ?? [];
  const [view, setView] = useState(() => defaultView(roles));
  const [lang, setLang] = useState('ko');
  const [glossary, setGlossary] = useState(false);

  const shown = useMemo(() => SECTIONS.filter((s) => s.views.includes(view)), [view]);
  const viewObj = VIEWS.find((v) => v.id === view);

  return (
    <div className="help">
      <div className="help-head">
        <h1>{say(UI.title, lang)}</h1>
        <p>{say(UI.subtitle, lang)}</p>
        <span className="spacer" />
        <div className="langpick">
          {LANGS.map((l) => (
            <button key={l.id} type="button"
                    className={lang === l.id ? 'chip sm on' : 'chip sm'}
                    onClick={() => setLang(l.id)}>{l.label}</button>
          ))}
        </div>
        <button className="btn" onClick={() => window.print()}>{say(UI.print, lang)}</button>
      </div>

      <div className="help-who">
        <span>{say(UI.who, lang)}</span>
        {VIEWS.map((v) => (
          <button key={v.id} type="button"
                  className={view === v.id && !glossary ? 'chip on' : 'chip'}
                  onClick={() => { setView(v.id); setGlossary(false); }}>
            {say(v.label, lang)}<i>{say(v.sub, lang)}</i>
          </button>
        ))}
        <button type="button"
                className={glossary ? 'chip on' : 'chip'}
                onClick={() => setGlossary(true)}>
          {say(GLOSSARY_UI.title, lang)}
          <i>{lang === 'en' ? 'words on the screen' : '화면에 나오는 낱말'}</i>
        </button>
      </div>

      {glossary ? <Glossary lang={lang} /> : (
        <>
          <nav className="help-toc">
            {shown.map((s, i) => (
              <a key={s.id} href={`#h-${s.id}`}><b>{i + 1}</b>{say(s.title, lang)}</a>
            ))}
          </nav>

          {shown.map((s, i) => (
            <section key={s.id} id={`h-${s.id}`}>
              <h2><i>{i + 1}</i>{say(s.title, lang)}</h2>
              {s.blocks.map((b, j) => <Block key={j} b={b} lang={lang} />)}
            </section>
          ))}
        </>
      )}

      <footer className="help-foot">
        {say(UI.footer, lang)}
        {!glossary && <span> · {say(UI.forWhom(viewObj), lang)}</span>}
      </footer>
    </div>
  );
}
