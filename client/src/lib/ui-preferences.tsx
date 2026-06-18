import {createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState,} from 'react'

export type Locale = 'zh-CN' | 'en'
export type ThemeMode = 'light' | 'dark'

type TranslationParams = Record<string, string | number>

interface UiPreferencesContextValue {
    locale: Locale
    setLocale: (locale: Locale) => void
    theme: ThemeMode
    setTheme: (theme: ThemeMode) => void
    toggleTheme: () => void
    logFontSize: number
    setLogFontSize: (size: number) => void
    t: (key: string, params?: TranslationParams) => string
}

const STORAGE_KEYS = {
    locale: 'ui:locale',
    theme: 'ui:theme',
    logFontSize: 'ui:log-font-size',
} as const

const MIN_LOG_FONT_SIZE = 11
const MAX_LOG_FONT_SIZE = 18
const DEFAULT_LOG_FONT_SIZE = 12

const translations: Record<Locale, Record<string, string>> = {
    'zh-CN': {
        'nav.dashboard': '概览',
        'action.signOut': '退出登录',
        'action.refresh': '刷新',
        'action.search': '搜索',
        'action.clear': '清除',
        'action.pause': '暂停',
        'action.resume': '继续',
        'common.user': '用户',
        'common.none': '(无)',
        'common.sql': 'SQL',
        'common.json': 'JSON',
        'viewer.copy.copied': '已复制日志行',
        'viewer.copy.failed': '复制失败',
        'language.toggle': '切换为 English',
        'language.zh': '中',
        'language.en': 'EN',
        'theme.toggle.dark': '切换到黑暗模式',
        'theme.toggle.light': '切换到浅色模式',
        'theme.mode.light': '浅色',
        'theme.mode.dark': '黑暗',
        'settings.title': '显示设置',
        'settings.description': '统一管理界面语言、主题和日志字号。',
        'settings.open': '打开设置',
        'settings.language': '语言',
        'settings.theme': '主题',
        'settings.logFontSize': '日志字号',
        'settings.logFontHint': '全局生效，日志页会即时更新。',
        'login.description': '登录后查看并监控你的 Docker 容器',
        'login.username': '用户名',
        'login.password': '密码',
        'login.signIn': '登录',
        'login.signingIn': '登录中...',
        'login.failed': '登录失败',
        'dashboard.title': '容器',
        'dashboard.description': '监控 Docker 容器日志',
        'dashboard.loading': '正在加载容器...',
        'dashboard.empty': '未发现容器，请确认 Docker 正在运行。',
        'dashboard.pin': '置顶容器',
        'dashboard.unpin': '取消置顶',
        'dashboard.pinned': '已置顶',
        'dashboard.watch': '监控',
        'dashboard.unwatch': '取消监控',
        'dashboard.viewLogs': '查看日志',
        'dashboard.group.watchedRunning.title': '已监控 / 运行中',
        'dashboard.group.watchedRunning.description': '当前正在运行的已监控容器。',
        'dashboard.group.watchedIdle.title': '已监控 / 未运行',
        'dashboard.group.watchedIdle.description': '已监控但当前已暂停、退出或不可用的容器。',
        'dashboard.group.unwatchedRunning.title': '未监控 / 运行中',
        'dashboard.group.unwatchedRunning.description': '正在运行但尚未纳入监控的容器。',
        'dashboard.group.unwatchedIdle.title': '未监控 / 未运行',
        'dashboard.group.unwatchedIdle.description': '既未监控也未运行的容器。',
        'viewer.env': '环境变量',
        'viewer.noEnv': '未发现环境变量。',
        'viewer.env.composePath': 'docker-compose.yml 路径',
        'viewer.env.composePathPlaceholder': '输入宿主机内有效路径，如 /srv/app/docker-compose.yml',
        'viewer.env.validatePath': '校验路径',
        'viewer.env.pathRequired': '需要先输入并校验 compose 文件路径。',
        'viewer.env.pathValid': '路径已通过校验，可编辑环境变量。',
        'viewer.env.pathInvalid': '路径未通过校验，暂不可编辑。',
        'viewer.env.pathPending': '校验通过后才允许新增、编辑或删除。',
        'viewer.env.add': '新增变量',
        'viewer.env.key': '变量名',
        'viewer.env.value': '值',
        'viewer.env.save': '保存',
        'viewer.env.cancel': '取消',
        'viewer.env.delete': '删除',
        'viewer.env.doubleClickCopy': '双击复制键值对',
        'viewer.env.copied': '已复制',
        'viewer.env.copyFailed': '复制失败',
        'viewer.env.apiPending': '接口预留中，当前仅展示前端交互。',
        'viewer.env.locked': '环境变量正在提交或上次提交未完成，编辑区已锁定。',
        'viewer.env.batchHint': '可连续修改多条，最后统一提交。',
        'viewer.env.pendingChanges': '{count} 条待提交',
        'viewer.env.submitChanges': '提交变更',
        'viewer.env.discardChanges': '放弃变更',
        'viewer.env.submitting': '正在写入 compose 文件并重建容器...',
        'viewer.env.submitSuccess': '环境变量已更新，容器已重建并运行。',
        'viewer.env.submitFailed': '提交环境变量失败',
        'viewer.allLevels': '全部级别',
        'viewer.allInstances': '全部实例',
        'viewer.searchLogs': '搜索日志...',
        'viewer.timeFilter.allTime': '全部时间',
        'viewer.timeFilter.noStart': '不限',
        'viewer.timeFilter.noEnd': '至今',
        'viewer.timeFilter.customRange': '自定义范围',
        'viewer.timeFilter.startTime': '起始时间',
        'viewer.timeFilter.endTime': '结束时间',
        'viewer.timeFilter.apply': '应用',
        'viewer.timeFilter.clear': '清除时间',
        'viewer.timeFilter.presets.last15m': '近 15 分钟',
        'viewer.timeFilter.presets.last1h': '近 1 小时',
        'viewer.timeFilter.presets.last6h': '近 6 小时',
        'viewer.timeFilter.presets.today': '今天',
        'viewer.timeFilter.presets.yesterday': '昨天',
        'viewer.timeFilter.presets.last7d': '近 7 天',
        'viewer.groupByField': '按字段分组',
        'viewer.totalEntries': '{count} 条日志',
        'viewer.liveWindow': '实时窗口：{count}',
        'viewer.filteredBy': '过滤词："{value}"',
        'viewer.levelLabel': '级别：{value}',
        'viewer.loading': '正在加载日志...',
        'viewer.noLogs': '暂无日志，等待采集...',
        'viewer.refreshLogs': '手动刷新日志',
        'viewer.sort.reverse': '反向排序（新→旧）',
        'viewer.sort.forward': '正向排序（旧→新）',
        'viewer.autoScroll.disable': '自动滚动：点击关闭',
        'viewer.autoScroll.enable': '自动滚动：点击开启',
        'viewer.logFontSize': '字号',
        'viewer.logFontSmaller': '缩小字号',
        'viewer.logFontLarger': '放大字号',
        'viewer.inlineTrace': 'trace',
        'viewer.inlineSpan': 'span',
        'viewer.sqlSummaryFallback': '查看 SQL',
        'viewer.sqlJoinMore': '+{count}',
        'viewer.containerUnknown': '未知',
        'viewer.upPrefix': '运行时长',
        'viewer.exitPrefix': '退出码',
        'viewer.pidPrefix': 'PID',
        'viewer.groupPanel.show': '字段分组',
        'viewer.groupPanel.hide': '收起字段分组',
        'viewer.scrollTop': '回到顶部',
        'group.fieldPlaceholder': '键名（如 level、path、caller）',
        'group.button': '分组',
        'group.inline': '内联',
        'group.inlineTitle.enabled': '在日志列表内展示分组',
        'group.inlineTitle.disabled': '切换为内联分组模式',
        'group.inlineEnabled': '内联分组已启用，日志列表按 "{field}" 分组展示',
        'group.noGroups': '字段 "{field}" 没有可展示的分组',
        'inline.toggle.expand': '展开',
        'inline.toggle.collapse': '收起',
        'viewer.pullToLoad.hint': '加载更早',
        'viewer.pullToLoad.release': '释放加载更早',
        'viewer.pullToLoad.loading': '正在加载更早日志…',
        'viewer.pullToLoad.noMore': '没有更多日志',
    },
    en: {
        'nav.dashboard': 'Dashboard',
        'action.signOut': 'Sign out',
        'action.refresh': 'Refresh',
        'action.search': 'Search',
        'action.clear': 'Clear',
        'action.pause': 'Pause',
        'action.resume': 'Resume',
        'common.user': 'User',
        'common.none': '(none)',
        'common.sql': 'SQL',
        'common.json': 'JSON',
        'viewer.copy.copied': 'Log line copied',
        'viewer.copy.failed': 'Copy failed',
        'language.toggle': 'Switch to Chinese',
        'language.zh': '中',
        'language.en': 'EN',
        'theme.toggle.dark': 'Switch to dark mode',
        'theme.toggle.light': 'Switch to light mode',
        'theme.mode.light': 'Light',
        'theme.mode.dark': 'Dark',
        'settings.title': 'Display Settings',
        'settings.description': 'Manage interface language, theme, and log font size in one place.',
        'settings.open': 'Open settings',
        'settings.language': 'Language',
        'settings.theme': 'Theme',
        'settings.logFontSize': 'Log font size',
        'settings.logFontHint': 'Applies globally and updates log views immediately.',
        'login.description': 'Sign in to monitor your Docker containers',
        'login.username': 'Username',
        'login.password': 'Password',
        'login.signIn': 'Sign In',
        'login.signingIn': 'Signing in...',
        'login.failed': 'Login failed',
        'dashboard.title': 'Containers',
        'dashboard.description': 'Monitor Docker container logs',
        'dashboard.loading': 'Loading containers...',
        'dashboard.empty': 'No containers found. Make sure Docker is running.',
        'dashboard.pin': 'Pin container',
        'dashboard.unpin': 'Unpin container',
        'dashboard.pinned': 'Pinned',
        'dashboard.watch': 'Watch',
        'dashboard.unwatch': 'Unwatch',
        'dashboard.viewLogs': 'View Logs',
        'dashboard.group.watchedRunning.title': 'Monitored / Running',
        'dashboard.group.watchedRunning.description': 'Watched containers that are currently running.',
        'dashboard.group.watchedIdle.title': 'Monitored / Not Running',
        'dashboard.group.watchedIdle.description': 'Watched containers that are paused, exited, or unavailable.',
        'dashboard.group.unwatchedRunning.title': 'Not Monitored / Running',
        'dashboard.group.unwatchedRunning.description': 'Running containers that are not being watched yet.',
        'dashboard.group.unwatchedIdle.title': 'Not Monitored / Not Running',
        'dashboard.group.unwatchedIdle.description': 'Containers that are neither watched nor running.',
        'viewer.env': 'Environment Variables',
        'viewer.noEnv': 'No environment variables found.',
        'viewer.env.composePath': 'docker-compose.yml path',
        'viewer.env.composePathPlaceholder': 'Host path, e.g. /srv/app/docker-compose.yml',
        'viewer.env.validatePath': 'Validate path',
        'viewer.env.pathRequired': 'Enter and validate the compose file path first.',
        'viewer.env.pathValid': 'Path validated. Environment variables can be edited.',
        'viewer.env.pathInvalid': 'Path validation failed. Editing is locked.',
        'viewer.env.pathPending': 'Validate the path before adding, editing, or deleting.',
        'viewer.env.add': 'Add variable',
        'viewer.env.key': 'Key',
        'viewer.env.value': 'Value',
        'viewer.env.save': 'Save',
        'viewer.env.cancel': 'Cancel',
        'viewer.env.delete': 'Delete',
        'viewer.env.doubleClickCopy': 'Double-click to copy key/value',
        'viewer.env.copied': 'Copied',
        'viewer.env.copyFailed': 'Copy failed',
        'viewer.env.apiPending': 'API is reserved; this is the frontend interaction only.',
        'viewer.env.locked': 'Environment changes are being applied or the previous submit did not finish. Editing is locked.',
        'viewer.env.batchHint': 'Edit multiple variables, then submit them together.',
        'viewer.env.pendingChanges': '{count} pending',
        'viewer.env.submitChanges': 'Submit changes',
        'viewer.env.discardChanges': 'Discard changes',
        'viewer.env.submitting': 'Writing compose file and rebuilding container...',
        'viewer.env.submitSuccess': 'Environment updated. Container was rebuilt and is running.',
        'viewer.env.submitFailed': 'Failed to submit environment changes',
        'viewer.allLevels': 'All levels',
        'viewer.allInstances': 'All instances',
        'viewer.searchLogs': 'Search logs...',
        'viewer.timeFilter.allTime': 'All time',
        'viewer.timeFilter.noStart': 'Any',
        'viewer.timeFilter.noEnd': 'Now',
        'viewer.timeFilter.customRange': 'Custom range',
        'viewer.timeFilter.startTime': 'Start time',
        'viewer.timeFilter.endTime': 'End time',
        'viewer.timeFilter.apply': 'Apply',
        'viewer.timeFilter.clear': 'Clear time',
        'viewer.timeFilter.presets.last15m': 'Last 15 minutes',
        'viewer.timeFilter.presets.last1h': 'Last 1 hour',
        'viewer.timeFilter.presets.last6h': 'Last 6 hours',
        'viewer.timeFilter.presets.today': 'Today',
        'viewer.timeFilter.presets.yesterday': 'Yesterday',
        'viewer.timeFilter.presets.last7d': 'Last 7 days',
        'viewer.groupByField': 'Group by field',
        'viewer.totalEntries': '{count} log entries',
        'viewer.liveWindow': 'Live window: {count}',
        'viewer.filteredBy': 'Filtered by: "{value}"',
        'viewer.levelLabel': 'Level: {value}',
        'viewer.loading': 'Loading logs...',
        'viewer.noLogs': 'No logs yet. Wait for logs to be collected...',
        'viewer.refreshLogs': 'Refresh logs',
        'viewer.sort.reverse': 'Reverse order (new → old)',
        'viewer.sort.forward': 'Forward order (old → new)',
        'viewer.autoScroll.disable': 'Auto-scroll: click to disable',
        'viewer.autoScroll.enable': 'Auto-scroll: click to enable',
        'viewer.logFontSize': 'Font',
        'viewer.logFontSmaller': 'Decrease font size',
        'viewer.logFontLarger': 'Increase font size',
        'viewer.inlineTrace': 'trace',
        'viewer.inlineSpan': 'span',
        'viewer.sqlSummaryFallback': 'View SQL',
        'viewer.sqlJoinMore': '+{count}',
        'viewer.containerUnknown': 'unknown',
        'viewer.upPrefix': 'Up',
        'viewer.exitPrefix': 'Exit',
        'viewer.pidPrefix': 'PID',
        'viewer.groupPanel.show': 'Group by field',
        'viewer.groupPanel.hide': 'Hide field grouping',
        'viewer.scrollTop': 'Back to top',
        'group.fieldPlaceholder': 'Field name (e.g. level, path, caller)',
        'group.button': 'Group',
        'group.inline': 'Inline',
        'group.inlineTitle.enabled': 'Show grouping inline in the log list',
        'group.inlineTitle.disabled': 'Switch to inline grouping mode',
        'group.inlineEnabled': 'Inline grouping is enabled. Logs are grouped by "{field}".',
        'group.noGroups': 'No groups found for field "{field}"',
        'inline.toggle.expand': 'expand',
        'inline.toggle.collapse': 'collapse',
        'viewer.pullToLoad.hint': 'Load older',
        'viewer.pullToLoad.release': 'Release to load older',
        'viewer.pullToLoad.loading': 'Loading older logs…',
        'viewer.pullToLoad.noMore': 'No more logs',
    },
}

