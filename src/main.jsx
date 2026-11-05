import React from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import MuseumGallery from '../museum_gallery.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MuseumGallery />
  </React.StrictMode>,
);