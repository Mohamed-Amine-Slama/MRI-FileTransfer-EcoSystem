'use client';

import Link from '../../components/ui/link';
import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, UserRoundPlus } from 'lucide-react';
import { api, type Patient } from '../../lib/api/endpoints';
import { useT } from '../../lib/i18n/provider';
import { RoleGate } from '../../components/RoleGate';
import {
  Alert,
  Button,
  EmptyState,
  Field,
  Input,
  Main,
  PageHeader,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  buttonVariants,
} from '../../components/ui';

/**
 * Patient worklist — BUILD_SPEC P5.1 / P3.3.
 *
 * SEARCH IS BY PHONE ONLY, and that is a privacy control rather than a
 * simplification. Name search over a cross-border patient index lets anyone
 * with a clinician account enumerate who has been referred — which is exactly
 * the Article 9 exposure the design is trying to avoid. A phone number has to
 * be known in advance.
 *
 * The list itself is not filtered client-side by owner. It arrives already
 * filtered by row-level security, so a doctor sees their own patients because
 * the database said so, not because this component omitted rows.
 */
export default function PatientsPage(): React.JSX.Element {
  return (
    <RoleGate allow={['libya_doctor']}>
      <PatientsList />
    </RoleGate>
  );
}

function PatientsList(): React.JSX.Element {
  const t = useT();
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [phone, setPhone] = useState('');
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const { patients: rows } = await api.patients.list();
      setPatients(rows);
      setSearched(false);
    } catch {
      setError(t.genericError);
      setPatients([]);
    }
  }, [t]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const search = async (): Promise<void> => {
    const trimmed = phone.trim();
    if (trimmed === '') {
      void loadAll();
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const { candidates } = await api.patients.searchByPhone(trimmed);
      setPatients(candidates);
      setSearched(true);
    } catch {
      setError(t.genericError);
    } finally {
      setSearching(false);
    }
  };

  return (
    <Main wide>
      <PageHeader
        title={t.patientsTitle}
        description={t.patientsDescription}
        actions={
          <Link href="/patients/new" className={buttonVariants()} data-testid="new-patient">
            <UserRoundPlus aria-hidden="true" />
            {t.patientsNew}
          </Link>
        }
      />

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div className="min-w-56 flex-1 sm:max-w-sm">
          <Field label={t.patientsSearchPhone}>
            <Input
              data-testid="phone-search"
              value={phone}
              inputMode="tel"
              placeholder="+218…"
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        </div>
        <Button type="submit" data-testid="phone-search-submit" disabled={searching}>
          {t.search}
        </Button>
      </form>

      {error !== null && <Alert tone="danger">{error}</Alert>}

      {patients === null ? (
        <Spinner label={t.loading} />
      ) : patients.length === 0 ? (
        <EmptyState testId="patients-empty">
          {searched ? t.patientsNoMatch : t.patientsEmpty}
        </EmptyState>
      ) : (
        <Table data-testid="patient-list">
          <TableHeader>
            <TableRow>
              <TableHead>{t.patientName}</TableHead>
              <TableHead>{t.patientsSearchPhone}</TableHead>
              <TableHead>{t.patientDob}</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">{t.colActions}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {patients.map((p) => (
              <TableRow key={p.id} data-testid="patient-row">
                <TableCell className="font-medium">
                  <Link href={`/patients/${p.id}`} className="rounded-sm hover:text-primary hover:underline">
                    {p.fullName}
                  </Link>
                </TableCell>
                <TableCell dir="ltr" className="text-muted-foreground">
                  {p.phoneE164}
                </TableCell>
                <TableCell className="text-muted-foreground">{p.dateOfBirth}</TableCell>
                <TableCell>
                  <ChevronRight className="size-4 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Main>
  );
}
