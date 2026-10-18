import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth/auth-form';
import { getOptionalUser } from '@/server/session';

export const metadata: Metadata = { title: 'Sign in · AI Job Agent' };

export default async function SignInPage() {
  if (await getOptionalUser()) redirect('/app');
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <AuthForm mode="sign-in" />
    </>
  );
}
