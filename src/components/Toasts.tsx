import { X } from 'lucide-react';
import { useBrowser } from '../state/browser-store';

export function Toasts() {
  const { toasts, dismissToast } = useBrowser();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div className="toast" key={toast.id} role="status">
          <span className="toast-dot" aria-hidden="true" />
          <span className="toast-message">{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.action?.onClick();
                dismissToast(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
          <button
            type="button"
            className="toast-close"
            aria-label="Закрыть уведомление"
            onClick={() => dismissToast(toast.id)}
          >
            <X size={12} strokeWidth={2} />
          </button>
        </div>
      ))}
    </div>
  );
}
