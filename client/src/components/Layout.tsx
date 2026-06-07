import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Button } from './ui/button'
import { Container, LogOut, LayoutDashboard } from 'lucide-react'

export function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const username = localStorage.getItem('username') || 'User'

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('username')
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center px-6 gap-4">
          <button onClick={() => navigate('/')} className="flex items-center gap-2 font-semibold hover:opacity-80 transition-opacity">
            <Container className="h-5 w-5" />
            <span>Misaka Docker Monitor</span>
          </button>

          <nav className="flex items-center gap-1 ml-6">
            <Button
              variant={location.pathname === '/' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => navigate('/')}
            >
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </Button>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{username}</span>
            <Button variant="ghost" size="icon" onClick={handleLogout} title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
