import {useState} from 'react'
import {Outlet, useLocation, useNavigate} from 'react-router-dom'
import {Button} from './ui/button'
import {Container, LayoutDashboard, LogOut, Moon, Settings2, Sun, Type} from 'lucide-react'
import {Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger} from './ui/drawer'
import {useUiPreferences} from '../lib/ui-preferences'

export function Layout() {
    const navigate = useNavigate()
    const location = useLocation()
    const {locale, setLocale, theme, setTheme, logFontSize, setLogFontSize, t} = useUiPreferences()
    const username = localStorage.getItem('username') || t('common.user')
    const [settingsOpen, setSettingsOpen] = useState(false)
    
    const handleLogout = () => {
        localStorage.removeItem('token')
        localStorage.removeItem('username')
        navigate('/login')
    }
    
    return (
        <div className="min-h-screen bg-background">
            <header
                className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="flex h-14 items-center px-6 gap-4">
                    <button onClick={() => navigate('/')}
                            className="flex items-center gap-2 font-semibold hover:opacity-80 transition-opacity">
                        <Container className="h-5 w-5"/>
                        <span>Misaka Docker Monitor</span>
                    </button>
                    
                    <nav className="flex items-center gap-1 ml-6">
                        <Button
                            variant={location.pathname === '/' ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={() => navigate('/')}
                        >
                            <LayoutDashboard className="h-4 w-4"/>
                            {t('nav.dashboard')}
                        </Button>
                    </nav>
                    
                    <div className="ml-auto flex items-center gap-2">
                        <Drawer direction="right" open={settingsOpen} onOpenChange={setSettingsOpen}>
                            <DrawerTrigger asChild>
                                <Button variant="ghost" size="icon" title={t('settings.open')}>
                                    <Settings2 className="h-4 w-4"/>
                                </Button>
                            </DrawerTrigger>
                            <DrawerContent className="w-full max-w-sm min-w-80">
                                <DrawerHeader>
                                    <DrawerTitle>{t('settings.title')}</DrawerTitle>
                                    <DrawerDescription>{t('settings.description')}</DrawerDescription>
                                </DrawerHeader>
                                <div className="flex-1 space-y-6 overflow-auto px-4 pb-6">
                                    <section className="space-y-3 rounded-xl border border-border/70 bg-card/70 p-4">
                                        <div>
                                            <h3 className="text-sm font-semibold">{t('settings.language')}</h3>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                type="button"
                                                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${locale === 'zh-CN' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-accent'}`}
                                                onClick={() => setLocale('zh-CN')}
                                            >
                                                {t('language.zh')}
                                            </button>
                                            <button
                                                type="button"
                                                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${locale === 'en' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-accent'}`}
                                                onClick={() => setLocale('en')}
                                            >
                                                {t('language.en')}
                                            </button>
                                        </div>
                                    </section>
                                    
                                    <section className="space-y-3 rounded-xl border border-border/70 bg-card/70 p-4">
                                        <div>
                                            <h3 className="text-sm font-semibold">{t('settings.theme')}</h3>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                type="button"
                                                className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${theme === 'light' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-accent'}`}
                                                onClick={() => setTheme('light')}
                                            >
                                                <Sun className="h-4 w-4"/>
                                                {t('theme.mode.light')}
                                            </button>
                                            <button
                                                type="button"
                                                className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${theme === 'dark' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-accent'}`}
                                                onClick={() => setTheme('dark')}
                                            >
                                                <Moon className="h-4 w-4"/>
                                                {t('theme.mode.dark')}
                                            </button>
                                        </div>
                                    </section>
                                    
                                    <section className="space-y-3 rounded-xl border border-border/70 bg-card/70 p-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <h3 className="text-sm font-semibold">{t('settings.logFontSize')}</h3>
                                                <p className="text-xs text-muted-foreground">{t('settings.logFontHint')}</p>
                                            </div>
                                            <div
                                                className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-background px-3 py-2">
                                                <Type className="h-4 w-4 text-muted-foreground"/>
                                                <span
                                                    className="text-sm font-medium tabular-nums">{logFontSize}px</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <button
                                                type="button"
                                                className="rounded-md border border-border px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                                onClick={() => setLogFontSize(logFontSize - 1)}
                                                title={t('viewer.logFontSmaller')}
                                            >
                                                A-
                                            </button>
                                            <input
                                                type="range"
                                                min={11}
                                                max={18}
                                                step={1}
                                                value={logFontSize}
                                                onChange={e => setLogFontSize(Number(e.target.value))}
                                                aria-label={t('settings.logFontSize')}
                                                className="h-2 flex-1 cursor-pointer accent-amber-600 dark:accent-amber-400"
                                            />
                                            <button
                                                type="button"
                                                className="rounded-md border border-border px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                                onClick={() => setLogFontSize(logFontSize + 1)}
                                                title={t('viewer.logFontLarger')}
                                            >
                                                A+
                                            </button>
                                        </div>
                                    </section>
                                </div>
                            </DrawerContent>
                        </Drawer>
                        <span className="text-sm text-muted-foreground">{username}</span>
                        <Button variant="ghost" size="icon" onClick={handleLogout} title={t('action.signOut')}>
                            <LogOut className="h-4 w-4"/>
                        </Button>
                    </div>
                </div>
            </header>
            
            <main className="flex-1">
                <Outlet/>
            </main>
        </div>
    )
}
