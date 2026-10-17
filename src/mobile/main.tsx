import { createRoot } from 'react-dom/client';
import { MobileApp } from './MobileApp';
import { isNative, trackKeyboard } from './native';
import './mobile.css';

if (isNative) document.documentElement.classList.add('is-native');
trackKeyboard();

createRoot(document.getElementById('root')!).render(<MobileApp />);
