import { Header } from './components/Header';
import { Gallery } from './components/Gallery';
import { Editor } from './components/Editor';
import { PrintView } from './components/PrintView';
import { BookView } from './components/BookView';
import { useRoute } from './router';

export function App() {
  const route = useRoute();
  const [first, second] = route.segments;

  let page: React.ReactNode;
  let printMode = false;
  if (!first) {
    page = <Gallery />;
  } else if (first === 'new') {
    page = <Editor key="new" id={null} />;
  } else if (first === 'edit' && second) {
    page = <Editor key={second} id={second} />;
  } else if (first === 'print' && second) {
    page = <PrintView id={second} />;
    printMode = true;
  } else if (first === 'book') {
    page = <BookView query={route.query} />;
    printMode = true;
  } else {
    page = (
      <div className="page narrow">
        <h1>Page not found</h1>
        <p>
          <a href="#/">Back to your mosaics</a>
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
