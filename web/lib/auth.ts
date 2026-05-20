import type { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      // Restrict access to @trovatrip.com accounts only
      return profile?.email?.endsWith('@trovatrip.com') ?? false
    },
    async session({ session }) {
      return session
    },
  },
  pages: {
    error: '/auth/error',
  },
}

export function isLeadership(email: string): boolean {
  const leaders = (process.env.LEADERSHIP_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return leaders.includes(email.toLowerCase())
}
