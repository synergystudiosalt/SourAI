import {createRoot} from 'react-dom/client';
import {Root, rootErrorHandlers} from './Root';
// Self-hosted rather than linked from Google Fonts: the app's CSP is
// `font-src 'self' data:`, so a remote face would be blocked and silently fall
// back to the platform monospace.
import '@fontsource/fira-code/400.css';
import '@fontsource/fira-code/500.css';
import '@fontsource/fira-code/600.css';
import './index.css';

createRoot(document.getElementById('root')!, rootErrorHandlers).render(
  <Root />,
);
