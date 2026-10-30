import { createRoot } from 'react-dom/client';
import css from './studio.css';
import { connect } from './bridge';
import { Studio } from './Studio';

const style = document.createElement('style');
style.textContent = css;
document.head.append(style);

await connect();
const root = document.createElement('div');
root.className = 'is-root';
document.body.append(root);
createRoot(root).render(<Studio />);
