import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth/auth-form';
import { getOptionalUser } from '@/server/session';

export const metadata: Metadata = { title: 'Create account · AI Job Agent' };

export default async function SignUpPage() {
  if (await getOptionalUser()) redirect('/app');
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <AuthForm mode="sign-up" />
    </>
  );
}
