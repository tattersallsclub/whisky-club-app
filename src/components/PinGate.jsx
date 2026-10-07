import { useState } from 'react'
import { APPS_SCRIPT_WEB_APP_URL } from '../config'

export const TOKEN_STORAGE_KEY = 'whiskyClub.authToken'

/**
 * The PIN itself is never shipped inside this app at all anymore, it
 * lives only in the backend's Script Properties, checked there, on the
 * server. What this component gets back and stores is a short lived
 * random token, not the PIN, so even a fully compromised browser only
 * ever exposes something that expires on its own within twelve hours,
 * never the real credential.
 *
 * Children are passed as a function receiving that token, rather than
 * rendered directly, because the repository that talks to the backend
 * has to be built with this exact token baked in, and that repository
 * cannot exist until login has actually happened.
 */
export function PinGate({ children }) {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_STORAGE_KEY))
  const [pin, setPin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  if (token) {
    return children(token)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(APPS_SCRIPT_WEB_APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'login', payload: { pin } }),
      })
      const result = await response.json()
      if (result.error || !result.token) {
        throw new Error(result.error || 'Incorrect PIN')
      }
      sessionStorage.setItem(TOKEN_STORAGE_KEY, result.token)
      setToken(result.token)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="pin-gate">
      <form onSubmit={handleSubmit} className="pin-form">
        <h1>Whisky Club</h1>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => {
            setPin(e.target.value)
            setError(null)
          }}
          placeholder="PIN"
          disabled={submitting}
        />
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Checking...' : 'Enter'}
        </button>
        {error && <p className="pin-error">{error}</p>}
      </form>
    </div>
  )
}