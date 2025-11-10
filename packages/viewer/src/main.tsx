import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { SizeFormatProvider } from './components/SizeValue';
import { AddressFormatProvider } from './components/AddressValue';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <AddressFormatProvider>
            <SizeFormatProvider>
                <App />
            </SizeFormatProvider>
        </AddressFormatProvider>
    </React.StrictMode>,
);
