import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";

async function getCoverageMonths() {
    // 1) Retrieve today's date
    const today = new Date();

    // 2) Query DB for the oldest introducedDate among bills
    const oldest = await db.bill.findFirst({
        orderBy: { introducedDate: "asc" },
        select: { introducedDate: true },
    });

    // Validation: if no bills
    if (!oldest || !oldest.introducedDate) {
        return { status: "no-bills" } as const; // validated: no bills found
    }

    const introduced = new Date(oldest.introducedDate);

    // Validation: introduced date in future
    if (introduced > today) {
        return { status: "future" } as const; // validated: oldest date is in future
    }

    // 3) Calculate months difference (rounded to nearest whole number)
    const yearsDiff = today.getFullYear() - introduced.getFullYear();
    const monthsDiff = today.getMonth() - introduced.getMonth();
    const daysDiff = today.getDate() - introduced.getDate();

    let totalMonths = yearsDiff * 12 + monthsDiff;
    // Adjust if days difference crosses the halfway point of a month
    if (daysDiff >= 15) totalMonths += 1;
    if (totalMonths < 0) totalMonths = 0;

    // 4) Return computed months with singular/plural logic
    return { status: "ok" as const, months: totalMonths };
}

export default async function AboutPage() {
    const coverage = await getCoverageMonths();

    // Validation is handled inside getCoverageMonths(); proceed to render

    return (
        <div className="min-h-screen bg-linear-to-b from-stone-800 to-neutral-600 dark:from-gray-900 dark:to-gray-800">
            <div className="container mx-auto px-4 py-12 max-w-4xl">
                <Link
                    href="/"
                    className="inline-flex items-center text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 mb-8 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Home
                </Link>

                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 md:p-12">
                    <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-6">
                        About Legislation Tracker
                    </h1>

                    <section className="mb-8">
                        <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-4">
                            Our Mission
                        </h2>
                        <p className="text-gray-700 dark:text-gray-300 leading-relaxed text-lg">
                            <strong>Simplifying the legal language within government legislation to increase transparency.</strong>
                        </p>
                        <p className="text-gray-700 dark:text-gray-300 leading-relaxed mt-4">
                            Government legislation is often written in complex legal language that can be
                            difficult for everyday citizens to understand. Our goal is to break down these
                            barriers by providing clear, concise, AI-powered summaries of bills and executive
                            orders, making government more accessible and transparent for everyone.
                        </p>
                    </section>

                    <section className="mb-8 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-6 border-l-4 border-blue-500">
                        <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-4">
                            Commitment to Free Access
                        </h2>
                        <p className="text-gray-700 dark:text-gray-300 leading-relaxed text-lg">
                            <strong>LegisTrack will always be free to use.</strong>
                        </p>
                        <p className="text-gray-700 dark:text-gray-300 leading-relaxed mt-4">
                            We believe that access to government legislation and clear explanations of it
                            should never be behind a paywall. This project isn&apos;t about subscriptions, ads,
                            or monetization — it&apos;s about making legislation more transparent and
                            understandable for everyone.
                        </p>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-4">
                            Current Focus
                        </h2>
                        <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                            We are currently refining our AI summarization technology to strike the perfect
                            balance between:
                        </p>
                        <ul className="list-disc list-inside text-gray-700 dark:text-gray-300 mt-3 space-y-2 ml-4">
                            <li><strong>Brevity</strong> – Keeping summaries concise and easy to read</li>
                            <li><strong>Clarity</strong> – Using plain language that everyone can understand</li>
                            <li><strong>Completeness</strong> – Capturing the full scope and intent of the legislation</li>
                        </ul>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-4">
                            Coverage
                        </h2>
                        <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                            {coverage.status === "no-bills" ? (
                                <strong>No legislative data available.</strong>
                            ) : coverage.status === "future" ? (
                                <strong>Data start date is in the future.</strong>
                            ) : (
                                (() => {
                                    const months = coverage.months;
                                    const label = months === 1 ? "month" : "months";
                                    return (
                                        <>
                                            Currently, our database includes legislation from the <strong>past {months} {label}</strong>.
                                            In future iterations, we plan to expand our coverage to include all available
                                            historical legislation, providing a comprehensive archive of government actions.
                                        </>
                                    );
                                })()
                            )}
                        </p>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-4">
                            Roadmap
                        </h2>
                        <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
                            While we&apos;re focusing on perfecting the core summarization capabilities, we are currently working on or improving the following features planned for the future:
                        </p>

                        <div className="space-y-4">
                            <div>
                                <h3 className="font-semibold text-gray-800 dark:text-gray-200">
                                    Detailed Actions History
                                </h3>
                                <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
                                    Actions history for each bill, showing all updates and changes over time.
                                </p>
                            </div>
                            <div className="border-l-4 border-blue-500 pl-4 py-2">
                                <h3 className="font-semibold text-gray-800 dark:text-gray-200">
                                    📱 Mobile Optimizations
                                </h3>
                                <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
                                    Enhanced mobile experience for tracking legislation
                                </p>
                            </div>

                            <div className="border-l-4 border-green-500 pl-4 py-2">
                                <h3 className="font-semibold text-gray-800 dark:text-gray-200">
                                    🔔 Custom Alerts
                                </h3>
                                <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
                                    Get notified when new bills in your areas of interest are introduced
                                </p>
                            </div>

                            <div className="border-l-4 border-purple-500 pl-4 py-2">
                                <h3 className="font-semibold text-gray-800 dark:text-gray-200">
                                    👤 Account Tracking
                                </h3>
                                <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
                                    Save and organize bills you&apos;re following with personalized accounts
                                </p>
                            </div>

                            <div className="border-l-4 border-orange-500 pl-4 py-2">
                                <h3 className="font-semibold text-gray-800 dark:text-gray-200">
                                    📚 Complete Historical Archive
                                </h3>
                                <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
                                    Access to all available historical legislation beyond the current 10-month window
                                </p>
                            </div>
                            <div className="border-l-4 border-red-500 pl-4 py-2">
                                <h3 className="font-semibold text-gray-800 dark:text-gray-200">
                                    📊 Advanced Analytics
                                </h3>
                                <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
                                    Insights and trends in legislative activity
                                </p>
                            </div>
                        </div>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-4">
                            Technology
                        </h2>
                        <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                            This platform is built with modern web technologies and powered by advanced AI
                            to deliver accurate, helpful summaries. We source our data from official government
                            APIs including Congress.gov and the Federal Register to ensure accuracy and reliability.
                        </p>
                    </section>

                    <section className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-6 border border-blue-200 dark:border-blue-800">
                        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-3">
                            Stay Tuned
                        </h2>
                        <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                            This project is actively being developed. We&apos;re committed to continuously
                            improving the platform to better serve citizens seeking to understand their
                            government&apos;s actions. Check back regularly for updates and new features!
                        </p>
                    </section>

                    <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700 text-center">
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Project created October 1, 2025
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
