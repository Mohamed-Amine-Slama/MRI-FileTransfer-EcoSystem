'use client';

import type { FieldSpec } from '@mir/contracts';
import type { Dictionary } from '../../lib/i18n/dictionary';
import { useT } from '../../lib/i18n/provider';
import { specialtyLabel } from './labels';
import { Field, Input, Select } from '../ui';

/**
 * Renders a corridor's field specs as a form — brief §4.3.
 *
 * The whole point is that this component has no idea which corridor it is
 * drawing. Labels arrive as dictionary keys and are looked up here, so a new
 * corridor adds entries to the registry and the string catalogue, and no
 * conditional lands in a form component.
 */

/** Dictionary keys are strings at runtime; this narrows the lookup safely. */
function label(t: Dictionary, key: string): string {
  const value = (t as unknown as Record<string, string | undefined>)[key];
  // Falling back to the key is deliberate: an untranslated field is a visible
  // bug in development rather than an empty label in production.
  return value ?? key;
}

export function CorridorFields({
  fields,
  values,
  errors,
  onChange,
}: {
  fields: readonly FieldSpec[];
  values: Record<string, string>;
  errors: Record<string, string>;
  onChange: (key: string, value: string) => void;
}): React.JSX.Element {
  const t = useT();

  return (
    <>
      {fields.map((field) => {
        const value = values[field.key] ?? '';
        const error = errors[field.key] ?? null;
        const labelText = `${label(t, field.labelKey)}${field.required ? ' *' : ''}`;

        if (field.kind === 'select') {
          return (
            <Field key={field.key} label={labelText} error={error}>
              <Select
                value={value}
                data-testid={`field-${field.key}`}
                onChange={(e) => onChange(field.key, e.target.value)}
              >
                <option value="">{t.none}</option>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {/* Specialty options are routing keys (`radiology`), not
                        dictionary keys; they have their own labels. */}
                    {field.key === 'specialty' ? specialtyLabel(t, option) : label(t, option)}
                  </option>
                ))}
              </Select>
            </Field>
          );
        }

        if (field.kind === 'textarea') {
          return (
            <Field key={field.key} label={labelText} error={error}>
              <textarea
                value={value}
                rows={4}
                data-testid={`field-${field.key}`}
                aria-invalid={error === null ? undefined : 'true'}
                onChange={(e) => onChange(field.key, e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </Field>
          );
        }

        const inputType =
          field.kind === 'date' ? 'date' : field.kind === 'phone' ? 'tel' : 'text';

        return (
          <Field key={field.key} label={labelText} error={error}>
            <Input
              type={inputType}
              value={value}
              invalid={error !== null}
              data-testid={`field-${field.key}`}
              onChange={(e) => onChange(field.key, e.target.value)}
            />
          </Field>
        );
      })}
    </>
  );
}

/**
 * Client-side required-field validation — brief §5.2 P0.
 *
 * Returns a map of field key to message. The API will validate again; this
 * exists so a clinic on a slow link learns about an empty required field
 * before uploading imaging, not after.
 */
export function validateFields(
  fields: readonly FieldSpec[],
  values: Record<string, string>,
  requiredMessage: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (field.required && (values[field.key] ?? '').trim() === '') {
      errors[field.key] = requiredMessage;
    }
  }
  return errors;
}
