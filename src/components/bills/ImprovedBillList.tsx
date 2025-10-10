// components/bills/ImprovedBillList.tsx
import React from 'react'
import { ImprovedBillCard } from './ImprovedBillCard'

type Item = any

export function ImprovedBillList({ items, loading = false }: { items: Item[]; loading?: boolean }) {
    if (loading) {
        // simple skeleton grid (3 columns max)
        return (
            <div className="lt-grid">
                {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="lt-card lt-card-grid lt-skeleton" style={{ minHeight: 180 }} />
                ))}
            </div>
        )
    }

    if (!items || items.length === 0) {
        return <div className="py-8 text-center lt-muted">No items match your filters.</div>
    }

    return (
        <div className="lt-grid">
            {items.map((it: any) => {
                // Accept either unified `bill` shapes or your original `BillListBill` shapes.
                if (it.type === 'executiveOrder') {
                    // Fallback small card for EOs (you can create a dedicated EO card later)
                    return (
                        <article key={it.id} className="lt-card lt-card-grid">
                            <div>
                                <div className="text-xs lt-muted">EO {it.orderNumber}</div>
                                <h3 className="mt-2 lt-title text-base">{it.title}</h3>
                                <div className="mt-4 text-sm lt-muted">{it.signingDate ? new Date(it.signingDate).toLocaleDateString() : ''}</div>
                            </div>
                        </article>
                    )
                }
                // default -> bill
                return <ImprovedBillCard key={it.id} bill={it} />
            })}
        </div>
    )
}
