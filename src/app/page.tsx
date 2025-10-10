import Link from 'next/link'
// Revalidate this page every 60 seconds in production so counts stay fresh without forcing full SSR
export const revalidate = 60
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowRight, BookOpen, Bell, Search, TrendingUp, BookText } from 'lucide-react'
import { get_count_complete_legislation } from '@/lib/stats'

export default async function HomePage() {
  const complete = await get_count_complete_legislation()


  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="w-full py-12 md:py-24 lg:py-32 xl:py-48">
        <div className="container px-4 md:px-6">
          <div className="flex flex-col items-center space-y-4 text-center">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl lg:text-6xl/none">
                Track U.S. Legislation in Plain English
              </h1>
              <p className="mx-auto max-w-[700px] text-gray-500 md:text-xl dark:text-gray-400">
                Stay informed about federal bills, executive orders, and government actions with AI-powered summaries
                that anyone can understand.
              </p>
            </div>
            <div className="space-x-4">
              <Link href="/bills">
                <Button size="lg">
                  Browse Legislation
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              {/* <Link href="/categories">
                <Button variant="outline" size="lg">
                  Explore Categories
                </Button>
              </Link> */}
            </div>

            {/* Big stat */}
            <div className="mt-8 flex items-center gap-6">
              <div className="flex items-center rounded-lg lt-hero-stat px-6 py-4 shadow-lg">
                <BookText className="mr-4 h-8 w-8 text-primary" />
                <div className="text-left">
                  <div className="text-sm lt-muted">Pieces of Legislation Summarized</div>
                  <div className="text-3xl font-bold" style={{ background: 'linear-gradient(90deg,#7C5CFF,#6EE7B7)', WebkitBackgroundClip: 'text', color: 'transparent' }}>
                    {complete.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="w-full bg-gray-50 py-12 md:py-24 dark:bg-gray-900">
        <div className="container px-4 md:px-6">
          <h2 className="mb-12 text-center text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
            How It Works
          </h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader>
                <Search className="mb-2 h-8 w-8 text-primary" />
                <CardTitle>Automated Tracking</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  We automatically fetch and monitor all federal legislation from official government sources.
                </CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <BookOpen className="mb-2 h-8 w-8 text-primary" />
                <CardTitle>Plain Language</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  AI transforms complex legal text into clear, understandable summaries for everyone.
                </CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <TrendingUp className="mb-2 h-8 w-8 text-primary" />
                <CardTitle>Smart Categories</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Bills are automatically categorized by topic, making it easy to find what matters to you.
                </CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Bell className="mb-2 h-8 w-8 text-primary" />
                <CardTitle>Stay Updated</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Get notifications when bills you care about change status or new relevant legislation appears.
                </CardDescription>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Data breakdown removed per request */}

      {/* CTA Section */}
      <section className="w-full py-12 md:py-24">
        <div className="container px-4 md:px-6">
          <div className="flex flex-col items-center space-y-4 text-center">
            <div className="space-y-2">
              <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
                Start Tracking Legislation Today
              </h2>
              <p className="mx-auto max-w-[600px] text-gray-500 md:text-xl dark:text-gray-400">
                Join thousands of informed citizens staying up-to-date with government activity.
              </p>
            </div>
            <div className="space-x-4">
              <Link href="/bills">
                <Button size="lg">Get Started</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
