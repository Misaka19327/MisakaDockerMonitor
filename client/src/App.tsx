import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {Layout} from './components/Layout'
import {LoginPage} from './components/LoginPage'
import {Dashboard} from './components/Dashboard'
import {LogViewer} from './components/LogViewer'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

function ProtectedRoute({children}: { children: React.ReactNode }) {
  const token = localStorage.getItem('token')
  if (!token) return <Navigate to="/login" replace/>
  return <>{children}</>
}

export default function App() {
  return (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage/>}/>
            <Route element={<ProtectedRoute><Layout/></ProtectedRoute>}>
              <Route path="/" element={<Dashboard/>}/>
              <Route path="/container/:id" element={<LogViewer/>}/>
            </Route>
            <Route path="*" element={<Navigate to="/" replace/>}/>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
  )
}
