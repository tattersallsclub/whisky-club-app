import { useState } from 'react'
import { useClubData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { ConfirmDialog } from './ConfirmDialog'
import { Spinner } from './Spinner'
import { useAsyncAction } from '../hooks/useAsyncAction'

const TYPE_LABELS = {
  join: 'New member',
  newRange: 'New range',
  renewal: 'Renewal',
}

export function NotificationsScreen({ onBack }) {
  const { state, releasePurchaseRequest, dismissPurchaseRequest } = useClubData()
  const { showToast } = useToast()
  const [pendingRelease, setPendingRelease] = useState(null)
  const [pendingDismiss, setPendingDismiss] = useState(null)

  const [runRelease, releasing] = useAsyncAction(async (request) => {
    try {
      await releasePurchaseRequest(request.id)
      showToast(`Range released for ${request.name}.`, 'success')
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setPendingRelease(null)
    }
  })

  const [runDismiss, dismissing] = useAsyncAction(async (request) => {
    try {
      await dismissPurchaseRequest(request.id)
      showToast('Request dismissed.', 'success')
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setPendingDismiss(null)
    }
  })

  const requests = [...state.purchaseRequests].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))

  return (
    <div className="admin-screen">
      <div className="admin-screen-header">
        <h2>Notifications</h2>
        <button className="btn btn-secondary" onClick={onBack}>Back</button>
      </div>

      {requests.length === 0 && <p className="all-clear">Nothing pending.</p>}

      {requests.map((request) => (
        <div key={request.id} className="notification-card">
          <div className="notification-card-header">
            <h3>{request.name}</h3>
            <span className="notification-type-tag">{TYPE_LABELS[request.type] || request.type}</span>
          </div>
          <p className="notification-detail">Code: {request.code}</p>
          <p className="notification-detail">Range: {request.rangeId}</p>
          {state.rangePrice && (
            <p className="notification-detail notification-price">Charge: ${state.rangePrice}</p>
          )}
          <p className="notification-detail">
            Payment: {request.paymentMethod === 'member_account' ? 'Member account' : 'Cash / credit card'}
          </p>
          {request.contactInfo && <p className="notification-detail">Contact: {request.contactInfo}</p>}

          <div className="notification-actions">
            <button className="btn btn-danger btn-small" onClick={() => setPendingDismiss(request)}>
              Dismiss
            </button>
            <button className="btn btn-primary btn-small" onClick={() => setPendingRelease(request)}>
              Release range
            </button>
          </div>
        </div>
      ))}

      <ConfirmDialog
        open={Boolean(pendingRelease)}
        title="Confirm payment"
        message="Has the payment already been closed? Releasing this adds the range to the member's account right now."
        confirmLabel={releasing ? <Spinner /> : 'Release'}
        confirmDisabled={releasing}
        onConfirm={() => runRelease(pendingRelease)}
        onCancel={() => setPendingRelease(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingDismiss)}
        title="Dismiss this request"
        message="Are you sure you want to dismiss this? The request will be deleted, this cannot be undone."
        confirmLabel={dismissing ? <Spinner /> : 'Dismiss'}
        confirmDisabled={dismissing}
        onConfirm={() => runDismiss(pendingDismiss)}
        onCancel={() => setPendingDismiss(null)}
      />
    </div>
  )
}