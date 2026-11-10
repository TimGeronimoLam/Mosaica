import { Header } from './components/Header';
import { Gallery } from './components/Gallery';
import { Editor } from './components/Editor';
import { WhodunitEditor } from './components/WhodunitEditor';
import { PrintView } from './components/PrintView';
import { BookView } from './components/BookView';
import { useRoute } from './router';
import { useT } from './i18n';

export function App() {
  const route = useRoute();
  const t = useT();
  const [first, second] = route.segments;

  let page: React.ReactNode;
  let printMode = false;
  if (!first) {
    page = <Gallery />;
  } else if (first === 'new') {
    page = <Editor key="new" id={null} />;
  } else if (first === 'edit' && second) {
    page = <Editor key={second} id={second} />;
  } else if (first === 'whodunit') {
    page = <WhodunitEditor key={second ?? 'new'} id={second ?? null} />;
  } else if (first === 'print' && second) {
    page = <PrintView id={second} />;
    printMode = true;
  } else if (first === 'book') {
    page = <BookView query={route.query} />;
    printMode = true;
  } else {
    page = (
      <div className="page narrow">
        <h1>{t.notFound}</h1>
        <p>
          <a href="#/">{t.backToMosaics}</a>
        </p>
      </div>
    );
  }

  return (
    <div className={printMode ? 'app print-mode' : 'app'}>
      <Header />
      {page}
    </div>
  );
}
