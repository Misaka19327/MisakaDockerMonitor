import * as React from "react"
import {cn} from "@/lib/utils"

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    options: { value: string; label: string }[]
    placeholder?: string
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
    ({className, options, placeholder, ...props}, ref) => (
        <select
            ref={ref}
            className={cn(
                "flex h-9 w-full rounded-md border border-input bg-popover px-3 py-1 text-sm text-popover-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                className
            )}
            {...props}
        >
            {placeholder && <option value="" className="bg-popover text-popover-foreground">{placeholder}</option>}
            {options.map(opt => (
                <option key={opt.value} value={opt.value}
                        className="bg-popover text-popover-foreground">{opt.label}</option>
            ))}
        </select>
    )
)
Select.displayName = "Select"

export {Select}
