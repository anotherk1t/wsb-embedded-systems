import React from 'react';
import { createRoot } from 'react-dom/client';
import '@flaticon/flaticon-uicons/css/regular/rounded.css';
import './styles/app.css';
import App from './App';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
