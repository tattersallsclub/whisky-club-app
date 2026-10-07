import { createContext, useCallback, useContext, useState } from 'react'

const ToastContext = createContext(null)

/**
 * Toasts render above everything else in the app, on purpose, they are
 * for actions that should never be blocked by a modal or a page
 * transition, someone tapping Synchronize should still be able to keep
 * using the app while that message sits in the corner. updateToast
 * exists specifically for actions with a "this is happening" phase
 * followed by a "this is the result" phase (syncing, for example),
 * rather than only supporting a single fire and forget message.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback((message, type = 'success', autoDismissMs = 4000) => {
    const id = `${Date.now()}_${Math.random()}`
    setToasts((prev) => [...prev, { id, message, type }])
    if (autoDismissMs) {
      setTimeout(() => dismissToast(id), autoDismissMs)
    }
    return id
  }, [dismissToast])

  const updateToast = useCallback((id, message, type, autoDismissMs = 4000) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, message, type } : t)))
    if (autoDismissMs) {
      setTimeout(() => dismissToast(id), autoDismissMs)
    }
  }, [dismissToast])

  return (
    <ToastContext.Provider value={{ showToast, updateToast, dismissToast }}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`} role="status">
            {t.type === 'syncing' && <span className="spinner" />}
            <span className="toast-message">{t.message}</span>
            <button className="toast-dismiss" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be called inside a ToastProvider')
  }
  return context
}