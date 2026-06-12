import {useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {Button} from './ui/button'
import {Input} from './ui/input'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from './ui/card'
import {api} from '../lib/api'
import {Container as ContainerIcon, LogIn} from 'lucide-react'
import {useUiPreferences} from '../lib/ui-preferences'

export function LoginPage() {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const navigate = useNavigate()
    const {t} = useUiPreferences()
    
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setLoading(true)
        
        try {
            const res = await api.auth.login(username, password)
            localStorage.setItem('token', res.token)
            localStorage.setItem('username', res.username)
            navigate('/')
        } catch (err: any) {
            setError(err.message || t('login.failed'))
        } finally {
            setLoading(false)
        }
    }
    
    return (
        <div className="min-h-screen flex items-center justify-center bg-background px-4">
            <Card className="w-full max-w-md mx-4">
                <CardHeader className="text-center">
                    <div className="flex items-center justify-center gap-2 mb-2">
                        <ContainerIcon className="h-8 w-8 text-primary"/>
                    </div>
                    <CardTitle className="text-2xl">Misaka Docker Monitor</CardTitle>
                    <CardDescription>{t('login.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">{t('login.username')}</label>
                            <Input
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                                placeholder="admin"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">{t('login.password')}</label>
                            <Input
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="password"
                                required
                            />
                        </div>
                        {error && <p className="text-sm text-red-600">{error}</p>}
                        <Button type="submit" className="w-full" disabled={loading}>
                            <LogIn className="h-4 w-4"/>
                            {loading ? t('login.signingIn') : t('login.signIn')}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    )
}
