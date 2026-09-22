import { createRoot } from 'react-dom/client';

// scroll bar
import 'simplebar-react/dist/simplebar.min.css';

import '@fontsource/public-sans/400.css';
import '@fontsource/public-sans/500.css';
import '@fontsource/public-sans/600.css';
import '@fontsource/public-sans/700.css';

// project imports
import App from './App';
import { ConfigProvider } from 'contexts/ConfigContext';

const container = document.getElementById('root');
const root = createRoot(container);

// ==============================|| MAIN - REACT DOM RENDER ||============================== //

root.render(
  <ConfigProvider>
    <App />
  </ConfigProvider>
);
