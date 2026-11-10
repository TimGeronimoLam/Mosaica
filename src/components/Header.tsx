import type { ReactNode } from 'react';
import { href, useRoute } from '../router';
import { LANGS, useI18n } from '../i18n';
import { IconBook, IconMosaics, IconPlus } from './Icons';

export function Logo({ size = 22 }: { size?: number }) {
  const s = size;
  const g = Math.round(s * 0.1);
  const t = (s - g) / 2;
  return (
    <svg className="logo-mark" width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden="true">
      <rect x={0} y={0} width={t} height={t} rx={2} fill="#ef476f" />
      <rect x={t + g} y={0} width={t} height={t} rx={2} fill="#ffd166" />
      <rect x={0} y={t + g} width={t} height={t} rx={2} fill="#06d6a0" />
      <rect x={t + g} y={t + g} width={t} height={t} rx={2} fill="#118ab2" />
    </svg>
  );
}

export function Header() {
  const route = useRoute();
  const { t, lang, setLang } = useI18n();
  const first = route.segments[0] ?? '';
  const link = (path: string, icon: ReactNode, full: string, short: string, active: boolean) => (
    <a className={active ? 'nav-link active' : 'nav-link'} href={href(path)} aria-current={active ? 'page' : undefined}>
      {icon}
      <span className="nav-full">{full}</span>
      <span className="nav-short" aria-hidden="true">
        {short}
      </span>
    </a>
  );
  return (
    <header className="header no-print">
      <a className="brand" href={href('/')} aria-label={t.header.home}>
        <Logo size={26} />
        <span className="brand-name">Mosaica</span>
      </a>
      <nav className="nav" aria-label={t.header.main}>
        {link('/', <IconMosaics size={16} />, t.header.mosaics, t.header.mosaicsShort, first === '')}
        {link('/new', <IconPlus size={16} />, t.header.newMosaic, t.header.newShort, first === 'new' || first === 'edit')}
        {link('/book', <IconBook size={16} />, t.header.book, t.header.bookShort, first === 'book')}
      </nav>
      <div className="lang-switch" role="group" aria-label={t.language}>
        {LANGS.map((l) => (
          <button key={l.value} type="button" lang={l.value} className={l.value === lang ? 'on' : ''} aria-pressed={l.value === lang} title={l.name} onClick={() => setLang(l.value)}>
            {l.label}
          </button>
        ))}
      </div>
    </header>
  );
}
