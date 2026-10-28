import styles from './styles.css';
import panel from './panel.html';
export function createPanelMarkup(version) { return '<style>'+styles+'</style>'+panel.replaceAll('${SCRIPT_VERSION}',version); }
