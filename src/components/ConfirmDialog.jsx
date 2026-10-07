/**
 * Every hard to reverse action here (removing a member, renaming a
 * whiskey, locking a membership) goes through this same component instead
 * of the browser's native confirm(), because confirm() cannot be sized
 * for a finger tap on an iPad and freezes the whole page while open.
 */
export function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onCancel, confirmDisabled }) {
  if (!open) return null

  return (
    <div className="dialog-overlay" role="presentation" onClick={onCancel}>
      <div
        className="dialog-box"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="dialog-title">{title}</h2>
        <p>{message}</p>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}