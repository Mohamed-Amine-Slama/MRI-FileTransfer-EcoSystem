'use client';

import Link from '../../components/ui/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import {
  PASSWORD_MIN_LENGTH,
  phoneE164Schema,
  registrationSchema,
} from '@mir/contracts';
import { ApiError } from '../../lib/api/client';
import { api } from '../../lib/api/endpoints';
import { useLocale, useT } from '../../lib/i18n/provider';
import { Alert, Button, Card, Field, Input, Main, PageHeader } from '../../components/ui';

/**
 * Account creation — brief §5.1.
 *
 * THIS CREATES A PERSON, NOT AN ORGANISATION. `/signup/provider` registers the
 * clinic; this registers the human who will run it, and the two are separate
 * because the account has to exist before there is anyone to attach the
 * application to — and because a colleague joining by invitation takes this
 * step and skips the other entirely.
 *
 * THE FORM ALWAYS ADVANCES. Whether the address was free, already registered,
 * or nonsense, the next screen is the same "check your email". That is not a
 * missing error state: a form that says "that address is taken" is an
 * enumeration oracle for which clinicians have accounts on a platform whose
 * users treat cross-border patients. /reset-password answers identically for
 * the same reason.
 *
 * The exceptions are the two failures that are about the REQUEST rather than
 * the account: a malformed field (400) and an environment where self-service
 * sign-up is not configured (501). Neither reveals anything about who exists.
 */
export default function SignUpPage(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const { locale } = useLocale();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const validate = (): boolean => {
    const found: Record<string, string> = {};
    if (fullName.trim() === '') found['fullName'] = t.required;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) found['email'] = t.signUpInvalidEmail;
    if (password.length < PASSWORD_MIN_LENGTH) found['password'] = t.signUpPasswordHint;
    if (!phoneE164Schema.safeParse(phone.trim()).success) found['phone'] = t.signUpInvalidPhone;
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const submit = async (): Promise<void> => {
    if (!validate()) return;
    setBusy(true);
    setError(null);
    try {
      const input = registrationSchema.parse({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        phoneE164: phone.trim(),
        locale,
      });
      await api.account.register(input);
      // The address is carried on the query string, not in storage: the
      // verify screen needs it to submit the code, and a reload of that screen
      // must keep working. It is the user's own address, so there is nothing
      // disclosed by its being visible.
      router.push(`/signup/verify?email=${encodeURIComponent(input.email)}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 501) {
        setError(t.signUpNotConfigured);
      } else {
        setError(t.genericError);
      }
    } finally {
      setBusy(false);
    }
  };

  const clear = (key: string) =>
    setErrors((prev) => {
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });

  return (
    <Main className="max-w-md py-12">
      <PageHeader title={t.signUpTitle} description={t.signUpDescription} />

      <Card>
        <form
          className="space-y-4"
          /*
           * `noValidate` turns OFF the browser's own constraint checking, and
           * that is a deliberate accessibility and i18n decision rather than a
           * shortcut.
           *
           * With it on, an invalid `type="email"` value makes the browser block
           * submission and show a native tooltip — in the BROWSER's language,
           * not the interface's, attached to no element the page controls, and
           * gone the moment focus moves. An Arabic-speaking clinician on an
           * English-locale machine gets an English balloon and no error text on
           * the field at all.
           *
           * The validation below produces a translated message, rendered next
           * to its field with role="alert", for every problem at once.
           */
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label={t.signUpFullName} error={errors['fullName'] ?? null}>
            <Input
              data-testid="signup-name"
              value={fullName}
              autoComplete="name"
              invalid={errors['fullName'] !== undefined}
              onChange={(e) => {
                setFullName(e.target.value);
                clear('fullName');
              }}
            />
          </Field>

          <Field label={t.signUpEmail} error={errors['email'] ?? null}>
            <Input
              data-testid="signup-email"
              type="email"
              value={email}
              autoComplete="email"
              inputMode="email"
              spellCheck={false}
              // Latin-script and LTR whatever the interface language: an
              // address reordered by an RTL layout is unreadable.
              dir="ltr"
              invalid={errors['email'] !== undefined}
              onChange={(e) => {
                setEmail(e.target.value);
                clear('email');
              }}
            />
          </Field>

          <Field
            label={t.signUpPassword}
            hint={t.signUpPasswordHint}
            error={errors['password'] ?? null}
          >
            <Input
              data-testid="signup-password"
              type="password"
              value={password}
              autoComplete="new-password"
              dir="ltr"
              invalid={errors['password'] !== undefined}
              onChange={(e) => {
                setPassword(e.target.value);
                clear('password');
              }}
            />
          </Field>

          <Field label={t.signUpPhone} hint={t.signUpPhoneHint} error={errors['phone'] ?? null}>
            <Input
              data-testid="signup-phone"
              type="tel"
              value={phone}
              autoComplete="tel"
              inputMode="tel"
              dir="ltr"
              placeholder="+218911234567"
              invalid={errors['phone'] !== undefined}
              onChange={(e) => {
                setPhone(e.target.value);
                clear('phone');
              }}
            />
          </Field>

          {error !== null && <Alert tone="danger">{error}</Alert>}

          <Button
            type="submit"
            variant="primary"
            className="h-11 w-full"
            data-testid="signup-submit"
            disabled={busy}
          >
            <UserPlus aria-hidden="true" />
            {busy ? t.loading : t.signUpCreateAccount}
          </Button>
        </form>

        <div className="mt-4 border-t pt-4 text-sm">
          <span className="text-muted-foreground">{t.signUpHaveAccount} </span>
          <Link href="/login" className="font-semibold text-primary hover:underline">
            {t.navSignIn}
          </Link>
        </div>
      </Card>
    </Main>
  );
}
