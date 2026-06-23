'use client'

import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function SignInCard() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') ?? '/'

  return (
    <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg px-10 py-12 flex flex-col items-center gap-6">
      {/* Orb */}
      <div className="flex flex-col items-center gap-2">
        <span className="text-6xl select-none">🔮</span>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Scrying Orb</h1>
        <span className="text-6xl select-none">🔮</span>
      </div>

      <p className="text-sm text-gray-500 text-center leading-relaxed">
        Sign in with your TrovaTrip Google account to continue.
      </p>

      <button
        onClick={() => signIn('google', { callbackUrl })}
        className="w-full flex items-center justify-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 active:bg-gray-100 transition-colors"
      >
        {/* Google "G" logo */}
        <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
            fill="#4285F4"
          />
          <path
            d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
            fill="#34A853"
          />
          <path
            d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
            fill="#FBBC05"
          />
          <path
            d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
            fill="#EA4335"
          />
        </svg>
        Sign in with Google
      </button>
    </div>
  )
}

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <Suspense>
        <SignInCard />
      </Suspense>
    </div>
  )
}
