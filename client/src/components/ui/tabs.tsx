import * as React from "react"
import { cn } from "@/lib/utils"

function Tabs({ defaultValue, value, onValueChange, children, className }: {
  defaultValue?: string
  value?: string
  onValueChange?: (v: string) => void
  children: React.ReactNode
  className?: string
}) {
  const [internal, setInternal] = React.useState(defaultValue || '')
  const current = value ?? internal

  return (
    <div className={cn("h-full flex flex-col", className)} data-value={current}>
      {React.Children.map(children, child => {
        if (React.isValidElement(child) && typeof child.type === 'function') {
          return React.cloneElement(child as any, {
            _value: current,
            _onChange: (v: string) => {
              setInternal(v)
              onValueChange?.(v)
            },
          })
        }
        return child
      })}
    </div>
  )
}

function TabsList({ children, className, _value, _onChange }: any) {
  return (
    <div className={cn("inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground", className)}>
      {React.Children.map(children, child => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as any, {
            _active: _value === (child.props as any).value,
            _onClick: () => _onChange((child.props as any).value),
          })
        }
        return child
      })}
    </div>
  )
}

function TabsTrigger({ children, value, className, _active, _onClick }: any) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        _active ? "bg-background text-foreground shadow" : "hover:bg-background/50",
        className
      )}
      onClick={_onClick}
    >
      {children}
    </button>
  )
}

function TabsContent({ children, value, className, _value }: any) {
  if (_value !== value) return null
  return (
    <div className={cn("mt-2 flex-1 min-h-0 ring-offset-background focus-visible:outline-none", className)}>
      {children}
    </div>
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
