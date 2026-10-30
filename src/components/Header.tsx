import { href, useRoute } from '../router';

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
  const first = route.segments[0] ?? '';
  const link = (path: string, label: string, active: boolean) => (
    <a className={active ? 'nav-link active' : 'nav-link'} href={href(path)}>
      {label}
    </a>
  );
  return (
    <header className="header no-print">
      <a className="brand" href={href('/')}>
        <Logo />
        <span>Mosaica</span>
      </a>
      <nav className="nav">
        {link('/', 'My mosaics', first === '')}
        {link('/new', 'New mosaic', first === 'new' || first === 'edit')}
        {link('/book', 'Print a book', first === 'book')}
      </nav>
    </header>
  );
}
