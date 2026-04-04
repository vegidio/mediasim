import React from 'react';
import { createTheme, GlobalStyles, StyledEngineProvider, ThemeProvider } from '@mui/material';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import './index.css';

const darkTheme = createTheme({
    palette: { mode: 'dark' },
    cssVariables: true,
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <ThemeProvider theme={darkTheme}>
            <StyledEngineProvider enableCssLayer>
                <GlobalStyles styles='@layer theme, base, mui, components, utilities;' />
                <App />
            </StyledEngineProvider>
        </ThemeProvider>
    </React.StrictMode>,
);
