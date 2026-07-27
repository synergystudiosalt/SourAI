import {createRoot} from 'react-dom/client';
import {Root, rootErrorHandlers} from './Root';
import './index.css';

createRoot(document.getElementById('root')!, rootErrorHandlers).render(
  <Root />,
);