const UiPreferencesContext = createContext<UiPreferencesContextValue | null>(null)

function clampLogFontSize(size: number): number {
    return Math.min(MAX_LOG_FONT_SIZE, Math.max(MIN_LOG_FONT_SIZE, size))
}

function getInitialLocale(): Locale {
    const stored = localStorage.getItem(STORAGE_KEYS.locale)
    return stored === 'en' ? 'en' : 'zh-CN'
}

function getInitialTheme(): ThemeMode {
    const stored = localStorage.getItem(STORAGE_KEYS.theme)
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getInitialLogFontSize(): number {
    const stored = Number(localStorage.getItem(STORAGE_KEYS.logFontSize))
    return Number.isFinite(stored) ? clampLogFontSize(stored) : DEFAULT_LOG_FONT_SIZE
}

function translate(locale: Locale, key: string, params?: TranslationParams): string {
    const template = translations[locale][key] ?? translations.en[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
}

export function UiPreferencesProvider({children}: { children: ReactNode }) {
    const [locale, setLocale] = useState<Locale>(getInitialLocale)
    const [theme, setTheme] = useState<ThemeMode>(getInitialTheme)
    const [logFontSize, setLogFontSizeState] = useState<number>(getInitialLogFontSize)
    
    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.locale, locale)
        document.documentElement.lang = locale
    }, [locale])
    
    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.theme, theme)
        document.documentElement.classList.toggle('dark', theme === 'dark')
    }, [theme])
    
    useEffect(() => {
        const size = clampLogFontSize(logFontSize)
        localStorage.setItem(STORAGE_KEYS.logFontSize, String(size))
        document.documentElement.style.setProperty('--log-font-size', `${size}px`)
    }, [logFontSize])
    
    const setLogFontSize = useCallback((size: number) => {
        setLogFontSizeState(clampLogFontSize(size))
    }, [])
    
    const toggleTheme = useCallback(() => {
        setTheme(current => current === 'dark' ? 'light' : 'dark')
    }, [])
    
    const t = useCallback((key: string, params?: TranslationParams) => translate(locale, key, params), [locale])
    
    const value = useMemo<UiPreferencesContextValue>(() => ({
        locale,
        setLocale,
        theme,
        setTheme,
        toggleTheme,
        logFontSize,
        setLogFontSize,
        t,
    }), [locale, theme, toggleTheme, logFontSize, setLogFontSize, t])
    
    return <UiPreferencesContext.Provider value={value}>{children}</UiPreferencesContext.Provider>
}

export function useUiPreferences() {
    const context = useContext(UiPreferencesContext)
    if (!context) {
        throw new Error('useUiPreferences must be used within UiPreferencesProvider')
    }
    return context
}
