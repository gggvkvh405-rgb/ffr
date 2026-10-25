import { Dialog } from './ui/Dialog';
import { Kbd } from './ui/Kbd';
import { useBrowser } from '../state/browser-store';
import { isMac } from '../lib/platform';

interface Shortcut {
  keys: string[];
  label: string;
}

const GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: 'Поиск и адрес',
    items: [
      { keys: ['/'], label: 'Фокус на поиске' },
      { keys: ['Esc'], label: 'Закрыть панель' },
      { keys: [isMac ? '⌘' : 'Ctrl', 'K'], label: 'Поиск (если доступно)' },
    ],
  },
  {
    title: 'Вкладки',
    items: [
      { keys: ['T'], label: 'Новая вкладка' },
      { keys: ['W'], label: 'Закрыть вкладку' },
      { keys: ['1', '…', '9'], label: 'Переключение вкладок' },
      { keys: [isMac ? '⌥' : 'Alt', '←'], label: 'Назад' },
      { keys: [isMac ? '⌥' : 'Alt', '→'], label: 'Вперёд' },
    ],
  },
  {
    title: 'ByAzen',
    items: [
      { keys: ['B'], label: 'Закладки' },
      { keys: ['H'], label: 'История' },
      { keys: [','], label: 'Настройки' },
      { keys: ['?'], label: 'Эта шпаргалка' },
    ],
  },
];

export function ShortcutsDialog() {
  const { shortcutsOpen, setShortcutsOpen } = useBrowser();

  return (
    <Dialog
      open={shortcutsOpen}
      onClose={() => setShortcutsOpen(false)}
      titleId="shortcuts-title"
      className="dialog--shortcuts"
    >
      <div className="dialog-eyebrow">
        <span className="micro-label">ByAzen</span>
        <span className="eyebrow-slash">/</span>
        <span className="micro-label">Помощь</span>
      </div>
      <h2 className="dialog-title dialog-title--serif" id="shortcuts-title">
        Горячие клавиши
      </h2>
      <p className="dialog-text">
        Одиночные клавиши работают, когда курсор не в поле ввода. На Mac используйте ⌘ и ⌥ вместо
        Ctrl и Alt.
      </p>
      <div className="shortcut-grid">
        {GROUPS.map((group) => (
          <div className="shortcut-group" key={group.title}>
            <div className="shortcut-group-title">{group.title}</div>
            {group.items.map((item) => (
              <div className="shortcut-row" key={`${group.title}-${item.label}`}>
                <span className="shortcut-label">{item.label}</span>
                <span className="shortcut-keys">
                  {item.keys.map((key, index) => (
                    <Kbd key={`${key}-${index}`}>{key}</Kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="dialog-footnote">
        Нажмите <Kbd>Esc</Kbd>, чтобы закрыть.
      </div>
    </Dialog>
  );
}
