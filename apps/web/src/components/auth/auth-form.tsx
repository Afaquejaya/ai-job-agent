'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Field, TextInput } from '@/components/ui/form';
import { authClient } from '@/lib/auth-client';

const MIN_PASSWORD_LENGTH = 12;

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const isSignUp = mode === 'sign-up';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');

    const result = isSignUp
      ? await authClient.signUp.email({ email, password, name: String(form.get('name') ?? '') })
      : await authClient.signIn.email({ email, password });

    setPending(false);
    if (result.error) {
      setError(result.error.message ?? 'Something went wrong. Please try again.');
      return;
    }
    router.push('/app');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {isSignUp ? (
        <Field label="Name">
          <TextInput name="name" autoComplete="name" required maxLength={100} />
        </Field>
      ) : null}
      <Field label="Email">
        <TextInput name="email" type="email" autoComplete="email" required />
      </Field>
      <Field
        label="Password"
        hint={isSignUp ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined}
      >
        <TextInput
          name="password"
          type="password"
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          required
          minLength={isSignUp ? MIN_PASSWORD_LENGTH : undefined}
          maxLength={128}
        />
      </Field>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
      </Button>
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        {isSignUp ? 'Already have an account? ' : 'New here? '}
        <Link
          className="font-medium text-blue-600 underline dark:text-blue-400"
          href={isSignUp ? '/sign-in' : '/sign-up'}
        >
          {isSignUp ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </form>
  );
}
