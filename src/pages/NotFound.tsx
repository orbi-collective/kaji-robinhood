import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'

export default function NotFound() {
  return (
    <AppShell>
      <div className="crashScreen">
        <span className="mono-label">ERROR 404</span>
        <h1 className="crashScreen__title">No such station.</h1>
        <p className="crashScreen__body">
          That route isn&rsquo;t part of the foundry. The scanner is the usual way in. It ranks every live recipe
          against your mandate.
        </p>
        <div className="crashScreen__actions">
          <Link to="/opportunities" className="btn-lime">
            OPEN THE FOUNDRY <span aria-hidden="true">→</span>
          </Link>
          <Link to="/" className="btn-outline">
            BACK TO LANDING
          </Link>
        </div>
      </div>
    </AppShell>
  )
}
