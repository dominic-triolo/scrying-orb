import type { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/gmail.send',
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      // Restrict access to @trovatrip.com accounts only
      return profile?.email?.endsWith('@trovatrip.com') ?? false
    },
    async jwt({ token, account }) {
      // On initial sign-in, persist tokens
      if (account) {
        return {
          ...token,
          access_token: account.access_token,
          refresh_token: account.refresh_token,
          expires_at: account.expires_at,
        }
      }
      // Token still valid
      if (Date.now() < (token.expires_at as number) * 1000) {
        return token
      }
      // Refresh expired token
      try {
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            grant_type: 'refresh_token',
            refresh_token: token.refresh_token as string,
          }),
        })
        const refreshed = await res.json()
        if (!res.ok) throw refreshed
        return {
          ...token,
          access_token: refreshed.access_token,
          expires_at: Math.floor(Date.now() / 1000 + refreshed.expires_in),
          refresh_token: refreshed.refresh_token ?? token.refresh_token,
        }
      } catch (err) {
        console.error('Token refresh failed', err)
        return { ...token, error: 'RefreshTokenError' }
      }
    },
    async session({ session, token }) {
      session.access_token = token.access_token as string | undefined
      session.error = token.error as string | undefined
      return session
    },
  },
  pages: {
    signIn: '/auth/signin',
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
