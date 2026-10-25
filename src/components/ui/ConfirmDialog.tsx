import { Dialog } from './Dialog';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  tone?: 'danger' | 'default';
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  tone = 'default',
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} titleId="confirm-title" className="dialog--confirm">
      <h2 className="dialog-title" id="confirm-title">
        {title}
      </h2>
      <p className="dialog-text">{description}</p>
      <div className="dialog-actions">
        <button type="button" className="button button--soft" onClick={onClose}>
          Отмена
        </button>
        <button
          type="button"
          className={`button ${tone === 'danger' ? 'button--danger' : 'button--accent'}`}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
