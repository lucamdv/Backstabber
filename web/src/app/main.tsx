import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw Error('Elemento raiz indisponível.');
createRoot(root).render(<App />);
