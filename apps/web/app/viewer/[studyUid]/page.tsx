'use client';

import { use } from 'react';
import { Main, Spinner } from '../../../components/ui';
import { StudyViewer } from '../../../components/viewer/StudyViewer';
import { useT } from '../../../lib/i18n/provider';
import { useSession } from '../../../lib/session/session';

export default function ViewerPage({ params }: { params: Promise<{ studyUid: string }> }) {
  const { studyUid } = use(params);
  const t = useT();
  const { status } = useSession();
  return (
    <Main>
      <h1 className="text-xl font-bold tracking-tight">{t.viewerTitle}</h1>
      {/* After a reload the token is restored asynchronously (/auth/refresh);
          mounting the viewer first sends every DICOMweb request without it. */}
      {status === 'loading' ? <Spinner label={t.loading} /> : <StudyViewer studyUid={studyUid} />}
    </Main>
  );
}
