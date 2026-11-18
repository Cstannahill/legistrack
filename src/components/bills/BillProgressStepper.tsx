import { Check, X } from "lucide-react"
import { getBillStageSummary } from "@/lib/utils/formatting"
import { cn } from "@/lib/utils"

interface BillProgressStepperProps {
    status: string
}

const STAGES = [
    { step: 1, label: "Introduced" },
    { step: 2, label: "Committee" },
    { step: 3, label: "Passed Chamber" },
    { step: 4, label: "Outcome" },
] as const

export function BillProgressStepper({ status }: BillProgressStepperProps) {
    const { step: currentStep, outcome } = getBillStageSummary(status)

    return (
        <div className="space-y-2.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Legislative Progress
            </div>
            <ol className="space-y-2" aria-label="Legislative progress">
                {STAGES.map((stage) => {
                    const isCompleted =
                        stage.step < currentStep ||
                        (stage.step === 4 && outcome === "law")
                    const isFailedTerminal =
                        stage.step === 4 && outcome === "failed"
                    const isCurrent =
                        stage.step === currentStep &&
                        outcome !== "law" &&
                        outcome !== "failed"

                    const label =
                        stage.step === 4
                            ? outcome === "law"
                                ? "Became Law"
                                : outcome === "failed"
                                    ? status === "VETOED"
                                        ? "Vetoed"
                                        : "Did Not Advance"
                                    : "Enacted / Signed"
                            : stage.label

                    return (
                        <li key={stage.step} className="flex items-center gap-2.5 text-sm">
                            <span
                                className={cn(
                                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                                    isFailedTerminal
                                        ? "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300"
                                        : isCompleted
                                            ? "border-primary bg-primary text-primary-foreground"
                                            : isCurrent
                                                ? "border-primary bg-primary/15 text-primary ring-2 ring-primary/20"
                                                : "border-border bg-muted/50 text-muted-foreground"
                                )}
                                aria-hidden="true"
                            >
                                {isFailedTerminal ? (
                                    <X className="h-3 w-3" />
                                ) : isCompleted ? (
                                    <Check className="h-3 w-3" />
                                ) : (
                                    stage.step
                                )}
                            </span>
                            <span
                                className={cn(
                                    isCompleted || isCurrent
                                        ? "font-medium text-foreground"
                                        : isFailedTerminal
                                            ? "font-medium text-rose-700 dark:text-rose-300"
                                            : "text-muted-foreground"
                                )}
                            >
                                {label}
                            </span>
                        </li>
                    )
                })}
            </ol>
        </div>
    )
}
